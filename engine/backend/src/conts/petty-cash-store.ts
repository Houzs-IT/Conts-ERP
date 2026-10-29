// Conts only (not part of Houzs's code): reading petty cash for the finance and staff routes (design
// docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md §4.5). Every balance is worked out by
// petty-cash.ts from the float's events and receipts, so the screens and the top-up agree.
import { floatBalance, lowBalance, type FloatEvent, type ReceiptStatus } from './petty-cash';
import { paginateAll } from '../scm/lib/paginate-all';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as in the routes it serves */
type Db = any;

export interface FloatRow {
  id: string; company_id: number; department_id: string; keeper_user_id: string; float_sen: number; warn_pct: number;
  active: boolean; topup_requested_at: string | null;
  /** The float's own cash-in-hand account in the chart (chew 29 Oct 2026); null books nothing. */
  account_code: string | null;
}
export interface ReceiptRow {
  id: string; receipt_no: string; submitter_user_id: string; float_id: string | null; spend_date: string; amount_sen: number;
  vendor_name: string | null; note: string | null; status: ReceiptStatus; reject_reason: string | null; checked_at: string | null;
  checked_by: string | null; topup_pv_id: string | null; payback_pv_id: string | null; replaces_id: string | null; source: string;
  created_at: string;
}
export interface ReceiptLineRow {
  id: string; receipt_id: string; department: string; unit_id: string | null; maintenance_issue_id: string | null;
  project_id: number | null; account_code: string | null; amount_sen: number; description: string | null; sort: number;
}

export const RECEIPT_COLS = 'id, receipt_no, submitter_user_id, float_id, spend_date, amount_sen, vendor_name, note, status, reject_reason, checked_at, checked_by, topup_pv_id, payback_pv_id, replaces_id, source, created_at';

