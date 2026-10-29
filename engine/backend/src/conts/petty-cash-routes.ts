// Conts only (not part of Houzs's code): finance's petty cash (SOP 6; design
// docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md §4.5, §4.7-4.9). Mounted under /accounting,
// behind the Ledger guard (view). Ledger edit (scm.payment_voucher.write) checks and rejects receipts and records cash;
// Ledger full (scm.payment_voucher.approve) sets floats, overrides and bank details, writes off and tops up.
//   GET   /accounting/petty-cash/floats                    overview: one row per float, with totals
//   POST  /accounting/petty-cash/floats                    { departmentId, keeperUserId, floatSen, warnPct? }
//   PATCH /accounting/petty-cash/floats/:id                { keeperUserId?, floatSen?, warnPct?, active? }
//   GET   /accounting/petty-cash/floats/:id/receipts?month=YYYY-MM
//   POST  /accounting/petty-cash/floats/:id/top-up         { bankAccountCode }  -> a draft voucher to the keeper
//   POST  /accounting/petty-cash/floats/:id/returned       { amountSen, date, note? }
//   GET   /accounting/petty-cash/receipts?route=finance&month=   receipts finance pays back (no float)
//   POST  /accounting/petty-cash/receipts/check            { items: [{ id, amountSen?, lines? }] }
//   POST  /accounting/petty-cash/receipts/:id/reject       { reason }
//   POST  /accounting/petty-cash/receipts/:id/repaid       { date? }
//   POST  /accounting/petty-cash/receipts/:id/write-off    { accountCode, date? }
//   POST  /accounting/petty-cash/receipts/:id/voucher      { bankAccountCode }  -> a draft voucher to the person
//   GET|PUT /accounting/petty-cash/overrides               [{ userId, floatId }]
//   GET|PUT /accounting/staff-bank/:userId                 { bankName, accountNo, accountName }
import { hasHouzsPerm } from '../scm/lib/houzs-perms';
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { todayMyt } from '../scm/lib/my-time';
import { resolveRoles } from '../acc/rules';
import { createPaymentVoucherCore } from '../scm/routes/payment-vouchers';
import { projectLimit } from './project-limit';
import { topUpAmount } from './petty-cash';
import { postReceiptJournal, postWriteOffJournal } from './petty-cash-ledger';
import { RECEIPT_COLS, departmentNames, filesOf, floatBalances, floatsOf, linesOf, monthRange, receiptView, staffNames, type FloatRow, type ReceiptRow } from './petty-cash-store';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
export const EDIT_KEY = 'scm.payment_voucher.write';
export const FULL_KEY = 'scm.payment_voucher.approve';
const who = (c: Ctx): string => String(c.get('houzsUser')?.name ?? c.get('houzsUser')?.email ?? 'unknown');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const forbid = (c: Ctx) => c.json({ error: 'forbidden', message: "You don't have permission to do this." }, 403);
const bodyOf = async (c: Ctx): Promise<Record<string, unknown> | null> => { try { return await c.req.json(); } catch { return null; } };
const sen = (v: unknown): number | null => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null);

/** How the drafts are made — the payment voucher's own creation, so a top-up is an ordinary voucher. Replaceable in tests. */
export const claimsDeps = {
  createVoucher: async (c: Ctx, body: Record<string, unknown>): Promise<{ ok: true; id: string; pvNumber: string } | { ok: false; status: number; body: unknown }> => {
    const res = (await createPaymentVoucherCore(c, body)) as Response;
    const json = (await res.json()) as Record<string, unknown>;
    return res.status === 201 ? { ok: true, id: String(json.id), pvNumber: String(json.pvNumber) } : { ok: false, status: res.status, body: json };
  },
};

async function loadFloat(c: Ctx, companyId: number): Promise<FloatRow | null> {
  const { data } = await c.get('supabase').from('petty_cash_floats').select('*').eq('company_id', companyId).eq('id', c.req.param('id')).maybeSingle();
  return (data as FloatRow | null) ?? null;
}
async function loadReceipt(c: Ctx, companyId: number, id: string): Promise<ReceiptRow | null> {
  const { data } = await c.get('supabase').from('staff_receipts').select(RECEIPT_COLS).eq('company_id', companyId).eq('id', id).maybeSingle();
  return (data as ReceiptRow | null) ?? null;
}

