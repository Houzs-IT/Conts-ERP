// Conts only (not part of Houzs's code): Debtors — finance's list of customers, each under its control (finance
// phase 1.5, spec docs/superpowers/specs/2026-10-23-finance-debtors-contracts-design.md 2.1; SOP 2.1). Mounted under
// /accounting, so the Ledger guard (ledger-access.ts) stands in front; writing needs the post key, as the chart does.
//   GET   /accounting/debtors?control=&q=&active=   the customers grouped by control, as AutoCount shows them
//   POST  /accounting/debtors                       a new customer (no code → the next one under its control)
//   PATCH /accounting/debtors/:id                   name, contact, notes, active; another control only once nothing
//                                                   is owing on the old one (it could not follow: manual journals
//                                                   may not touch a control)
//   Both take the e-invoice tax identity: tin, idType, idNumber, sstNo (acc/einvoice-identity.ts).
import { hasHouzsPerm } from '../scm/lib/houzs-perms';
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { paginateAll } from '../scm/lib/paginate-all';
import { resolveRoles } from '../acc/rules';
import { debtorLetter, nextPartyCode, partyBalanceOn } from './parties';
import { taxIdentityPatch } from '../acc/einvoice-identity';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
const NO_PERM = { error: "You don't have permission to change customers." };
const canWrite = (c: Ctx) => hasHouzsPerm(c, 'scm.payment_voucher.post');

type DebtorRow = {
  id: string; code: string; name: string; control_account: string; customer_id: string | null;
  phone: string | null; email: string | null; address: string | null; notes: string | null; is_active: boolean;
  tin: string | null; id_type: string | null; id_number: string | null; sst_no: string | null;
};
const COLS = 'id, code, name, control_account, customer_id, phone, email, address, notes, is_active, tin, id_type, id_number, sst_no';
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The customer controls of the chart (special type SDC), by code — less the Other Debtors control, which keeps the
    Other Debtors register's own bills (its control check accepts only those). */
async function customerControls(sb: any, companyId: number): Promise<{ ok: true; byCode: Map<string, string> } | { ok: false; error: string }> {
  const [{ data, error }, roles] = await Promise.all([
    sb.from('accounts').select('account_code, account_name, special_type').eq('company_id', companyId).eq('special_type', 'SDC'),
    resolveRoles(sb, companyId),
  ]);
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    byCode: new Map(((data ?? []) as Array<{ account_code: string; account_name: string | null }>)
      .filter((a) => a.account_code !== roles.AR_OTHER)
      .map((a) => [a.account_code, a.account_name ?? a.account_code])),
  };
}

export const listDebtorsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const control = String(c.req.query('control') ?? '').trim();
  const q = String(c.req.query('q') ?? '').trim().toUpperCase();
  const active = String(c.req.query('active') ?? 'all');
  const [ctl, rows] = await Promise.all([
    customerControls(sb, co.companyId),
    paginateAll((from, to) => sb.from('debtors').select(COLS).eq('company_id', co.companyId).order('code').range(from, to)),
  ]);
  if (!ctl.ok) return c.json({ error: 'load_failed', reason: ctl.error }, 500);
  if (rows.error) return c.json({ error: 'load_failed', reason: (rows.error as { message?: string }).message ?? '' }, 500);
  const debtors = ((rows.data ?? []) as DebtorRow[])
    .filter((d) => !control || d.control_account === control)
    .filter((d) => active === 'all' || (active === 'yes' ? d.is_active : !d.is_active))
    .filter((d) => !q || d.code.toUpperCase().includes(q) || d.name.toUpperCase().includes(q) || String(d.phone ?? '').includes(q));
  const codes = [...new Set([...ctl.byCode.keys(), ...debtors.map((d) => d.control_account)])]
    .filter((code) => !control || code === control).sort();
  return c.json({
    controls: codes
      .map((code) => ({ code, name: ctl.byCode.get(code) ?? code, debtors: debtors.filter((d) => d.control_account === code) }))
      .filter((g) => g.debtors.length > 0 || (!q && active === 'all')),
  });
};

