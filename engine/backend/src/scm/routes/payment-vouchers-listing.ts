// ----------------------------------------------------------------------------
// GET /payment-vouchers/listing?from=&to=&stages= — the Payment listing: the
// vouchers to pay and post, one line each, with what each is for and the bank it
// pays into. Ported from Houzs (payment-vouchers-listing.ts and
// payment-vouchers-describe.ts) and adapted to the Conts voucher:
//
//   · the stages are the four layers (scm/lib/pv-approval): by default Prepared
//     and Checked — not posted yet — dated up to `to` (today) and from `from`
//     when given, oldest first;
//   · the Description: what is paid for, each text once, in order —
//       1. the lines of the AP invoices it pays, and the items of the goods
//          invoices it pays;
//       2. else the voucher's own lines, less the lines the system writes
//          (Settle n invoice(s) / prepay / Internal transfer / Refund on …);
//       3. else the voucher's remark (notes);
//   · the departments and projects its lines are for (Conts: lines carry both);
//   · the bank it pays into (payeeBanksOf): the supplier's own bank, or for a
//     claim paid back, the bank given on the claim, else the person's saved one.
//     A Conts voucher has no bank fields of its own (Houzs' pay_to_*).
//
// Read only, company-scoped, read whole (paged): a listing that looks complete
// but is short is the defect a payment run cannot afford.
// ----------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped throughout the acc layer */
import { payBackBank, savedBanksOf } from '../../conts/petty-cash-routes';
import { scopeToCompany, activeCompanyId, type CompanyScopeCtx } from '../lib/companyScope';
import { paginateAll } from '../lib/paginate-all';
import { todayMyt } from '../lib/my-time';