/** Receipts with their lines, files, names, and an over-limit flag on any project already past its limit. */
async function receiptViews(sb: any, companyId: number, rows: ReceiptRow[]) {
  const ids = rows.map(r => r.id);
  const [lines, files, names] = await Promise.all([linesOf(sb, ids), filesOf(sb, ids), staffNames(sb)]);
  const projects = [...new Set([...lines.values()].flat().map(l => l.project_id).filter((p): p is number => p != null))];
  const over = new Set<number>();
  for (const p of projects) {
    const lim = await projectLimit(sb, companyId, Number(p));
    if (lim.ok && lim.leftSen < 0) over.add(Number(p));
  }
  return rows.map(r => {
    const ls = lines.get(r.id) ?? [];
    return { ...receiptView(r, ls, files.get(r.id) ?? [], names), overLimit: ls.some(l => l.project_id != null && over.has(Number(l.project_id))) };
  });
}

export const listFloatsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const floats = await floatsOf(sb, co.companyId);
  const [bal, names, depts, { data: waiting }] = await Promise.all([
    floatBalances(sb, floats), staffNames(sb), departmentNames(sb),
    sb.from('staff_receipts').select('float_id, amount_sen').eq('company_id', co.companyId).eq('status', 'HANDED_IN').not('float_id', 'is', null),
  ]);
  const rows = floats.map(f => {
    const w = ((waiting ?? []) as Array<{ float_id: string; amount_sen: number }>).filter(r => r.float_id === f.id);
    const b = bal.get(f.id)!;
    return {
      id: f.id, departmentId: f.department_id, departmentName: depts.get(f.department_id) ?? '', keeperUserId: f.keeper_user_id,
      keeperName: names.get(f.keeper_user_id) ?? '', floatSen: Number(f.float_sen), warnPct: Number(f.warn_pct), active: f.active,
      balanceSen: b.balanceSen, low: b.low, lastTopUpOn: b.lastTopUpOn, topUpRequested: f.topup_requested_at != null,
      waitingCheckSen: w.reduce((n, r) => n + Number(r.amount_sen), 0), waitingCheckCount: w.length,
    };
  });
  const live = rows.filter(r => r.active);
  return c.json({ floats: rows, totals: { floatSen: live.reduce((n, r) => n + r.floatSen, 0), balanceSen: live.reduce((n, r) => n + r.balanceSen, 0), waitingCheckSen: live.reduce((n, r) => n + r.waitingCheckSen, 0) } });
};

export const createFloatHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, FULL_KEY)) return forbid(c);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const b = await bodyOf(c);
  const departmentId = String(b?.departmentId ?? '').trim();
  const keeperUserId = String(b?.keeperUserId ?? '').trim();
  const floatSen = sen(b?.floatSen);
  const warnPct = b?.warnPct == null ? 20 : Number(b.warnPct);
  if (!departmentId || !keeperUserId || floatSen == null || !(Number.isInteger(warnPct) && warnPct >= 0 && warnPct <= 100)) {
    return c.json({ error: 'validation', message: 'Pick the department and the keeper, and enter the float.' }, 422);
  }
  const sb = c.get('supabase');
  const live = await floatsOf(sb, co.companyId, { activeOnly: true });
  if (live.some(f => f.department_id === departmentId)) return c.json({ error: 'department_has_float', message: 'This department already has a petty cash float.' }, 409);
  if (live.some(f => f.keeper_user_id === keeperUserId)) return c.json({ error: 'keeper_has_float', message: 'This person already keeps a petty cash float.' }, 409);
  const { data, error } = await sb.from('petty_cash_floats').insert({
    company_id: co.companyId, department_id: departmentId, keeper_user_id: keeperUserId, float_sen: floatSen, warn_pct: warnPct, active: true, created_by: who(c),
  }).select('*').single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  return c.json({ float: data }, 201);
};

