// ----------------------------------------------------------------------------
// Conts: Finance's To do — the reads and the handlers (ported from Houzs's
// scm/routes/accounting-todo.ts and the rule switches of accounting-todo-tasks.ts).
// Mounted under /accounting, behind the Ledger guard:
//   GET /accounting/todo            the page
//   GET /accounting/todo/count      how many jobs wait on the caller (the sidebar badge)
//   GET /accounting/todo/settings   { rulesOff, mayEdit }
//   PUT /accounting/todo/settings   { rulesOff } — Ledger full (scm.payment_voucher.approve)
//
// The rules are finance-todo.ts. Each section reads on its own, and a read that
// fails is NAMED in `problems` and leaves its jobs out — never shown as
// "nothing waiting". A rule switched off is not read at all.
// ----------------------------------------------------------------------------

import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { mytDateOf, todayMyt } from '../scm/lib/my-time';
import { chunkIn, paginateAll } from '../scm/lib/paginate-all';
import { hasHouzsPerm, holdsHouzsPermLiterally } from '../scm/lib/houzs-perms';
import { missingDepositInvoices } from '../acc/deposit-invoices';
import { stillWaiting } from './finance-waiting';
import { staffNames } from './petty-cash-store';
import {
  addDays, bankName, buildFinanceTodo, raiseJobs, BUILT_IN_RULES, DUE_SOON_DAYS,
  type TodoBankLine, type TodoDone, type TodoFacts, type TodoRule, type TodoViewer,
} from './finance-todo';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
type Db = any;
type Rows = Array<Record<string, any>>;
type Read<T> = { ok: true; value: T } | { ok: false; what: string; reason: string };