export const LISTING_STAGES = ['DRAFT', 'PREPARED', 'CHECKED', 'POSTED', 'CANCELLED'] as const;
export type ListingStage = typeof LISTING_STAGES[number];
const DEFAULT_STAGES: ListingStage[] = ['PREPARED', 'CHECKED'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const LISTING_HEADER =
  'id, pv_number, voucher_date, payee_name, supplier_id, credit_account_code, currency, exchange_rate, purpose, notes, total_sen, status, posted_at, submitted_at, checked_at, approved_at, company_id';
const SUPPLIER_EMBED = 'supplier:suppliers(id, code, name, bank_name, bank_account_no, bank_account_name)';

/** The four layers as one word: Prepared and Checked are DRAFTs wearing marks. */
export const stageOf = (r: Record<string, unknown>): ListingStage => {
  if (r.status === 'POSTED') return 'POSTED';
  if (r.status === 'CANCELLED') return 'CANCELLED';
  if (r.checked_at) return 'CHECKED';
  return r.submitted_at ? 'PREPARED' : 'DRAFT';
};
const STATUS_OF: Record<ListingStage, string> = { DRAFT: 'DRAFT', PREPARED: 'DRAFT', CHECKED: 'DRAFT', POSTED: 'POSTED', CANCELLED: 'CANCELLED' };

/* ── The bank each voucher's money goes to ─────────────────────────────── */

export type PayeeBank = { bankName: string; accountNo: string; accountName: string | null };
/** The bank each voucher's money goes to (chew, 18 Nov 2026: the voucher list shows the account number): a supplier's
 *  own bank (suppliers.bank_*), or, for a claim paid back, the bank given on the claim, else the person's saved one.
 *  Best effort: a failed read leaves the column empty, never the list. */
export async function payeeBanksOf(sb: any, companyId: number | null, rows: Array<Record<string, unknown> & { id: string }>): Promise<Map<string, PayeeBank>> {
  const out = new Map<string, PayeeBank>();
  for (const r of rows) {
    const s = (Array.isArray(r.supplier) ? r.supplier[0] : r.supplier) as { bank_name?: string | null; bank_account_no?: string | null; bank_account_name?: string | null } | null;
    if (s?.bank_account_no) out.set(r.id, { bankName: s.bank_name ?? '', accountNo: s.bank_account_no, accountName: s.bank_account_name ?? null });
  }
  const rest = rows.filter((r) => !out.has(r.id)).map((r) => r.id);
  if (!rest.length || companyId == null) return out;
  try {
    const { data } = await sb.from('staff_receipts').select('payback_pv_id, submitter_user_id, payee_bank_name, payee_account_no, payee_account_name')
      .eq('company_id', companyId).in('payback_pv_id', rest);
    const claims = (data ?? []) as Array<{ payback_pv_id: string; submitter_user_id: string; payee_bank_name: string | null; payee_account_no: string | null; payee_account_name: string | null }>;
    const saved = await savedBanksOf(sb, companyId, claims.map((x) => String(x.submitter_user_id)));
    for (const x of claims) {
      if (out.has(x.payback_pv_id)) continue;
      const b = payBackBank(x, saved.get(String(x.submitter_user_id)) ?? null);
      if (b) out.set(x.payback_pv_id, { bankName: b.bankName, accountNo: b.accountNo, accountName: b.accountName });
    }
  } catch (e) {
    console.error('[payment-vouchers] payee banks not read:', e instanceof Error ? e.message : e);
  }
  return out;
}

/* ── What each voucher is for ─────────────────────────────────────────── */

export type Described = {
  description_text: string;
  departments: string[];
  projects: string[];
};

/* The lines the system writes on a voucher (PaymentVoucherNew's AP payment and transfer lines, pv-refund's refund
   line): they say how, not what for. */
const SYSTEM_LINE = /^(settle \d+ invoice\(s\)|prepay [\d.,]+|internal transfer\b|refund on )/i;
export const isSystemLine = (d: string): boolean => SYSTEM_LINE.test(d);

/** Each text once, trimmed and with its spaces closed, in the order first seen. */
const once = (texts: readonly unknown[]): string[] => {
  const out: string[] = [];
  for (const t of texts) {
    const s = String(t ?? '').replace(/\s+/g, ' ').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
};
type Rows = Array<Record<string, unknown>>;

/** The Description, from what the voucher pays (pure, so a test reads it without a database). */
export function describeOne(v: { billItems: readonly unknown[]; ownLines: readonly unknown[]; notes: unknown }): string {
  const bills = once(v.billItems);
  const own = once(v.ownLines).filter((d) => !isSystemLine(d));
  return [bills, own, once([v.notes])].find((xs) => xs.length > 0)?.join('; ') ?? '';
}

async function inHundreds(ids: string[], read: (batch: string[]) => PromiseLike<{ data: Rows | null; error: { message: string } | null }>): Promise<{ ok: true; rows: Rows } | { ok: false; reason: string }> {
  const rows: Rows = [];
  for (let i = 0; i < ids.length; i += 100) {
    const r = await read(ids.slice(i, i + 100));
    if (r.error) return { ok: false, reason: r.error.message };
    rows.push(...(r.data ?? []));
  }
  return { ok: true, rows };
}

/** Each voucher's description, departments and projects, by id. A failed read fails the request. */
export async function describeVouchers(
  sb: any, c: CompanyScopeCtx, rows: Array<Record<string, unknown> & { id: string }>,
): Promise<{ ok: true; byId: Map<string, Described> } | { ok: false; reason: string }> {
  const byId = new Map<string, Described>();
  if (rows.length === 0) return { ok: true, byId };
  const ids = rows.map((r) => r.id);
  const [lines, allocations] = await Promise.all([
    inHundreds(ids, (batch) => paginateAll<Record<string, unknown>>((f, t) => scopeToCompany(sb.from('payment_voucher_lines')
      .select('pv_id, line_no, description, department, project_id'), c).in('pv_id', batch).order('pv_id').order('line_no').range(f, t))),
    inHundreds(ids, (batch) => paginateAll<Record<string, unknown>>((f, t) => scopeToCompany(sb.from('pv_allocations')
      .select('pv_id, ap_invoice_id, pi_id, created_at'), c).in('pv_id', batch).order('created_at').range(f, t))),
  ]);
  if (!lines.ok) return { ok: false, reason: `lines: ${lines.reason}` };
  if (!allocations.ok) return { ok: false, reason: `allocations: ${allocations.reason}` };

  const idsOf = (key: string): string[] => once(allocations.rows.map((a) => a[key]));
  const projectIds = [...new Set(lines.rows.map((l) => Number(l.project_id)).filter((n) => Number.isInteger(n) && n > 0))];
  const [apLines, piItems, projects] = await Promise.all([
    inHundreds(idsOf('ap_invoice_id'), (batch) => paginateAll<Record<string, unknown>>((f, t) => scopeToCompany(sb.from('ap_invoice_lines')
      .select('invoice_id, line_no, description'), c).in('invoice_id', batch).order('invoice_id').order('line_no').range(f, t))),
    inHundreds(idsOf('pi_id'), (batch) => paginateAll<Record<string, unknown>>((f, t) => scopeToCompany(sb.from('purchase_invoice_items')
      .select('purchase_invoice_id, description, created_at'), c).in('purchase_invoice_id', batch).order('purchase_invoice_id').order('created_at').range(f, t))),
    projectIds.length === 0
      ? Promise.resolve({ ok: true as const, rows: [] as Rows })
      : inHundreds(projectIds.map(String), (batch) => sb.schema('public').from('projects').select('id, name')
        .eq('company_id', activeCompanyId(c)).in('id', batch.map(Number))),
  ]);
  if (!apLines.ok) return { ok: false, reason: `AP invoice lines: ${apLines.reason}` };
  if (!piItems.ok) return { ok: false, reason: `purchase invoice items: ${piItems.reason}` };
  if (!projects.ok) return { ok: false, reason: `projects: ${projects.reason}` };

  const group = (list: Rows, key: string) => {
    const out = new Map<string, Rows>();
    for (const r of list) out.set(String(r[key]), [...(out.get(String(r[key])) ?? []), r]);
    return out;
  };
  const byLineNo = (a: Record<string, unknown>, b: Record<string, unknown>) => Number(a.line_no ?? 0) - Number(b.line_no ?? 0);
  const linesOf = group([...lines.rows].sort(byLineNo), 'pv_id');
  const allocationsOf = group(allocations.rows, 'pv_id');
  const apLinesOf = group([...apLines.rows].sort(byLineNo), 'invoice_id');
  const piItemsOf = group(piItems.rows, 'purchase_invoice_id');
  const projectName = new Map(projects.rows.map((p) => [Number(p.id), String(p.name ?? p.id)]));

  for (const r of rows) {
    const paid = allocationsOf.get(r.id) ?? [];
    const own = linesOf.get(r.id) ?? [];
    const billItems = [
      ...once(paid.map((a) => a.ap_invoice_id)).flatMap((id) => (apLinesOf.get(id) ?? []).map((l) => l.description)),
      ...once(paid.map((a) => a.pi_id)).flatMap((id) => (piItemsOf.get(id) ?? []).map((l) => l.description)),
    ];
    byId.set(r.id, {
      description_text: describeOne({ billItems, ownLines: own.map((l) => l.description), notes: r.notes }),
      departments: once(own.map((l) => l.department)),
      projects: once(own.map((l) => (l.project_id == null ? null : projectName.get(Number(l.project_id)) ?? String(l.project_id)))),
    });
  }
  return { ok: true, byId };
}

/* ── The door ─────────────────────────────────────────────────────────── */

export const paymentListingHandler = async (c: any): Promise<Response> => {
  const sb = c.get('supabase');
  const toQ = String(c.req.query('to') ?? '').trim();
  const fromQ = String(c.req.query('from') ?? '').trim();
  const to = DATE.test(toQ) ? toQ : todayMyt();
  const from = DATE.test(fromQ) ? fromQ : null;
  if (from && from > to) return c.json({ error: 'bad_range', message: 'The first day must be on or before the last.' }, 400);
  const asked = String(c.req.query('stages') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const unknown = asked.filter((s) => !(LISTING_STAGES as readonly string[]).includes(s));
  if (unknown.length > 0) return c.json({ error: 'bad_stage', message: `No such stage: ${unknown.join(', ')}.` }, 400);
  const stages = (asked.length > 0 ? LISTING_STAGES.filter((s) => asked.includes(s)) : DEFAULT_STAGES) as ListingStage[];
  const statuses = [...new Set(stages.map((s) => STATUS_OF[s]))];

  const { data, error } = await paginateAll<Record<string, unknown> & { id: string }>((f, t) => {
    let q = sb.from('payment_vouchers').select(`${LISTING_HEADER}, ${SUPPLIER_EMBED}`)
      .in('status', statuses).lte('voucher_date', to);
    if (from) q = q.gte('voucher_date', from);
    return scopeToCompany(q, c).order('voucher_date').order('pv_number').range(f, t);
  });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const rows = (data ?? [])
    .filter((r) => stages.includes(stageOf(r)))
    .sort((a, b) => String(a.voucher_date ?? '').localeCompare(String(b.voucher_date ?? '')) || String(a.pv_number).localeCompare(String(b.pv_number)));
  const described = await describeVouchers(sb, c, rows);
  if (!described.ok) return c.json({ error: 'load_failed', reason: described.reason }, 500);
  const banks = await payeeBanksOf(sb, activeCompanyId(c) ?? null, rows);
  return c.json({
    from, to, stages,
    vouchers: rows.map((r) => {
      const b = banks.get(r.id);
      return {
        ...r, stage: stageOf(r), ...described.byId.get(r.id),
        pay_bank: b?.bankName || null, pay_account_no: b?.accountNo ?? null, pay_account_name: b?.accountName ?? null,
      };
    }),
  });
};