export async function floatsOf(sb: Db, companyId: number, opts: { activeOnly?: boolean } = {}): Promise<FloatRow[]> {
  let q = sb.from('petty_cash_floats').select('*').eq('company_id', companyId);
  if (opts.activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as FloatRow[];
}

export async function floatBalances(sb: Db, floats: FloatRow[]): Promise<Map<string, { balanceSen: number; low: boolean; lastTopUpOn: string | null }>> {
  const out = new Map<string, { balanceSen: number; low: boolean; lastTopUpOn: string | null }>();
  if (floats.length === 0) return out;
  const ids = floats.map(f => f.id);
  /* Paged: a float's history passes PostgREST's 1,000-row page within months, and a short read would be a wrong balance. */
  const [{ data: ev, error: e1 }, { data: rc, error: e2 }] = await Promise.all([
    paginateAll((f, t) => sb.from('petty_cash_events').select('id, float_id, kind, amount_sen, event_date').in('float_id', ids).order('id').range(f, t)),
    paginateAll((f, t) => sb.from('staff_receipts').select('id, float_id, amount_sen, status').in('float_id', ids).order('id').range(f, t)),
  ]);
  if (e1 || e2) throw new Error(String(((e1 ?? e2) as { message?: string }).message ?? 'read failed'));
  for (const f of floats) {
    const events = ((ev ?? []) as Array<{ float_id: string; kind: FloatEvent['kind']; amount_sen: number; event_date: string }>).filter(e => e.float_id === f.id);
    const receipts = ((rc ?? []) as Array<{ float_id: string; amount_sen: number; status: ReceiptStatus }>).filter(r => r.float_id === f.id);
    const balanceSen = floatBalance(events.map(e => ({ kind: e.kind, amountSen: Number(e.amount_sen) })), receipts.map(r => ({ amountSen: Number(r.amount_sen), status: r.status })));
    const paidIn = events.filter(e => e.kind === 'PAID_IN').map(e => e.event_date).sort();
    out.set(f.id, { balanceSen, low: lowBalance(Number(f.float_sen), balanceSen, Number(f.warn_pct)), lastTopUpOn: paidIn.at(-1) ?? null });
  }
  return out;
}

export async function linesOf(sb: Db, receiptIds: string[]): Promise<Map<string, ReceiptLineRow[]>> {
  const out = new Map<string, ReceiptLineRow[]>();
  if (receiptIds.length === 0) return out;
  for (const l of await inChunks<ReceiptLineRow>(receiptIds, (ids, f, t) => sb.from('staff_receipt_lines').select('*').in('receipt_id', ids).order('id').range(f, t))) out.set(l.receipt_id, [...(out.get(l.receipt_id) ?? []), l]);
  for (const ls of out.values()) ls.sort((a, b) => a.sort - b.sort);
  return out;
}

export async function filesOf(sb: Db, receiptIds: string[]): Promise<Map<string, Array<{ id: string; file_name: string; mime: string }>>> {
  const out = new Map<string, Array<{ id: string; file_name: string; mime: string }>>();
  if (receiptIds.length === 0) return out;
  for (const f of await inChunks<{ id: string; receipt_id: string; file_name: string; mime: string }>(receiptIds, (ids, fr, t) => sb.from('staff_receipt_files').select('id, receipt_id, file_name, mime').in('receipt_id', ids).order('id').range(fr, t))) out.set(f.receipt_id, [...(out.get(f.receipt_id) ?? []), f]);
  return out;
}

/** Names of staff and departments (public views of Property OS). A failed read gives no names, never an error. */
export async function staffNames(sb: Db): Promise<Map<string, string>> {
  const { data } = await sb.schema('public').from('conts_staff').select('id, full_name');
  return new Map(((data ?? []) as Array<{ id: string; full_name: string }>).map(s => [String(s.id), s.full_name]));
}
export async function departmentNames(sb: Db): Promise<Map<string, string>> {
  const { data } = await sb.schema('public').from('conts_departments').select('id, name');
  return new Map(((data ?? []) as Array<{ id: string; name: string }>).map(d => [String(d.id), d.name]));
}

/** A receipt as the screens show it. */
export function receiptView(r: ReceiptRow, lines: ReceiptLineRow[], files: Array<{ id: string; file_name: string; mime: string }>, names: Map<string, string>) {
  return {
    id: r.id, receiptNo: r.receipt_no, submitterUserId: r.submitter_user_id, submitterName: names.get(r.submitter_user_id) ?? '',
    floatId: r.float_id, spendDate: String(r.spend_date).slice(0, 10), amountSen: Number(r.amount_sen), vendorName: r.vendor_name,
    note: r.note, status: r.status, rejectReason: r.reject_reason, checkedAt: r.checked_at, checkedBy: r.checked_by,
    topUpPvId: r.topup_pv_id, paybackPvId: r.payback_pv_id, replacesId: r.replaces_id, source: r.source,
    lines: lines.map(l => ({ id: l.id, department: l.department, unitId: l.unit_id, maintenanceIssueId: l.maintenance_issue_id,
      projectId: l.project_id, accountCode: l.account_code, amountSen: Number(l.amount_sen), description: l.description })),
    files: files.map(f => ({ id: f.id, fileName: f.file_name, mime: f.mime })),
  };
}

/** The month a receipt list is filtered to: YYYY-MM, or all when absent or malformed. */
export function monthRange(month: string | undefined): { from: string; to: string } | null {
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

/** Every row for a long list of ids: the ids in chunks (a URL has a length limit), each chunk paged past 1,000 rows. */
export async function inChunks<T>(ids: string[], query: (ids: string[], from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const part = ids.slice(i, i + 150);
    const r = await paginateAll<T>((f, t) => query(part, f, t) as PromiseLike<{ data: T[] | null; error: any }>);
    if (r.error) throw new Error(String((r.error as { message?: string }).message ?? r.error));
    out.push(...((r.data ?? []) as T[]));
  }
  return out;
}

/** Every row a query returns, paged past PostgREST's 1,000-row cap. */
export async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const r = await paginateAll<T>((f, t) => query(f, t) as PromiseLike<{ data: T[] | null; error: any }>);
  if (r.error) throw new Error(String((r.error as { message?: string }).message ?? r.error));
  return (r.data ?? []) as T[];
}