const fail = (what: string, reason: string) => ({ ok: false as const, what, reason });
const msg = (e: unknown): string => (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
const day = (v: unknown): string | null => (v == null || v === '' ? null : mytDateOf(String(v)));
/** HH:MM in Malaysia — the done list's clock. */
const clock = (v: unknown): string => new Date(new Date(String(v)).getTime() + 8 * 3_600_000).toISOString().slice(11, 16);
/** The first instant of a Malaysian day, as the UTC timestamp the columns hold. */
const dayStart = (ymd: string): string => new Date(`${ymd}T00:00:00+08:00`).toISOString();
const latest = (vs: unknown[]): string => vs.map(String).filter(Boolean).sort().slice(-1)[0] ?? '';
/** A document's total in ringgit sen — a foreign-currency one at its rate. */
const myrSen = (totalSen: unknown, rate: unknown): number => {
  const r = Number(rate);
  return Math.round(Number(totalSen ?? 0) * (Number.isFinite(r) && r > 0 ? r : 1));
};

/** Ledger edit and up works Finance; Ledger full may switch rules. */
export const SETTINGS_KEY = 'scm.payment_voucher.approve';

/* ── To do rules ─────────────────────────────────────────────────────────── */

async function readRulesOff(sb: Db, companyId: number): Promise<Read<string[]>> {
  const { data, error } = await sb.from('acc_todo_settings').select('rules_off').eq('company_id', companyId).maybeSingle();
  if (error) return fail('To do rules', error.message);
  const off = (data as { rules_off?: unknown } | null)?.rules_off;
  return { ok: true, value: Array.isArray(off) ? off.map(String) : [] };
}

/* ── Payments ────────────────────────────────────────────────────────────── */

async function readRequests(sb: Db, companyId: number): Promise<Read<TodoFacts['requests']>> {
  const all = await paginateAll<Record<string, any>>((lo, hi) => sb.from('payment_requests')
    .select('id, request_no, payee_name, amount_sen, created_at, wanted_on, source_key, ap_invoice_id')
    .eq('company_id', companyId).eq('status', 'SUBMITTED').order('id').range(lo, hi));
  if (all.error) return fail('payment requests', msg(all.error));
  const waiting = await stillWaiting(sb, (all.data ?? []) as Array<{ id: string; ap_invoice_id: string | null } & Record<string, any>>);
  return {
    ok: true,
    value: waiting.map((r) => ({
      no: String(r.request_no ?? ''), payee: String(r.payee_name ?? ''), amountSen: Number(r.amount_sen ?? 0),
      createdOn: day(r.created_at) ?? '', wantedOn: r.wanted_on ? String(r.wanted_on).slice(0, 10) : null,
      utility: String(r.source_key ?? '').startsWith('utility:'),
    })),
  };
}

async function readClaims(sb: Db, companyId: number): Promise<Read<TodoFacts['claims']>> {
  const cols = 'id, receipt_no, submitter_user_id, float_id, amount_sen, status, created_at, checked_at, payback_pv_id';
  const [handedIn, checked] = await Promise.all([
    paginateAll<Record<string, any>>((lo, hi) => sb.from('staff_receipts').select(cols)
      .eq('company_id', companyId).eq('status', 'HANDED_IN').order('id').range(lo, hi)),
    paginateAll<Record<string, any>>((lo, hi) => sb.from('staff_receipts').select(cols)
      .eq('company_id', companyId).eq('status', 'CHECKED').is('float_id', null).is('payback_pv_id', null).order('id').range(lo, hi)),
  ]);
  if (handedIn.error || checked.error) return fail('staff claims', msg(handedIn.error ?? checked.error));
  const rows = [...((handedIn.data ?? []) as Rows), ...((checked.data ?? []) as Rows)];
  const names = rows.length ? await staffNames(sb).catch(() => new Map<string, string>()) : new Map<string, string>();
  return {
    ok: true,
    value: rows.map((r) => ({
      no: String(r.receipt_no ?? ''), who: names.get(String(r.submitter_user_id)) ?? String(r.submitter_user_id ?? ''),
      amountSen: Number(r.amount_sen ?? 0), float: r.float_id != null,
      stage: r.status === 'HANDED_IN' ? 'check' as const : 'pay' as const,
      since: (r.status === 'HANDED_IN' ? day(r.created_at) : day(r.checked_at) ?? day(r.created_at)) ?? '',
    })),
  };
}

async function readVouchers(sb: Db, companyId: number): Promise<Read<TodoFacts['vouchers']>> {
  const all = await paginateAll<Record<string, any>>((lo, hi) => sb.from('payment_vouchers')
    .select('id, payee_name, total_sen, exchange_rate, submitted_at, submitted_by, checked_at, checked_by')
    .eq('company_id', companyId).eq('status', 'DRAFT').not('submitted_at', 'is', null).is('approved_at', null).order('id').range(lo, hi));
  if (all.error) return fail('payment vouchers', msg(all.error));
  return {
    ok: true,
    value: ((all.data ?? []) as Rows).map((v) => (v.checked_at
      ? { stage: 'approve' as const, payee: String(v.payee_name ?? ''), amountSen: myrSen(v.total_sen, v.exchange_rate), since: day(v.checked_at) ?? '', by: v.checked_by ?? null }
      : { stage: 'check' as const, payee: String(v.payee_name ?? ''), amountSen: myrSen(v.total_sen, v.exchange_rate), since: day(v.submitted_at) ?? '', by: v.submitted_by ?? null })),
  };
}

async function readBills(sb: Db, companyId: number, today: string): Promise<Read<TodoFacts['bills']>> {
  const all = await paginateAll<Record<string, any>>((lo, hi) => sb.from('ap_invoices')
    .select('id, invoice_number, supplier_id, due_date, exchange_rate, total_sen, paid_sen, status')
    .eq('company_id', companyId).in('status', ['POSTED', 'PARTIALLY_PAID'])
    .not('due_date', 'is', null).lte('due_date', addDays(today, DUE_SOON_DAYS)).order('id').range(lo, hi));
  if (all.error) return fail('supplier bills', msg(all.error));
  const rows = ((all.data ?? []) as Rows).filter((r) => Number(r.total_sen ?? 0) - Number(r.paid_sen ?? 0) > 0);
  const ids = [...new Set(rows.map((r) => r.supplier_id).filter(Boolean).map(String))];
  const sup = await chunkIn<Record<string, any>>(ids, (batch, lo, hi) => sb.from('suppliers').select('id, name').in('id', batch).order('id').range(lo, hi));
  if (sup.error) return fail('supplier bills', msg(sup.error));
  const names = new Map(((sup.data ?? []) as Rows).map((s) => [String(s.id), String(s.name ?? '')]));
  return {
    ok: true,
    value: rows.map((r) => ({
      no: String(r.invoice_number ?? ''), supplier: names.get(String(r.supplier_id)) ?? '', dueDate: String(r.due_date).slice(0, 10),
      outstandingSen: myrSen(Number(r.total_sen ?? 0) - Number(r.paid_sen ?? 0), r.exchange_rate),
    })),
  };
}

async function readLimits(sb: Db, companyId: number): Promise<Read<TodoFacts['limits']>> {
  const { data, error } = await sb.from('project_limit_requests')
    .select('id, project_id, amount_sen, requested_by, requested_by_id, created_at').eq('company_id', companyId).eq('status', 'PENDING');
  if (error) return fail('limit requests', error.message);
  const rows = (data ?? []) as Rows;
  const ids = [...new Set(rows.map((r) => Number(r.project_id)).filter(Boolean))];
  const projects = new Map<number, string>();
  if (ids.length) {
    const { data: ps, error: pErr } = await sb.schema('public').from('projects').select('id, code, name').eq('company_id', companyId).in('id', ids);
    if (pErr) return fail('limit requests', pErr.message);
    for (const p of (ps ?? []) as Rows) projects.set(Number(p.id), String(p.name ?? p.code ?? ''));
  }
  return {
    ok: true,
    value: rows.map((r) => ({
      project: projects.get(Number(r.project_id)) ?? `Project ${r.project_id}`, by: String(r.requested_by ?? ''),
      byId: r.requested_by_id != null ? String(r.requested_by_id) : null,
      amountSen: r.amount_sen != null ? Number(r.amount_sen) : null, since: day(r.created_at) ?? '',
    })),
  };
}

/* ── Bank statements ──────────────────────────────────────────────────────── */

type BankFacts = Pick<TodoFacts, 'bankAccounts' | 'lastStatementTo' | 'bankLines' | 'lockedLastMonth'> & { statements: Rows; locks: Rows };

async function readBank(sb: Db, companyId: number, today: string): Promise<Read<BankFacts>> {
  const { data: cfg, error: cfgErr } = await sb.from('acc_bank_statement_config')
    .select('account_code, bank_code, created_at').eq('company_id', companyId).eq('is_active', true);
  if (cfgErr) return fail('bank setups', cfgErr.message);
  const cfgRows = (cfg ?? []) as Rows;
  const codes = cfgRows.map((r) => String(r.account_code));
  const names = new Map<string, string>();
  if (codes.length) {
    const { data: acc, error: accErr } = await sb.from('accounts').select('account_code, account_name').eq('company_id', companyId).in('account_code', codes);
    if (accErr) return fail('bank accounts', accErr.message);
    for (const a of (acc ?? []) as Rows) names.set(String(a.account_code), String(a.account_name ?? ''));
  }
  const bankAccounts = cfgRows.map((r) => ({
    accountCode: String(r.account_code), bankCode: String(r.bank_code ?? ''),
    accountName: names.get(String(r.account_code)) ?? '', createdOn: day(r.created_at) ?? today,
  }));

  const [statements, lines, locks] = await Promise.all([
    paginateAll<Record<string, any>>((lo, hi) => sb.from('acc_bank_statements')
      .select('id, account_code, period_from, period_to, created_at').eq('company_id', companyId).order('id').range(lo, hi)),
    paginateAll<Record<string, any>>((lo, hi) => sb.from('acc_bank_statement_lines')
      .select('id, statement_id, amount_sen, booked_on').eq('company_id', companyId).eq('state', 'OPEN').order('id').range(lo, hi)),
    sb.from('acc_bank_month_locks').select('account_code, period_month, locked_at').eq('company_id', companyId).is('released_at', null),
  ]);
  if (statements.error) return fail('bank statements', msg(statements.error));
  if (lines.error) return fail('bank lines', msg(lines.error));
  if (locks.error) return fail('bank month locks', msg(locks.error));
  const stmtRows = (statements.data ?? []) as Rows;
  const lockRows = (locks.data ?? []) as Rows;

  const lastStatementTo: Record<string, string | null> = {};
  for (const b of bankAccounts) lastStatementTo[b.accountCode] = null;
  for (const s of stmtRows) {
    const code = String(s.account_code);
    const to = s.period_to ? String(s.period_to).slice(0, 10) : null;
    if (to && code in lastStatementTo && (lastStatementTo[code] == null || to > lastStatementTo[code]!)) lastStatementTo[code] = to;
  }

  /* A locked month takes no more decisions, so its lines are not anybody's job. */
  const locked = new Set(lockRows.map((l) => `${l.account_code}|${String(l.period_month).slice(0, 7)}`));
  const stmt = new Map(stmtRows.map((s) => [Number(s.id), s]));
  const bankLines: TodoBankLine[] = [];
  for (const l of (lines.data ?? []) as Rows) {
    const s = stmt.get(Number(l.statement_id));
    if (!s || !(String(s.account_code) in lastStatementTo)) continue;
    if (locked.has(`${s.account_code}|${String(l.booked_on).slice(0, 7)}`)) continue;
    bankLines.push({
      accountCode: String(s.account_code), statementId: Number(s.id), amountSen: Number(l.amount_sen ?? 0),
      periodTo: s.period_to ? String(s.period_to).slice(0, 10) : null, uploadedOn: day(s.created_at) ?? today,
      month: String(l.booked_on).slice(0, 7),
    });
  }
  const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const lockedLastMonth = [...new Set(lockRows.filter((l) => String(l.period_month).slice(0, 7) === lastMonth).map((l) => String(l.account_code)))];
  return { ok: true, value: { bankAccounts, lastStatementTo, bankLines, lockedLastMonth, statements: stmtRows, locks: lockRows } };
}

/* ── Money in ────────────────────────────────────────────────────────────── */

async function readReceipts(sb: Db, companyId: number): Promise<Read<TodoFacts['receipts']>> {
  const all = await paginateAll<Record<string, any>>((lo, hi) => sb.from('acc_official_receipts')
    .select('id, or_number, customer_name, amount_sen, paid_at').eq('company_id', companyId).eq('status', 'DRAFT').order('id').range(lo, hi));
  if (all.error) return fail('customer payments', msg(all.error));
  return {
    ok: true,
    value: ((all.data ?? []) as Rows).filter((r) => Number(r.amount_sen ?? 0) > 0).map((r) => ({
      no: String(r.or_number ?? ''), customer: String(r.customer_name ?? ''), amountSen: Number(r.amount_sen ?? 0),
      paidOn: r.paid_at ? String(r.paid_at).slice(0, 10) : null,
    })),
  };
}

async function readDeposits(sb: Db, companyId: number): Promise<Read<TodoFacts['deposits']>> {
  const r = await missingDepositInvoices(sb, companyId);
  if (!r.ok) return fail('deposit invoices', r.reason);
  return { ok: true, value: r.payments.map((p) => ({ soDocNo: String(p.so_doc_no), amountSen: Number(p.amount_sen ?? 0), paidOn: p.paid_at ? String(p.paid_at).slice(0, 10) : null })) };
}

async function readEInvoices(sb: Db, companyId: number): Promise<Read<TodoFacts['einvoices']>> {
  const all = await paginateAll<Record<string, any>>((lo, hi) => sb.from('acc_einvoice_outbox')
    .select('id, doc_number, status, missing, prepared_at').eq('company_id', companyId).in('status', ['NOT_READY', 'REJECTED']).order('id').range(lo, hi));
  if (all.error) return fail('e-invoices', msg(all.error));
  return {
    ok: true,
    value: ((all.data ?? []) as Rows).map((r) => ({
      no: String(r.doc_number ?? ''), status: r.status === 'REJECTED' ? 'REJECTED' as const : 'NOT_READY' as const,
      missing: Array.isArray(r.missing) ? r.missing.map(String) : [], since: day(r.prepared_at) ?? '',
    })),
  };
}

/** Σ debit − Σ credit over every posted line — the trial balance's own difference. */
async function readTrialBalance(sb: Db, companyId: number): Promise<Read<number>> {
  const all = await paginateAll<Record<string, any>>((lo, hi) => sb.from('v_account_balances')
    .select('account_code, total_debit_sen, total_credit_sen').eq('company_id', companyId).order('account_code').range(lo, hi));
  if (all.error) return fail('trial balance', msg(all.error));
  return { ok: true, value: ((all.data ?? []) as Rows).reduce((d, r) => d + Number(r.total_debit_sen ?? 0) - Number(r.total_credit_sen ?? 0), 0) };
}

/* ── Done today ──────────────────────────────────────────────────────────── */

async function readDone(sb: Db, companyId: number, today: string, bank: BankFacts | null): Promise<Read<TodoDone[]>> {
  const from = dayStart(today);
  /* A voucher counts once for each step taken on it today — one plain read per step. */
  const pvStep = (col: string) => sb.from('payment_vouchers').select('id, pv_number, payee_name, checked_at, approved_at, posted_at')
    .eq('company_id', companyId).gte(col, from);
  const [checkedPv, approvedPv, postedPv, decided, receipts, claims, limits] = await Promise.all([
    pvStep('checked_at'), pvStep('approved_at'), pvStep('posted_at'),
    sb.from('acc_bank_statement_lines').select('id, statement_id, state, updated_at').eq('company_id', companyId)
      .in('state', ['POSTED', 'IGNORED']).gte('updated_at', from),
    sb.from('acc_official_receipts').select('id, issued_at').eq('company_id', companyId).eq('status', 'FORMAL').gte('issued_at', from),
    sb.from('staff_receipts').select('id, status, checked_at').eq('company_id', companyId).gte('checked_at', from),
    sb.from('project_limit_requests').select('id, status, decided_at').eq('company_id', companyId).gte('decided_at', from),
  ]);
  const bad = [checkedPv, approvedPv, postedPv, decided, receipts, claims, limits].find((r) => r.error);
  if (bad) return fail('what was done today', msg(bad.error));
  const done: TodoDone[] = [];

  const vouchers = [...new Map([checkedPv, approvedPv, postedPv].flatMap((r) => (r.data ?? []) as Rows).map((v) => [String(v.id), v])).values()];
  for (const v of vouchers) {
    const steps: Array<[string, unknown]> = [['Checked', v.checked_at], ['Approved', v.approved_at], ['Posted', v.posted_at]];
    for (const [verb, at] of steps) {
      if (day(at) !== today) continue;
      done.push({ key: `pv:${v.id}:${verb}`, text: `${verb} ${v.payee_name ?? 'voucher'}`, ref: v.pv_number ? String(v.pv_number) : null, at: clock(at) });
    }
  }

  const stmt = new Map((bank?.statements ?? []).map((s) => [Number(s.id), s]));
  const bankOf = new Map((bank?.bankAccounts ?? []).map((a) => [a.accountCode, bankName(a.bankCode)]));
  for (const s of bank?.statements ?? []) {
    if (day(s.created_at) !== today) continue;
    done.push({ key: `statement:${s.id}`, text: `Uploaded ${bankOf.get(String(s.account_code)) ?? s.account_code} statement · ${s.account_code}`, ref: null, at: clock(s.created_at) });
  }
  const byAccount = new Map<string, Rows>();
  for (const l of (decided.data ?? []) as Rows) {
    const code = String(stmt.get(Number(l.statement_id))?.account_code ?? '');
    if (!code) continue;
    byAccount.set(code, [...(byAccount.get(code) ?? []), l]);
  }
  for (const [code, ls] of byAccount) {
    done.push({ key: `decided:${code}`, text: `Matched ${ls.length} ${bankOf.get(code) ?? code} line${ls.length > 1 ? 's' : ''} · ${code}`, ref: null, at: clock(latest(ls.map((l) => l.updated_at))) });
  }
  for (const l of bank?.locks ?? []) {
    if (day(l.locked_at) !== today) continue;
    const month = new Date(`${String(l.period_month).slice(0, 7)}-01T00:00:00Z`).toLocaleString('en-MY', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    done.push({ key: `locked:${l.account_code}:${l.period_month}`, text: `Locked ${bankOf.get(String(l.account_code)) ?? l.account_code} ${month} · ${l.account_code}`, ref: null, at: clock(l.locked_at) });
  }

  const ors = (receipts.data ?? []) as Rows;
  if (ors.length) done.push({ key: 'receipts', text: `Confirmed ${ors.length} customer payment${ors.length > 1 ? 's' : ''}`, ref: null, at: clock(latest(ors.map((r) => r.issued_at))) });
  const checked = ((claims.data ?? []) as Rows).filter((r) => r.status !== 'REJECTED' && r.status !== 'HANDED_IN');
  if (checked.length) done.push({ key: 'claims', text: `Checked ${checked.length} staff claim${checked.length > 1 ? 's' : ''}`, ref: null, at: clock(latest(checked.map((r) => r.checked_at))) });
  const lim = (limits.data ?? []) as Rows;
  if (lim.length) done.push({ key: 'limits', text: `Decided ${lim.length} project limit request${lim.length > 1 ? 's' : ''}`, ref: null, at: clock(latest(lim.map((r) => r.decided_at))) });
  return { ok: true, value: done };
}

/* ── Whose desk ──────────────────────────────────────────────────────────── */

export function readViewer(c: Ctx): TodoViewer {
  const hu = c.get('houzsUser') as { id?: number | string; name?: string | null; email?: string } | undefined;
  return {
    id: hu?.id != null ? String(hu.id) : null,
    name: String(hu?.name ?? hu?.email ?? ''),
    finance: hasHouzsPerm(c, 'scm.payment_voucher.create') || hasHouzsPerm(c, 'scm.payment_voucher.write'),
    /* The desk is whoever holds the key itself: the wildcard can do it but is not told it is theirs. */
    checker: holdsHouzsPermLiterally(c, 'scm.payment_voucher.check'),
    approver: holdsHouzsPermLiterally(c, 'scm.payment_voucher.approve'),
    limitApprover: holdsHouzsPermLiterally(c, 'scm.project_limit.approve'),
  };
}

/* ── Facts and handlers ──────────────────────────────────────────────────── */

/** Every fact the rules read, for one company and day. `full` adds what was
    done today and the trial balance — the page wants them, the badge does not. */
export async function readFinanceTodoFacts(sb: Db, companyId: number, today: string, full: boolean): Promise<TodoFacts> {
  const problems: string[] = [];
  /* A section that throws is a failed read like any other — named, and the rest still shown. */
  const safe = async <T,>(what: string, run: () => Promise<Read<T>>): Promise<Read<T>> => {
    try { return await run(); } catch (e) { return fail(what, msg(e)); }
  };
  const ok = <T,>(r: Read<T>, empty: T): T => {
    if (r.ok) return r.value;
    problems.push(`${r.what} (${r.reason})`);
    return empty;
  };
  const rulesOff = ok(await safe('To do rules', () => readRulesOff(sb, companyId)), [] as string[]);
  const off = new Set(rulesOff);
  /* A section whose rules are all off is not read; the checklist reads it anyway when the page is full. */
  const want = (...rules: TodoRule[]): boolean => full || rules.some((r) => !off.has(r));
  const skip = <T,>(value: T): Promise<Read<T>> => Promise.resolve({ ok: true, value });

  const [requests, claims, vouchers, bills, limits, bank, receipts, deposits, einvoices] = await Promise.all([
    want('requests', 'utilities') ? safe('payment requests', () => readRequests(sb, companyId)) : skip([]),
    want('claims-check', 'claims-pay') ? safe('staff claims', () => readClaims(sb, companyId)) : skip([]),
    want('pv-check', 'pv-approve') ? safe('payment vouchers', () => readVouchers(sb, companyId)) : skip([]),
    !off.has('ap-overdue') || !off.has('ap-due') ? safe('supplier bills', () => readBills(sb, companyId, today)) : skip([]),
    !off.has('limits') ? safe('limit requests', () => readLimits(sb, companyId)) : skip([]),
    want('bank-missing', 'bank-decide') ? safe('bank statements', () => readBank(sb, companyId, today)) : skip<BankFacts | null>(null),
    want('receipts') ? safe('customer payments', () => readReceipts(sb, companyId)) : skip([]),
    !off.has('deposit-invoices') ? safe('deposit invoices', () => readDeposits(sb, companyId)) : skip([]),
    !off.has('einvoice') ? safe('e-invoices', () => readEInvoices(sb, companyId)) : skip([]),
  ]);
  const bk = ok<BankFacts | null>(bank, null);

  let done: TodoDone[] = [];
  let trialBalanceDiffSen: number | null = null;
  if (full) {
    const [doneRead, trialBalance] = await Promise.all([
      safe('what was done today', () => readDone(sb, companyId, today, bk)),
      safe('trial balance', () => readTrialBalance(sb, companyId)),
    ]);
    done = ok(doneRead, []);
    trialBalanceDiffSen = ok<number | null>(trialBalance, null);
  }
  return {
    today,
    requests: ok(requests, []), claims: ok(claims, []), vouchers: ok(vouchers, []), bills: ok(bills, []), limits: ok(limits, []),
    bankAccounts: bk?.bankAccounts ?? [], lastStatementTo: bk?.lastStatementTo ?? {}, bankLines: bk?.bankLines ?? [], lockedLastMonth: bk?.lockedLastMonth ?? [],
    receipts: ok(receipts, []), deposits: ok(deposits, []), einvoices: ok(einvoices, []),
    trialBalanceDiffSen, done, problems, rulesOff,
  };
}

/** GET /accounting/todo — the page. */
export const financeTodoHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const facts = await readFinanceTodoFacts(c.get('supabase'), co.companyId, todayMyt(), true);
  return c.json(buildFinanceTodo(facts, readViewer(c)));
};

/** GET /accounting/todo/count — how many jobs wait on the caller (the sidebar badge). */
export const financeTodoCountHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json({ count: 0 });
  const facts = await readFinanceTodoFacts(c.get('supabase'), co.companyId, todayMyt(), false);
  return c.json({ count: raiseJobs(facts, readViewer(c)).mine.length });
};