export const updateFloatHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, FULL_KEY)) return forbid(c);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const f = await loadFloat(c, co.companyId);
  if (!f) return c.json({ error: 'not_found' }, 404);
  const b = (await bodyOf(c)) ?? {};
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (b.floatSen !== undefined) { const v = sen(b.floatSen); if (v == null) return c.json({ error: 'validation', message: 'Enter the float.' }, 422); patch.float_sen = v; }
  if (b.warnPct !== undefined) { const v = Number(b.warnPct); if (!(Number.isInteger(v) && v >= 0 && v <= 100)) return c.json({ error: 'validation' }, 422); patch.warn_pct = v; }
  if (b.active !== undefined) patch.active = b.active === true;
  if (b.keeperUserId !== undefined) {
    const k = String(b.keeperUserId).trim();
    if (!k) return c.json({ error: 'validation', message: 'Pick the keeper.' }, 422);
    const live = await floatsOf(c.get('supabase'), co.companyId, { activeOnly: true });
    if (live.some(x => x.id !== f.id && x.keeper_user_id === k)) return c.json({ error: 'keeper_has_float', message: 'This person already keeps a petty cash float.' }, 409);
    patch.keeper_user_id = k;
  }
  const { data, error } = await c.get('supabase').from('petty_cash_floats').update(patch).eq('id', f.id).select('*').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ float: data });
};

export const floatReceiptsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const f = await loadFloat(c, co.companyId);
  if (!f) return c.json({ error: 'not_found' }, 404);
  const sb = c.get('supabase');
  let q = sb.from('staff_receipts').select(RECEIPT_COLS).eq('company_id', co.companyId).eq('float_id', f.id);
  const m = monthRange(c.req.query('month'));
  if (m) q = q.gte('spend_date', m.from).lt('spend_date', m.to);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const rows = ((data ?? []) as ReceiptRow[]).sort((a, b) => String(b.spend_date).localeCompare(String(a.spend_date)) || b.receipt_no.localeCompare(a.receipt_no));
  const [bal, names, depts] = await Promise.all([floatBalances(sb, [f]), staffNames(sb), departmentNames(sb)]);
  return c.json({
    float: { id: f.id, departmentName: depts.get(f.department_id) ?? '', keeperName: names.get(f.keeper_user_id) ?? '', floatSen: Number(f.float_sen), ...bal.get(f.id) },
    receipts: await receiptViews(sb, co.companyId, rows),
  });
};

export const financeReceiptsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  let q = sb.from('staff_receipts').select(RECEIPT_COLS).eq('company_id', co.companyId).is('float_id', null);
  const m = monthRange(c.req.query('month'));
  if (m) q = q.gte('spend_date', m.from).lt('spend_date', m.to);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const rows = ((data ?? []) as ReceiptRow[]).sort((a, b) => String(a.spend_date).localeCompare(String(b.spend_date)));
  return c.json({ receipts: await receiptViews(sb, co.companyId, rows) });
};

type LineIn = { department?: unknown; unitId?: unknown; maintenanceIssueId?: unknown; projectId?: unknown; accountCode?: unknown; amountSen?: unknown; description?: unknown };
const DEPTS = new Set(['rental', 'supply', 'shared']);
/** Lines finance corrected while checking; null when any is malformed. */
export function parseLines(raw: unknown): Array<{ department: string; unit_id: string | null; maintenance_issue_id: string | null; project_id: number | null; account_code: string | null; amount_sen: number; description: string | null; sort: number }> | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return null;
  const out = [];
  for (const [i, l] of (raw as LineIn[]).entries()) {
    const amount = Number(l.amountSen);
    if (!DEPTS.has(String(l.department)) || !(Number.isInteger(amount) && amount > 0)) return null;
    const project = l.projectId == null || l.projectId === '' ? null : Number(l.projectId);
    if (project != null && !(Number.isInteger(project) && project > 0)) return null;
    out.push({
      department: String(l.department), unit_id: l.unitId ? String(l.unitId) : null, maintenance_issue_id: l.maintenanceIssueId ? String(l.maintenanceIssueId) : null,
      project_id: project, account_code: l.accountCode ? String(l.accountCode).trim() : null, amount_sen: amount,
      description: l.description ? String(l.description).slice(0, 300) : null, sort: i,
    });
  }
  return out;
}

