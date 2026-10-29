// Conts only (not part of Houzs's code): the project limit (finance phase 1.5; SOP 3.4, chew 20-25 Oct 2026). A
// payment voucher for a project must stay within its limit:
//   a customer project: limit = what the customer has paid × the project's share (its own, else the company's, 70%)
//                       + extra amounts approved;
//   an internal project (the company's own money): limit = its budget + extra budget approved;
//   used     = the project's lines on POSTED vouchers;  reserved = its lines on vouchers submitted, not yet posted;
//   left     = limit − used − reserved.
// A voucher's project amount is its lines naming the project (payment_voucher_lines.project_id), less lines on an
// everyday-expense account (rent, utilities: paid as usual, outside the limit). Reservation follows the voucher's
// state, so a rejected or withdrawn voucher (submitted_at cleared) gives its reservation back by itself.
import { paginateAll } from '../scm/lib/paginate-all';
import { receiptCountsForLimit, type ReceiptStatus } from './petty-cash';
import { requestReservation } from './payment-requests';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as in the modules it sits beside */
type Db = any;
type Fail = { ok: false; error: string };

export const DEFAULT_LIMIT_PCT_BP = 7000;

export type ProjectLimit = {
  ok: true; projectId: number; projectName: string; funding: 'customer' | 'internal';
  pctBp: number | null; receivedSen: number | null; limitSen: number; usedSen: number; reservedSen: number; leftSen: number;
};

type PvLine = { pv_id: string; project_id: number | null; amount_sen: number; debit_account_code: string };
type Pv = { id: string; status: string; submitted_at: string | null; staff_receipt_id?: string | null };

/** The project's lines on every voucher, with each voucher's state; everyday-expense lines left out. */
async function projectLines(sb: Db, companyId: number, projectIds: number[]): Promise<{ ok: true; lines: Array<PvLine & { pv: Pv }> } | Fail> {
  const read = await paginateAll<PvLine>((f, t) => sb.from('payment_voucher_lines').select('pv_id, project_id, amount_sen, debit_account_code')
    .eq('company_id', companyId).in('project_id', projectIds).order('pv_id').range(f, t));
  if (read.error) return { ok: false, error: String((read.error as { message?: string }).message ?? read.error) };
  const lines = (read.data ?? []) as PvLine[];
  if (lines.length === 0) return { ok: true, lines: [] };
  const [pvs, accts] = await Promise.all([
    sb.from('payment_vouchers').select('id, status, submitted_at, staff_receipt_id').eq('company_id', companyId).in('id', [...new Set(lines.map((l) => l.pv_id))]),
    sb.from('accounts').select('account_code, everyday_expense').eq('company_id', companyId).in('account_code', [...new Set(lines.map((l) => l.debit_account_code))]),
  ]);
  if (pvs.error) return { ok: false, error: pvs.error.message };
  if (accts.error) return { ok: false, error: accts.error.message };
  const pvOf = new Map(((pvs.data ?? []) as Pv[]).map((p) => [p.id, p]));
  const everyday = new Set(((accts.data ?? []) as Array<{ account_code: string; everyday_expense: boolean | null }>).filter((a) => a.everyday_expense === true).map((a) => a.account_code));
  return {
    ok: true,
    /* A voucher paying a staff receipt back counts once it has posted; until then the receipt itself counts. */
    lines: lines.filter((l) => !everyday.has(l.debit_account_code) && pvOf.has(l.pv_id) && !(pvOf.get(l.pv_id)!.staff_receipt_id && pvOf.get(l.pv_id)!.status !== 'POSTED')).map((l) => ({ ...l, pv: pvOf.get(l.pv_id)! })),
  };
}

/** Staff receipts and payment requests on a project (design 2026-10-28 §4.5-4.6). A receipt's money is already spent,
 *  so it is used from the moment it is handed in, until its own pay-back voucher counts instead. A request reserves only
 *  what its vouchers (not cancelled) do not yet carry. Everyday-expense lines are left out, as on vouchers. */