/** GET /accounting/todo/settings — the rules switched off, and whether the caller may switch them. */
export const todoSettingsGetHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const r = await readRulesOff(c.get('supabase'), co.companyId);
  if (!r.ok) return c.json({ error: 'load_failed', reason: r.reason }, 500);
  return c.json({ rulesOff: r.value, mayEdit: hasHouzsPerm(c, SETTINGS_KEY) });
};

/** PUT /accounting/todo/settings — { rulesOff }: which built-in rules are switched off. */
export const todoSettingsPutHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, SETTINGS_KEY)) return c.json({ error: 'forbidden', message: 'Only Ledger full can change the To do rules.' }, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const body = await c.req.json().catch(() => ({})) as { rulesOff?: unknown };
  if (!Array.isArray(body.rulesOff)) return c.json({ error: 'bad_rules', message: 'Say which rules are off, as a list.' }, 400);
  const known = new Set<string>(BUILT_IN_RULES);
  const rulesOff = [...new Set(body.rulesOff.map(String))];
  const unknown = rulesOff.filter((r) => !known.has(r));
  if (unknown.length) return c.json({ error: 'bad_rules', message: `No such rule: ${unknown.join(', ')}.` }, 400);
  const hu = c.get('houzsUser') as { name?: string | null; email?: string } | undefined;
  const { error } = await c.get('supabase').from('acc_todo_settings')
    .upsert({ company_id: co.companyId, rules_off: rulesOff, updated_by: String(hu?.name ?? hu?.email ?? ''), updated_at: new Date().toISOString() }, { onConflict: 'company_id' });
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  return c.json({ rulesOff });
};