export const checkReceiptsHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, EDIT_KEY)) return forbid(c);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const b = await bodyOf(c);
  const items = Array.isArray(b?.items) ? (b!.items as Array<Record<string, unknown>>) : [];
  if (items.length === 0 || items.length > 200) return c.json({ error: 'validation', message: 'Pick the receipts to check.' }, 422);
  const sb = c.get('supabase');
  const results: Array<{ id: string; ok: boolean; error?: string; message?: string }> = [];
  for (const it of items) {
    const id = String(it.id ?? '');
    const r = await loadReceipt(c, co.companyId, id);
    if (!r) { results.push({ id, ok: false, error: 'not_found' }); continue; }
    if (r.status !== 'HANDED_IN') { results.push({ id, ok: false, error: 'not_waiting', message: `${r.receipt_no} is not waiting for a check.` }); continue; }
    let lines = (await linesOf(sb, [r.id])).get(r.id) ?? [];
    let amount = Number(r.amount_sen);
    if (it.lines !== undefined) {
      const parsed = parseLines(it.lines);
      if (!parsed) { results.push({ id, ok: false, error: 'lines_invalid', message: `${r.receipt_no}: check the lines.` }); continue; }
      amount = parsed.reduce((n, l) => n + l.amount_sen, 0);
      const del = await sb.from('staff_receipt_lines').delete().eq('receipt_id', r.id);
      if (del.error) { results.push({ id, ok: false, error: 'update_failed', message: del.error.message }); continue; }
      const ins = await sb.from('staff_receipt_lines').insert(parsed.map(l => ({ ...l, receipt_id: r.id }))).select('*');
      if (ins.error) { results.push({ id, ok: false, error: 'update_failed', message: ins.error.message }); continue; }
      lines = ins.data;
    } else if (it.amountSen !== undefined) {
      /* A corrected amount with one line moves that line with it; with several lines the lines must be sent. */
      const v = Number(it.amountSen);
      if (!(Number.isInteger(v) && v > 0) || lines.length !== 1) { results.push({ id, ok: false, error: 'lines_invalid', message: `${r.receipt_no}: send the lines with the new amount.` }); continue; }
      amount = v;
      const up = await sb.from('staff_receipt_lines').update({ amount_sen: v }).eq('id', lines[0].id);
      if (up.error) { results.push({ id, ok: false, error: 'update_failed', message: up.error.message }); continue; }
      lines = [{ ...lines[0], amount_sen: v }];
    }
    if (lines.some(l => !l.account_code)) { results.push({ id, ok: false, error: 'account_missing', message: `${r.receipt_no}: choose the account on every line.` }); continue; }
    let jeId: string | null = null;
    if (r.float_id) {
      const je = await postReceiptJournal(sb, co.companyId, { receiptNo: r.receipt_no, spendDate: String(r.spend_date).slice(0, 10),
        lines: lines.map(l => ({ accountCode: String(l.account_code), amountSen: Number(l.amount_sen), department: l.department, description: l.description })) });
      if (!je.ok) { results.push({ id, ok: false, error: 'journal_failed', message: `${r.receipt_no}: ${(je as { reason?: string }).reason ?? je.status}` }); continue; }
      jeId = (je as { jeId?: string }).jeId ?? null;
    }
    const up = await sb.from('staff_receipts').update({ status: 'CHECKED', amount_sen: amount, checked_at: new Date().toISOString(), checked_by: who(c), je_id: jeId, updated_at: new Date().toISOString() })
      .eq('id', r.id).eq('status', 'HANDED_IN');
    results.push(up.error ? { id, ok: false, error: 'update_failed', message: up.error.message } : { id, ok: true });
  }
  return c.json({ results }, results.every(x => x.ok) ? 200 : 207);
};