export const createDebtorHandler = async (c: Ctx): Promise<Response> => {
  if (!canWrite(c)) return c.json(NO_PERM, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const name = text(body.name);
  const control = text(body.controlAccount);
  if (!name) return c.json({ error: 'name_required', message: 'A customer needs a name.' }, 400);
  const sb = c.get('supabase');
  const ctl = await customerControls(sb, co.companyId);
  if (!ctl.ok) return c.json({ error: 'load_failed', reason: ctl.error }, 500);
  if (!control || !ctl.byCode.has(control)) {
    return c.json({ error: 'not_a_customer_control', message: `${control ?? 'No control'} is not a customer control (SDC) of the chart.` }, 400);
  }
  const typed = text(body.code)?.toUpperCase() ?? null;
  if (typed && !typed.startsWith(`${control.slice(0, 3)}-`)) {
    return c.json({ error: 'code_not_under_control', message: `${typed} does not sit under ${control}: a code under it starts ${control.slice(0, 3)}-.` }, 400);
  }
  const tax = taxIdentityPatch(body, null);
  if (!tax.ok) return c.json({ error: tax.error, message: tax.message }, 400);
  const fields = {
    company_id: co.companyId, name, control_account: control, phone: text(body.phone), email: text(body.email),
    address: text(body.address), notes: text(body.notes), is_active: true, ...tax.patch,
  };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let code = typed;
    if (!code) {
      const letter = debtorLetter(name);
      const { data, error } = await sb.from('debtors').select('code').eq('company_id', co.companyId).like('code', `${control.slice(0, 3)}-${letter}%`);
      if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
      code = nextPartyCode(control.slice(0, 3), letter, ((data ?? []) as Array<{ code: string }>).map((d) => d.code));
    }
    const { data: made, error } = await sb.from('debtors').insert({ ...fields, code }).select(COLS).single();
    if (!error) return c.json({ debtor: made }, 201);
    if (error.code !== '23505') return c.json({ error: 'insert_failed', reason: error.message }, 500);
    if (typed) return c.json({ error: 'duplicate_code', message: `${typed} is already a customer's code.` }, 409);
  }
  return c.json({ error: 'insert_failed', reason: 'No free customer code; try again.' }, 500);
};

export const patchDebtorHandler = async (c: Ctx): Promise<Response> => {
  if (!canWrite(c)) return c.json(NO_PERM, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const sb = c.get('supabase');
  const id = c.req.param('id');
  const { data: cur, error: curErr } = await sb.from('debtors').select(COLS).eq('company_id', co.companyId).eq('id', id).maybeSingle();
  if (curErr) return c.json({ error: 'load_failed', reason: curErr.message }, 500);
  if (!cur) return c.json({ error: 'not_found' }, 404);
  const row = cur as DebtorRow;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    const name = text(body.name);
    if (!name) return c.json({ error: 'name_required', message: 'A customer needs a name.' }, 400);
    patch.name = name;
  }
  for (const [from, to] of [['phone', 'phone'], ['email', 'email'], ['address', 'address'], ['notes', 'notes']] as const) {
    if (body[from] !== undefined) patch[to] = text(body[from]);
  }
  if (body.isActive !== undefined) patch.is_active = body.isActive === true;
  const tax = taxIdentityPatch(body, row.id_type);
  if (!tax.ok) return c.json({ error: tax.error, message: tax.message }, 400);
  Object.assign(patch, tax.patch);
  if (body.controlAccount !== undefined && body.controlAccount !== row.control_account) {
    const control = text(body.controlAccount);
    const ctl = await customerControls(sb, co.companyId);
    if (!ctl.ok) return c.json({ error: 'load_failed', reason: ctl.error }, 500);
    if (!control || !ctl.byCode.has(control)) {
      return c.json({ error: 'not_a_customer_control', message: `${control ?? 'No control'} is not a customer control (SDC) of the chart.` }, 400);
    }
    /* What this customer owes cannot follow it (manual journals may not touch a control), so it moves only once
       nothing is left on the old one; its settled history stays there. */
    const bal = await partyBalanceOn(sb, co.companyId, row.code, row.control_account);
    if (!bal.ok) return c.json({ error: 'load_failed', reason: bal.error }, 500);
    if (bal.balanceSen !== 0) {
      return c.json({
        error: 'debtor_has_balance', accountCode: row.control_account, balanceSen: bal.balanceSen,
        message: `${row.code} still has a balance on ${row.control_account}. Settle it there first, then move the customer to ${control}.`,
      }, 409);
    }
    patch.control_account = control;
  }
  const { data: saved, error } = await sb.from('debtors').update(patch).eq('company_id', co.companyId).eq('id', id).select(COLS).maybeSingle();
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  return c.json({ debtor: saved });
};