async function claimsOnProject(sb: Db, companyId: number, projectId: number): Promise<{ ok: true; usedSen: number; reservedSen: number } | Fail> {
  const [rl, ql] = await Promise.all([
    paginateAll<{ receipt_id: string; amount_sen: number; account_code: string | null }>((f, t) => sb.from('staff_receipt_lines').select('id, receipt_id, amount_sen, account_code').eq('project_id', projectId).order('id').range(f, t)),
    paginateAll<{ request_id: string; amount_sen: number; account_code: string | null }>((f, t) => sb.from('payment_request_lines').select('id, request_id, amount_sen, account_code').eq('project_id', projectId).order('id').range(f, t)),
  ]);
  if (rl.error) return { ok: false, error: rl.error.message };
  if (ql.error) return { ok: false, error: ql.error.message };
  const rLines = (rl.data ?? []) as Array<{ receipt_id: string; amount_sen: number; account_code: string | null }>;
  const qLines = (ql.data ?? []) as Array<{ request_id: string; amount_sen: number; account_code: string | null }>;
  if (rLines.length === 0 && qLines.length === 0) return { ok: true, usedSen: 0, reservedSen: 0 };
  const codes = [...new Set([...rLines, ...qLines].map((l) => l.account_code).filter((a): a is string => !!a))];
  const { data: accts, error: aErr } = codes.length
    ? await sb.from('accounts').select('account_code, everyday_expense').eq('company_id', companyId).in('account_code', codes)
    : { data: [], error: null };
  if (aErr) return { ok: false, error: aErr.message };
  const everyday = new Set(((accts ?? []) as Array<{ account_code: string; everyday_expense: boolean | null }>).filter((a) => a.everyday_expense === true).map((a) => a.account_code));
  const counted = <T extends { account_code: string | null }>(ls: T[]) => ls.filter((l) => !l.account_code || !everyday.has(l.account_code));

  let usedSen = 0;
  const rCounted = counted(rLines);
  if (rCounted.length) {
    const { data: rs, error } = await sb.from('staff_receipts').select('id, status, float_id').eq('company_id', companyId).in('id', [...new Set(rCounted.map((l) => l.receipt_id))]);
    if (error) return { ok: false, error: error.message };
    const live = new Set(((rs ?? []) as Array<{ id: string; status: ReceiptStatus; float_id: string | null }>)
      .filter((r) => receiptCountsForLimit({ status: r.status, floatId: r.float_id })).map((r) => r.id));
    usedSen = rCounted.filter((l) => live.has(l.receipt_id)).reduce((s, l) => s + Number(l.amount_sen), 0);
  }

  let reservedSen = 0;
  const qCounted = counted(qLines);
  if (qCounted.length) {
    const { data: qs, error } = await sb.from('payment_requests').select('id, status').eq('company_id', companyId).in('id', [...new Set(qCounted.map((l) => l.request_id))]);
    if (error) return { ok: false, error: error.message };
    const open = ((qs ?? []) as Array<{ id: string; status: string }>).filter((q) => q.status === 'SUBMITTED' || q.status === 'PART_PAID').map((q) => q.id);
    if (open.length) {
      const { data: pvs, error: pErr } = await sb.from('payment_vouchers').select('id, payment_request_id, status, submitted_at').eq('company_id', companyId).in('payment_request_id', open);
      if (pErr) return { ok: false, error: pErr.message };
      const vouchers = ((pvs ?? []) as Array<{ id: string; payment_request_id: string; status: string; submitted_at: string | null }>)
        /* Only vouchers that reserve or use the limit themselves take over from the request: posted, or submitted. */
        .filter((p) => p.status === 'POSTED' || (p.status === 'DRAFT' && !!p.submitted_at));
      const { data: vls, error: vErr } = vouchers.length
        ? await sb.from('payment_voucher_lines').select('pv_id, project_id, amount_sen').eq('company_id', companyId).in('pv_id', vouchers.map((p) => p.id))
        : { data: [], error: null };
      if (vErr) return { ok: false, error: vErr.message };
      const reqOfPv = new Map(vouchers.map((p) => [p.id, p.payment_request_id]));
      for (const q of open) {
        const own = qCounted.filter((l) => l.request_id === q).map((l) => ({ projectId: projectId, amountSen: Number(l.amount_sen) }));
        const paid = ((vls ?? []) as Array<{ pv_id: string; project_id: number | null; amount_sen: number }>)
          .filter((l) => reqOfPv.get(l.pv_id) === q).map((l) => ({ projectId: l.project_id == null ? null : Number(l.project_id), amountSen: Number(l.amount_sen) }));
        reservedSen += requestReservation(own, paid).get(projectId) ?? 0;
      }
    }
  }
  return { ok: true, usedSen, reservedSen };
}