export const rejectReceiptHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, EDIT_KEY)) return forbid(c);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const reason = String((await bodyOf(c))?.reason ?? '').trim();
  if (!reason) return c.json({ error: 'reason_required', message: 'Say why the receipt is rejected.' }, 422);
  const r = await loadReceipt(c, co.companyId, c.req.param('id'));
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (r.status !== 'HANDED_IN') return c.json({ error: 'not_waiting', message: 'Only a receipt waiting for a check can be rejected.' }, 409);
  const { error } = await c.get('supabase').from('staff_receipts').update({ status: 'REJECTED', reject_reason: reason.slice(0, 500), checked_by: who(c), checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', r.id).eq('status', 'HANDED_IN');
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ ok: true });
};

export const repaidReceiptHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, EDIT_KEY)) return forbid(c);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const b = (await bodyOf(c)) ?? {};
  const date = DATE.test(String(b.date ?? '')) ? String(b.date) : todayMyt();
  const r = await loadReceipt(c, co.companyId, c.req.param('id'));
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (r.status !== 'REJECTED' || !r.float_id) return c.json({ error: 'not_rejected', message: 'Only a rejected receipt paid from a float can be repaid.' }, 409);
  const sb = c.get('supabase');
  const up = await sb.from('staff_receipts').update({ status: 'REPAID', updated_at: new Date().toISOString() }).eq('id', r.id).eq('status', 'REJECTED');
  if (up.error) return c.json({ error: 'update_failed', reason: up.error.message }, 500);
  const ev = await sb.from('petty_cash_events').insert({ float_id: r.float_id, kind: 'REPAID', amount_sen: Number(r.amount_sen), receipt_id: r.id, event_date: date, created_by: who(c) });
  if (ev.error) return c.json({ error: 'insert_failed', reason: ev.error.message }, 500);
  return c.json({ ok: true });
};

export const writeOffReceiptHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, FULL_KEY)) return forbid(c);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const b = (await bodyOf(c)) ?? {};
  const accountCode = String(b.accountCode ?? '').trim();
  if (!accountCode) return c.json({ error: 'validation', message: 'Choose the account the loss is written off to.' }, 422);
  const date = DATE.test(String(b.date ?? '')) ? String(b.date) : todayMyt();
  const r = await loadReceipt(c, co.companyId, c.req.param('id'));
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (r.status !== 'REJECTED' || !r.float_id) return c.json({ error: 'not_rejected', message: 'Only a rejected receipt paid from a float can be written off.' }, 409);
  const sb = c.get('supabase');
  const je = await postWriteOffJournal(sb, co.companyId, { receiptNo: r.receipt_no, amountSen: Number(r.amount_sen), accountCode, date });
  if (!je.ok) return c.json({ error: 'journal_failed', message: (je as { reason?: string }).reason ?? je.status }, 409);
  const up = await sb.from('staff_receipts').update({ status: 'WRITTEN_OFF', writeoff_account_code: accountCode, writeoff_je_id: (je as { jeId?: string }).jeId ?? null, updated_at: new Date().toISOString() }).eq('id', r.id);
  if (up.error) return c.json({ error: 'update_failed', reason: up.error.message }, 500);
  return c.json({ ok: true });
};

export const returnedHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, EDIT_KEY)) return forbid(c);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const f = await loadFloat(c, co.companyId);
  if (!f) return c.json({ error: 'not_found' }, 404);
  const b = (await bodyOf(c)) ?? {};
  const amount = Number(b.amountSen);
  if (!(Number.isInteger(amount) && amount > 0) || !DATE.test(String(b.date ?? ''))) return c.json({ error: 'validation', message: 'Enter the amount and the date.' }, 422);
  const { error } = await c.get('supabase').from('petty_cash_events').insert({ float_id: f.id, kind: 'RETURNED', amount_sen: amount, event_date: String(b.date), note: b.note ? String(b.note).slice(0, 300) : null, created_by: who(c) });
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  return c.json({ ok: true }, 201);
};