/** What the customer of a project has paid: the payments on its sales orders and on their invoices. */
async function projectReceived(sb: Db, companyId: number, projectId: number): Promise<{ ok: true; sen: number } | Fail> {
  const { data: sos, error } = await sb.from('mfg_sales_orders').select('doc_no, status').eq('company_id', companyId).eq('project_id', projectId);
  if (error) return { ok: false, error: error.message };
  const docNos = ((sos ?? []) as Array<{ doc_no: string; status: string }>).filter((o) => String(o.status).toUpperCase() !== 'CANCELLED').map((o) => o.doc_no);
  if (docNos.length === 0) return { ok: true, sen: 0 };
  const [sop, sis] = await Promise.all([
    sb.from('mfg_sales_order_payments').select('amount_sen, method').eq('company_id', companyId).in('so_doc_no', docNos),
    sb.from('sales_invoices').select('id, status').eq('company_id', companyId).in('so_doc_no', docNos),
  ]);
  if (sop.error) return { ok: false, error: sop.error.message };
  if (sis.error) return { ok: false, error: sis.error.message };
  /* Every row: a 'converted' one is money moved in (positive) or out / refunded (negative) — SOP 4.4: a refund lowers the limit. */
  let sen = ((sop.data ?? []) as Array<{ amount_sen: number }>).reduce((s, p) => s + Number(p.amount_sen ?? 0), 0);
  const siIds = ((sis.data ?? []) as Array<{ id: string; status: string }>).filter((s) => !['DRAFT', 'CANCELLED', 'VOID'].includes(String(s.status).toUpperCase())).map((s) => s.id);
  if (siIds.length > 0) {
    const { data: sip, error: sipErr } = await sb.from('sales_invoice_payments').select('amount_sen').eq('company_id', companyId).in('sales_invoice_id', siIds);
    if (sipErr) return { ok: false, error: sipErr.message };
    sen += ((sip ?? []) as Array<{ amount_sen: number }>).reduce((s, p) => s + Number(p.amount_sen ?? 0), 0);
  }
  return { ok: true, sen };
}

/** A project's limit, used, reserved and left. `exceptPvId`: a voucher left out of the reservation (checking itself). */
export async function projectLimit(sb: Db, companyId: number, projectId: number, exceptPvId: string | null = null): Promise<ProjectLimit | Fail> {
  const { data: p, error } = await sb.schema('public').from('projects').select('id, name, funding, limit_pct_bp, budget_sen').eq('company_id', companyId).eq('id', projectId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!p) return { ok: false, error: `Project ${projectId} not found.` };
  const proj = p as { name: string; funding: string | null; limit_pct_bp: number | null; budget_sen: number | null };
  const { data: reqs, error: rErr } = await sb.from('project_limit_requests').select('kind, amount_sen, status').eq('company_id', companyId).eq('project_id', projectId).eq('status', 'APPROVED');
  if (rErr) return { ok: false, error: rErr.message };
  const approved = (reqs ?? []) as Array<{ kind: string; amount_sen: number | null }>;
  const funding = proj.funding === 'internal' ? 'internal' : 'customer';

  let limitSen: number;
  let pctBp: number | null = null;
  let receivedSen: number | null = null;
  if (funding === 'internal') {
    limitSen = Number(proj.budget_sen ?? 0) + approved.filter((r) => r.kind === 'budget').reduce((s, r) => s + Number(r.amount_sen ?? 0), 0);
  } else {
    const { data: st, error: sErr } = await sb.from('acc_company_settings').select('project_limit_pct_bp').eq('company_id', companyId).maybeSingle();
    if (sErr) return { ok: false, error: sErr.message };
    pctBp = proj.limit_pct_bp ?? (st as { project_limit_pct_bp?: number | null } | null)?.project_limit_pct_bp ?? DEFAULT_LIMIT_PCT_BP;
    const rec = await projectReceived(sb, companyId, projectId);
    if (!rec.ok) return rec;
    receivedSen = rec.sen;
    limitSen = Math.floor((rec.sen * pctBp) / 10_000) + approved.filter((r) => r.kind === 'amount').reduce((s, r) => s + Number(r.amount_sen ?? 0), 0);
  }

  const pl = await projectLines(sb, companyId, [projectId]);
  if (!pl.ok) return pl;
  let usedSen = 0;
  let reservedSen = 0;
  for (const l of pl.lines) {
    if (l.pv.status === 'POSTED') usedSen += Number(l.amount_sen);
    else if (l.pv.status === 'DRAFT' && l.pv.submitted_at && l.pv_id !== exceptPvId) reservedSen += Number(l.amount_sen);
  }
  const claims = await claimsOnProject(sb, companyId, projectId);
  if (!claims.ok) return claims;
  usedSen += claims.usedSen;
  reservedSen += claims.reservedSen;
  return { ok: true, projectId, projectName: proj.name, funding, pctBp, receivedSen, limitSen, usedSen, reservedSen, leftSen: limitSen - usedSen - reservedSen };
}