export const topUpHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, FULL_KEY)) return forbid(c);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const f = await loadFloat(c, co.companyId);
  if (!f || !f.active) return c.json({ error: 'not_found' }, 404);
  const bank = String((await bodyOf(c))?.bankAccountCode ?? '').trim();
  if (!bank) return c.json({ error: 'validation', message: 'Choose the bank the top-up is paid from.' }, 422);
  const sb = c.get('supabase');
  /* One top-up at a time: a draft already raised for this float is finished or cancelled first. */
  const { data: open } = await sb.from('payment_vouchers').select('id, pv_number, status').eq('company_id', co.companyId).eq('petty_cash_float_id', f.id).eq('status', 'DRAFT');
  if ((open ?? []).length > 0) return c.json({ error: 'top_up_open', message: `Voucher ${(open as Array<{ pv_number: string }>)[0].pv_number} already tops this float up.` }, 409);
  const bal = (await floatBalances(sb, [f])).get(f.id)!;
  const amount = topUpAmount(Number(f.float_sen), bal.balanceSen);
  if (amount <= 0) return c.json({ error: 'nothing_to_top_up', message: 'The float is already at its amount.' }, 409);
  const [{ data: checked }, names, depts, roles] = await Promise.all([
    sb.from('staff_receipts').select('receipt_no').eq('company_id', co.companyId).eq('float_id', f.id).eq('status', 'CHECKED'),
    staffNames(sb), departmentNames(sb), resolveRoles(sb, co.companyId),
  ]);
  const nos = ((checked ?? []) as Array<{ receipt_no: string }>).map(r => r.receipt_no).sort();
  const made = await claimsDeps.createVoucher(c, {
    payeeName: names.get(f.keeper_user_id) || 'Petty cash keeper', creditAccountCode: bank, purpose: 'OTHER',
    lines: [{ debitAccountCode: roles.PETTY_CASH, amountSen: amount, description: `Petty cash top-up — ${depts.get(f.department_id) ?? 'department'}`, department: 'shared' }],
    notes: nos.length ? `Top-up for receipts ${nos.join(', ')}` : 'Petty cash float',
  });
  if (!made.ok) return c.json(made.body, made.status as 400);
  const link = await sb.from('payment_vouchers').update({ petty_cash_float_id: f.id }).eq('id', made.id);
  if (link.error) return c.json({ error: 'update_failed', reason: link.error.message }, 500);
  await sb.from('petty_cash_floats').update({ topup_requested_at: null }).eq('id', f.id);
  return c.json({ pvId: made.id, pvNumber: made.pvNumber, amountSen: amount }, 201);
};

/** Bank details for paying a person back: finance's own record first, else the HR employee record. */
export async function bankDetailsOf(sb: any, companyId: number, userId: string): Promise<{ bankName: string; accountNo: string; accountName: string | null } | null> {
  const { data: own } = await sb.from('staff_bank_details').select('bank_name, account_no, account_name').eq('company_id', companyId).eq('user_id', userId).maybeSingle();
  if (own) return { bankName: own.bank_name, accountNo: own.account_no, accountName: own.account_name };
  const { data: hr } = await sb.schema('public').from('conts_employee_bank').select('bank_name, bank_account').eq('user_id', userId).maybeSingle();
  return hr?.bank_account ? { bankName: String(hr.bank_name ?? ''), accountNo: String(hr.bank_account), accountName: null } : null;
}

export const receiptVoucherHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, FULL_KEY)) return forbid(c);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const bank = String((await bodyOf(c))?.bankAccountCode ?? '').trim();
  if (!bank) return c.json({ error: 'validation', message: 'Choose the bank the person is paid from.' }, 422);
  const sb = c.get('supabase');
  const r = await loadReceipt(c, co.companyId, c.req.param('id'));
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (r.float_id) return c.json({ error: 'paid_from_float', message: 'This receipt is paid from petty cash.' }, 409);
  if (r.status !== 'CHECKED' || r.payback_pv_id) return c.json({ error: 'not_checked', message: 'Check the receipt before paying it back.' }, 409);
  const details = await bankDetailsOf(sb, co.companyId, r.submitter_user_id);
  if (!details) return c.json({ error: 'bank_details_missing', message: 'Bank details missing — add them before paying this person back.' }, 409);
  const lines = (await linesOf(sb, [r.id])).get(r.id) ?? [];
  const names = await staffNames(sb);
  const projects = [...new Set(lines.map(l => l.project_id).filter(p => p != null))];
  const made = await claimsDeps.createVoucher(c, {
    payeeName: names.get(r.submitter_user_id) || 'Staff', creditAccountCode: bank, purpose: 'OTHER',
    projectId: projects.length === 1 ? projects[0] : undefined,
    lines: lines.map(l => ({ debitAccountCode: l.account_code, amountSen: Number(l.amount_sen), description: l.description ?? `Receipt ${r.receipt_no}`, department: l.department })),
    notes: `Pays back receipt ${r.receipt_no}. Bank: ${details.bankName} ${details.accountNo}${details.accountName ? ` (${details.accountName})` : ''}`,
  });
  if (!made.ok) return c.json(made.body, made.status as 400);
  const link = await sb.from('payment_vouchers').update({ staff_receipt_id: r.id }).eq('id', made.id);
  if (link.error) return c.json({ error: 'update_failed', reason: link.error.message }, 500);
  const up = await sb.from('staff_receipts').update({ payback_pv_id: made.id, updated_at: new Date().toISOString() }).eq('id', r.id);
  if (up.error) return c.json({ error: 'update_failed', reason: up.error.message }, 500);
  return c.json({ pvId: made.id, pvNumber: made.pvNumber }, 201);
};

export const listOverridesHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data, error } = await c.get('supabase').from('petty_cash_overrides').select('user_id, float_id').eq('company_id', co.companyId);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ overrides: ((data ?? []) as Array<{ user_id: string; float_id: string }>).map(o => ({ userId: o.user_id, floatId: o.float_id })) });
};

export const putOverridesHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, FULL_KEY)) return forbid(c);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const list = (await bodyOf(c))?.overrides;
  if (!Array.isArray(list) || list.length > 500) return c.json({ error: 'validation' }, 422);
  const rows = (list as Array<{ userId?: unknown; floatId?: unknown }>).map(o => ({ company_id: co.companyId, user_id: String(o.userId ?? '').trim(), float_id: String(o.floatId ?? '').trim() }));
  if (rows.some(r => !r.user_id || !r.float_id) || new Set(rows.map(r => r.user_id)).size !== rows.length) return c.json({ error: 'validation', message: 'Each person once, with a float.' }, 422);
  const sb = c.get('supabase');
  const floats = new Set((await floatsOf(sb, co.companyId, { activeOnly: true })).map(f => f.id));
  if (rows.some(r => !floats.has(r.float_id))) return c.json({ error: 'validation', message: 'Point people at an active float.' }, 422);
  const del = await sb.from('petty_cash_overrides').delete().eq('company_id', co.companyId);
  if (del.error) return c.json({ error: 'update_failed', reason: del.error.message }, 500);
  if (rows.length) { const ins = await sb.from('petty_cash_overrides').insert(rows); if (ins.error) return c.json({ error: 'update_failed', reason: ins.error.message }, 500); }
  return c.json({ ok: true });
};

export const getStaffBankHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  return c.json({ details: await bankDetailsOf(c.get('supabase'), co.companyId, c.req.param('userId')) });
};

export const putStaffBankHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, FULL_KEY)) return forbid(c);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const b = (await bodyOf(c)) ?? {};
  const bankName = String(b.bankName ?? '').trim();
  const accountNo = String(b.accountNo ?? '').replace(/\s+/g, '');
  const accountName = String(b.accountName ?? '').trim();
  if (!bankName || !/^\d{6,20}$/.test(accountNo) || !accountName) return c.json({ error: 'validation', message: 'Enter the bank, the account number (digits only) and the name on the account.' }, 422);
  const { error } = await c.get('supabase').from('staff_bank_details').upsert({
    company_id: co.companyId, user_id: c.req.param('userId'), bank_name: bankName, account_no: accountNo, account_name: accountName,
    checked_by: who(c), checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'company_id,user_id' });
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ ok: true });
};