export type LimitCheck = { ok: true } | { ok: false; over: Array<{ projectId: number; projectName: string; leftSen: number; overSen: number }> } | Fail;

/** Does this voucher fit every project it pays? Checked when it is submitted and when it is posted at once. */
export async function checkVoucherLimit(sb: Db, companyId: number, pvId: string): Promise<LimitCheck> {
  /* Paying a staff receipt back moves money already spent and already counted: it is flagged, never refused (SOP 6). */
  const { data: head, error: hErr } = await sb.from('payment_vouchers').select('staff_receipt_id').eq('company_id', companyId).eq('id', pvId).maybeSingle();
  if (hErr) return { ok: false, error: hErr.message };
  if ((head as { staff_receipt_id?: string | null } | null)?.staff_receipt_id) return { ok: true };
  const { data: lines, error } = await sb.from('payment_voucher_lines').select('pv_id, project_id, amount_sen, debit_account_code').eq('company_id', companyId).eq('pv_id', pvId);
  if (error) return { ok: false, error: error.message };
  const mine = ((lines ?? []) as PvLine[]).filter((l) => l.project_id != null);
  if (mine.length === 0) return { ok: true };
  const { data: accts, error: aErr } = await sb.from('accounts').select('account_code, everyday_expense').eq('company_id', companyId).in('account_code', [...new Set(mine.map((l) => l.debit_account_code))]);
  if (aErr) return { ok: false, error: aErr.message };
  const everyday = new Set(((accts ?? []) as Array<{ account_code: string; everyday_expense: boolean | null }>).filter((a) => a.everyday_expense === true).map((a) => a.account_code));
  const byProject = new Map<number, number>();
  for (const l of mine) if (!everyday.has(l.debit_account_code)) byProject.set(Number(l.project_id), (byProject.get(Number(l.project_id)) ?? 0) + Number(l.amount_sen));
  const over: Array<{ projectId: number; projectName: string; leftSen: number; overSen: number }> = [];
  for (const [projectId, sen] of byProject) {
    const lim = await projectLimit(sb, companyId, projectId, pvId);
    if (!lim.ok) return lim;
    if (sen > lim.leftSen) over.push({ projectId, projectName: lim.projectName, leftSen: lim.leftSen, overSen: sen - lim.leftSen });
  }
  return over.length ? { ok: false, over } : { ok: true };
}

/** The one project the bills a voucher pays belong to: a purchase invoice through its PO, an AP invoice through its
    lines. None: null. Two or more: refused — one voucher pays one project. */
export async function projectOfBills(sb: Db, companyId: number, bills: { piIds: string[]; apInvoiceIds: string[] }): Promise<{ ok: true; projectId: number | null } | { ok: false; error: string }> {
  const projects = new Set<number>();
  if (bills.piIds.length > 0) {
    const { data: pis, error } = await sb.from('purchase_invoices').select('id, purchase_order_id').eq('company_id', companyId).in('id', bills.piIds);
    if (error) return { ok: false, error: error.message };
    const poIds = [...new Set(((pis ?? []) as Array<{ purchase_order_id: string | null }>).map((p) => p.purchase_order_id).filter(Boolean) as string[])];
    if (poIds.length > 0) {
      const { data: pos, error: poErr } = await sb.from('purchase_orders').select('id, project_id').eq('company_id', companyId).in('id', poIds);
      if (poErr) return { ok: false, error: poErr.message };
      for (const po of (pos ?? []) as Array<{ project_id: number | null }>) if (po.project_id != null) projects.add(Number(po.project_id));
    }
  }
  if (bills.apInvoiceIds.length > 0) {
    const { data: lines, error } = await sb.from('ap_invoice_lines').select('project_id').in('invoice_id', bills.apInvoiceIds);
    if (error) return { ok: false, error: error.message };
    for (const l of (lines ?? []) as Array<{ project_id: number | null }>) if (l.project_id != null) projects.add(Number(l.project_id));
  }
  if (projects.size > 1) return { ok: false, error: 'many_projects' };
  return { ok: true, projectId: projects.size === 1 ? [...projects][0]! : null };
}

/** The project a voucher pays (SOP 3.4): the one named on it, else the one its bills belong to. A name that differs
    from the bills', or bills of two projects, is refused — one voucher pays one project. */
export async function resolveVoucherProject(
  sb: Db, companyId: number, named: unknown, bills: { piIds: string[]; apInvoiceIds: string[] },
): Promise<{ ok: true; projectId: number | null } | { ok: false; status: 400 | 409 | 500; body: Record<string, unknown> }> {
  const fromBills = await projectOfBills(sb, companyId, bills);
  if (!fromBills.ok) {
    if (fromBills.error === 'many_projects') return { ok: false, status: 409, body: { error: 'many_projects', message: 'One payment voucher pays one project: these bills belong to more than one.' } };
    return { ok: false, status: 500, body: { error: 'load_failed', reason: fromBills.error } };
  }
  if (named == null || named === '') return { ok: true, projectId: fromBills.projectId };
  const id = Number(named);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, status: 400, body: { error: 'project_invalid' } };
  const { data, error } = await sb.schema('public').from('projects').select('id').eq('company_id', companyId).eq('id', id).maybeSingle();
  if (error) return { ok: false, status: 500, body: { error: 'load_failed', reason: error.message } };
  if (!data) return { ok: false, status: 400, body: { error: 'project_invalid', message: `Project ${id} is not this company's.` } };
  if (fromBills.projectId != null && fromBills.projectId !== id) {
    return { ok: false, status: 409, body: { error: 'project_mismatch', message: "The bills this voucher pays belong to another project." } };
  }
  return { ok: true, projectId: id };
}

/** The refusal of a voucher over a project's limit, in the SOP's words: what is left and by how much it is over. */
export function overLimitBody(over: Array<{ projectId: number; projectName: string; leftSen: number; overSen: number }>): Record<string, unknown> {
  const o = over[0]!;
  const rm = (sen: number) => (sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    error: 'over_project_limit', projectId: o.projectId, leftSen: o.leftSen, overSen: o.overSen, over,
    message: `${o.projectName} has RM ${rm(Math.max(0, o.leftSen))} left of its limit: this voucher is RM ${rm(o.overSen)} over. Ask for extra limit, or lower the amount.`,
  };
}

/** A new project's funding, as the form sends it (SOP 3.4): a customer project (the default), or an internal one —
    the company's own money — with the department it counts to (rental: a unit to rent out; supply: the showroom) and
    its budget. */
export function fundingFrom(body: Record<string, unknown>): { ok: true; funding: 'customer' | 'internal'; department: 'rental' | 'supply' | null; budgetSen: number | null } | { ok: false; error: string } {
  if (body.funding == null || body.funding === 'customer') return { ok: true, funding: 'customer', department: null, budgetSen: null };
  if (body.funding !== 'internal') return { ok: false, error: 'funding_invalid' };
  const department = body.internalDepartment;
  if (department !== 'rental' && department !== 'supply') return { ok: false, error: 'department_required' };
  const budget = Number(body.budgetSen);
  if (!Number.isInteger(budget) || budget <= 0) return { ok: false, error: 'budget_required' };
  return { ok: true, funding: 'internal', department, budgetSen: budget };
}
