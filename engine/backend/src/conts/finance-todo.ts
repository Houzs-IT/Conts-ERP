// ----------------------------------------------------------------------------
// conts/finance-todo — Finance's To do, built from facts already read. Ported
// from Houzs's acc/finance-todo.ts (the owner's Claude Design project
// "Finance-1a-To-do", 2026-11-02), filled with what Conts' finance does: the
// payment requests and staff claims Property OS sends, vouchers through
// check and approval, supplier bills falling due, customer payments to
// confirm, bank statements, deposit invoices, project limit requests and the
// e-invoice outbox. Houzs's merchant reports, card settlement, events and the
// tasks / routines / calendar are not here.
//
// This file is the rules and nothing else: the reads live in
// finance-todo-routes.ts, so a test can hand the facts in and read the page
// back. Each job says what it is, how long it has waited (`since`) and where
// it is handled.
//
// Whose desk a job is on: the Finance rules are on anyone who works Finance
// (makes or edits vouchers). A voucher to check or approve is on whoever holds
// that key literally (the `*` wildcard can do it but is not told it is theirs);
// a limit request on whoever holds the limit approve key, never the person who
// asked. Everyone else sees it under "Waiting on others", with who it waits for.
// ----------------------------------------------------------------------------

import { fmtDate } from '../scm/shared/format';

export type TodoRule =
  | 'requests' | 'utilities' | 'claims-check' | 'claims-pay'
  | 'pv-check' | 'pv-approve' | 'ap-overdue' | 'ap-due' | 'limits'
  | 'bank-missing' | 'bank-decide'
  | 'receipts' | 'deposit-invoices' | 'einvoice';

/** Every rule, in the order the rules page lists them; each can be switched off in To do rules. */
export const BUILT_IN_RULES = [
  'requests', 'utilities', 'claims-check', 'claims-pay', 'pv-check', 'pv-approve', 'ap-overdue', 'ap-due', 'limits',
  'bank-missing', 'bank-decide',
  'receipts', 'deposit-invoices', 'einvoice',
] as const satisfies readonly TodoRule[];

export type TodoGroup = 'pay' | 'bank' | 'in';
export type TodoTone = 'bank' | 'out' | 'money' | 'err';
export type TodoIcon = 'upload' | 'landmark' | 'send' | 'wallet' | 'receipt' | 'alert-triangle' | 'file-text' | 'hand-coins' | 'zap' | 'gauge';

export type TodoJob = {
  key: string;
  rule: TodoRule;
  group: TodoGroup;
  tone: TodoTone;
  icon: TodoIcon;
  title: string;
  detail: string;
  amountSen: number | null;
  since: string | null;
  action: { label: string; to: string; primary: boolean };
  /** Waiting on others only: who it waits for. */
  who: string | null;
};

export type TodoDone = { key: string; text: string; ref: string | null; at: string };
/** `detail` is the line's explanation, shown on hover ("Debits equal credits"). */
export type TodoCheck = { key: string; label: string; value: string; state: 'ok' | 'open' | 'late'; to: string | null; detail?: string };

export type FinanceTodo = {
  today: string;
  mine: TodoJob[];
  others: TodoJob[];
  done: TodoDone[];
  checklist: { month: string; daysLeft: number; items: TodoCheck[] };
  /** Reads that failed, by what they were for — said on the page, never shown as "nothing waiting". */
  problems: string[];
};

/* ── The facts the rules read ─────────────────────────────────────────────── */

/** A payment request nobody has started on (finance-waiting.ts). `utility` when it came from Utility bills. */
export type TodoRequest = { no: string; payee: string; amountSen: number; createdOn: string; wantedOn: string | null; utility: boolean };
/** A staff claim: `stage` check = handed in; pay = checked, paid back by finance, no voucher yet. */
export type TodoClaim = { no: string; who: string; amountSen: number; since: string; stage: 'check' | 'pay'; float: boolean };
export type TodoVoucher = { stage: 'check' | 'approve'; payee: string; amountSen: number; since: string; by: string | null };
/** An AP invoice posted and not fully paid, with a due date. */
export type TodoBill = { no: string; supplier: string; outstandingSen: number; dueDate: string };
export type TodoLimit = { project: string; by: string; byId: string | null; amountSen: number | null; since: string };
export type TodoBankAccount = { accountCode: string; bankCode: string; accountName: string; createdOn: string };
/** A statement line still OPEN, in a month that is not locked; `month` is the month the bank booked it in. */
export type TodoBankLine = { accountCode: string; statementId: number; amountSen: number; periodTo: string | null; uploadedOn: string; month: string };
/** A customer payment's receipt still DRAFT: the money is not confirmed in the bank yet. */
export type TodoReceipt = { no: string; customer: string; amountSen: number; paidOn: string | null };
/** A confirmed order payment still owed its deposit invoice (acc/deposit-invoices missingDepositInvoices). */
export type TodoDeposit = { soDocNo: string; amountSen: number; paidOn: string | null };
/** An e-invoice outbox row finance must act on: NOT_READY (details missing) or REJECTED. */
export type TodoEInvoice = { no: string; status: 'NOT_READY' | 'REJECTED'; missing: string[]; since: string };

export type TodoFacts = {
  today: string;
  requests: TodoRequest[];
  claims: TodoClaim[];
  vouchers: TodoVoucher[];
  bills: TodoBill[];
  limits: TodoLimit[];
  bankAccounts: TodoBankAccount[];
  lastStatementTo: Record<string, string | null>;
  bankLines: TodoBankLine[];
  /** Accounts whose LAST month is locked. */
  lockedLastMonth: string[];
  receipts: TodoReceipt[];
  deposits: TodoDeposit[];
  einvoices: TodoEInvoice[];
  /** Σ debit − Σ credit over every posted line (the trial balance); null when it was not read. */
  trialBalanceDiffSen: number | null;
  done: TodoDone[];
  problems: string[];
  /** To do rules: the rules switched off. */
  rulesOff: string[];
};

export type TodoViewer = {
  /** public.users id (as text) — a limit request is never on the desk of whoever asked. */
  id: string | null;
  name: string;
  /** Works Finance (makes or edits vouchers): the Finance rules are theirs. */
  finance: boolean;
  checker: boolean;
  approver: boolean;
  limitApprover: boolean;
};

/* ── Small helpers ───────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;
/** The day `n` days after `ymd` (both YYYY-MM-DD). */
export const addDays = (ymd: string, n: number): string =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** The ERP's one date format (DD/MM/YYYY). */
export const showDate = (ymd: string): string => fmtDate(ymd);
const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);
const minDay = (days: Array<string | null | undefined>): string | null =>
  days.filter((d): d is string => !!d).sort()[0] ?? null;
const sum = (xs: number[]): number => xs.reduce((n, x) => n + x, 0);
/** A month by its name ("October") — a period, not a date. */
const monthOf = (ymd: string): string =>
  new Date(`${ymd.slice(0, 7)}-01T00:00:00Z`).toLocaleString('en-MY', { month: 'long', timeZone: 'UTC' });
/** The first three, then how many more — a detail line stays one line. */
const firstFew = (names: string[], n = 3): string => {
  const uniq = [...new Set(names.filter(Boolean))];
  return uniq.length > n ? `${uniq.slice(0, n).join(' · ')} · +${uniq.length - n} more` : uniq.join(' · ');
};

/** How the bank names itself to the people who use it (the setup carries only its code). */
const BANK_NAMES: Record<string, string> = {
  MBB: 'Maybank', MAYBANK: 'Maybank', HLB: 'Hong Leong', PBB: 'Public Bank', PBE: 'Public Bank',
  CIMB: 'CIMB', UOB: 'UOB', ALLIANCE: 'Alliance', ABB: 'Alliance', ABMB: 'Alliance', RHB: 'RHB',
  AMB: 'AmBank', AMBANK: 'AmBank', OCBC: 'OCBC', HSBC: 'HSBC', BIMB: 'Bank Islam', BSN: 'BSN',
  AFFIN: 'Affin', MUAMALAT: 'Muamalat', AGRO: 'Agrobank', RAKYAT: 'Bank Rakyat', SCB: 'Standard Chartered',
};
export const bankName = (code: string): string => BANK_NAMES[code.trim().toUpperCase()] ?? code.trim();

const BANK_PAGE = '/scm/bank-recon';
const REQUESTS_PAGE = '/scm/payment-requests';

/** A bank account with no statement for 3 days (the design's rule). */
export const STATEMENT_GRACE_DAYS = 3;
/** Utility bills and supplier bills join To do this many days before they fall due. */
export const DUE_SOON_DAYS = 7;

/* ── The rules ───────────────────────────────────────────────────────────── */

type Desk = 'finance' | 'checker' | 'approver' | 'limits' | 'asker';
type Raised = Omit<TodoJob, 'who'> & { desk: Desk };

function paymentJobs(f: TodoFacts): Raised[] {
  const out: Raised[] = [];
  /* requests — what Property OS asked finance to pay, nobody started on (the menu's Waiting for payment). */
  const reqs = f.requests.filter((r) => !r.utility);
  if (reqs.length > 0) {
    const n = reqs.length;
    out.push({
      key: 'requests', rule: 'requests', group: 'pay', tone: 'out', icon: 'send',
      title: `Pay ${n} payment ${plural(n, 'request')}`,
      detail: firstFew(reqs.map((r) => r.payee)),
      amountSen: sum(reqs.map((r) => r.amountSen)), since: minDay(reqs.map((r) => r.createdOn)),
      action: { label: 'Review', to: REQUESTS_PAGE, primary: true }, desk: 'finance',
    });
  }
  /* utilities — utility bills waiting for payment, due within a week or past due (paid by due date). */
  const soon = addDays(f.today, DUE_SOON_DAYS);
  const utils = f.requests.filter((r) => r.utility && r.wantedOn != null && r.wantedOn <= soon);
  if (utils.length > 0) {
    const n = utils.length;
    const late = utils.filter((r) => r.wantedOn! < f.today).length;
    const first = minDay(utils.map((r) => r.wantedOn))!;
    out.push({
      key: 'utilities', rule: 'utilities', group: 'pay', tone: late ? 'err' : 'out', icon: 'zap',
      title: `Pay ${n} utility ${plural(n, 'bill')} due by ${showDate(soon)}`,
      detail: `${late ? `${late} past due · ` : ''}first due ${showDate(first)} · ${firstFew(utils.map((r) => r.payee))}`,
      amountSen: sum(utils.map((r) => r.amountSen)), since: minDay(utils.map((r) => r.createdOn)),
      action: { label: 'Pay', to: `${REQUESTS_PAGE}?tab=utilities`, primary: true }, desk: 'finance',
    });
  }
  /* claims-check — staff receipts handed in, not checked yet. A float's are checked on Petty cash, the rest on Payment requests. */
  const check = f.claims.filter((c) => c.stage === 'check');
  if (check.length > 0) {
    const n = check.length;
    out.push({
      key: 'claims-check', rule: 'claims-check', group: 'pay', tone: 'out', icon: 'receipt',
      title: `Check ${n} staff ${plural(n, 'claim')}`,
      detail: `Handed in by ${firstFew(check.map((c) => c.who))}`,
      amountSen: sum(check.map((c) => c.amountSen)), since: minDay(check.map((c) => c.since)),
      action: { label: 'Check', to: check.every((c) => c.float) ? '/scm/petty-cash' : REQUESTS_PAGE, primary: false }, desk: 'finance',
    });
  }
  /* claims-pay — claims finance pays back, checked, with no voucher yet. */
  const pay = f.claims.filter((c) => c.stage === 'pay');
  if (pay.length > 0) {
    const n = pay.length;
    out.push({
      key: 'claims-pay', rule: 'claims-pay', group: 'pay', tone: 'out', icon: 'hand-coins',
      title: `Pay back ${n} staff ${plural(n, 'claim')}`,
      detail: firstFew(pay.map((c) => c.who)),
      amountSen: sum(pay.map((c) => c.amountSen)), since: minDay(pay.map((c) => c.since)),
      action: { label: 'Pay', to: REQUESTS_PAGE, primary: true }, desk: 'finance',
    });
  }
  const pvCheck = f.vouchers.filter((v) => v.stage === 'check');
  if (pvCheck.length > 0) {
    const by = [...new Set(pvCheck.map((v) => v.by).filter((x): x is string => !!x))];
    out.push({
      key: 'pv-check', rule: 'pv-check', group: 'pay', tone: 'out', icon: 'wallet',
      title: `Check ${pvCheck.length} payment ${plural(pvCheck.length, 'voucher')}`,
      detail: `${by.length ? `Prepared by ${by.join(', ')}` : 'Prepared'} · ${firstFew(pvCheck.map((v) => v.payee))}`,
      amountSen: sum(pvCheck.map((v) => v.amountSen)), since: minDay(pvCheck.map((v) => v.since)),
      action: { label: 'Check', to: '/scm/payment-vouchers?status=PREPARED', primary: false }, desk: 'checker',
    });
  }
  const pvApprove = f.vouchers.filter((v) => v.stage === 'approve');
  if (pvApprove.length > 0) {
    const by = [...new Set(pvApprove.map((v) => v.by).filter((x): x is string => !!x))];
    out.push({
      key: 'pv-approve', rule: 'pv-approve', group: 'pay', tone: 'out', icon: 'wallet',
      title: `Approve ${pvApprove.length} payment ${plural(pvApprove.length, 'voucher')}`,
      detail: `${by.length ? `Checked by ${by.join(', ')}` : 'Checked'} · ${firstFew(pvApprove.map((v) => v.payee))}`,
      amountSen: sum(pvApprove.map((v) => v.amountSen)), since: minDay(pvApprove.map((v) => v.since)),
      action: { label: 'Approve', to: '/scm/payment-vouchers?status=CHECKED', primary: true }, desk: 'approver',
    });
  }
  /* ap-overdue / ap-due — supplier bills (AP invoices) not fully paid: past due, or due within a week. */
  const byDue = (bs: TodoBill[]) => [...bs].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdue = byDue(f.bills.filter((b) => b.dueDate < f.today));
  if (overdue.length > 0) {
    const n = overdue.length;
    out.push({
      key: 'ap-overdue', rule: 'ap-overdue', group: 'pay', tone: 'err', icon: 'file-text',
      title: `Pay ${n} overdue supplier ${plural(n, 'bill')}`,
      detail: firstFew(overdue.map((b) => `${b.no} ${b.supplier}`.trim())),
      amountSen: sum(overdue.map((b) => b.outstandingSen)),
      /* A bill joins the list the day after it falls due. */
      since: addDays(overdue[0]!.dueDate, 1),
      action: { label: 'Open', to: '/scm/ap-invoices', primary: false }, desk: 'finance',
    });
  }
  const due = byDue(f.bills.filter((b) => b.dueDate >= f.today && b.dueDate <= addDays(f.today, DUE_SOON_DAYS)));
  if (due.length > 0) {
    const n = due.length;
    out.push({
      key: 'ap-due', rule: 'ap-due', group: 'pay', tone: 'out', icon: 'file-text',
      title: `Pay ${n} supplier ${plural(n, 'bill')} due within ${DUE_SOON_DAYS} days`,
      detail: `First due ${showDate(due[0]!.dueDate)} · ${firstFew(due.map((b) => b.supplier))}`,
      amountSen: sum(due.map((b) => b.outstandingSen)), since: null,
      action: { label: 'Open', to: '/scm/ap-invoices', primary: false }, desk: 'finance',
    });
  }
  return out;
}

/** Limit requests: on the approvers' desk; the viewer's own wait on someone else. */
function limitJobs(f: TodoFacts, v: TodoViewer): Raised[] {
  const own = (l: TodoLimit) => v.id != null && l.byId === v.id;
  const job = (ls: TodoLimit[], key: string, desk: Desk): Raised => ({
    key, rule: 'limits', group: 'pay', tone: 'out', icon: 'gauge',
    title: `Decide ${ls.length} project limit ${plural(ls.length, 'request')}`,
    detail: `${firstFew(ls.map((l) => l.project))} · asked by ${firstFew(ls.map((l) => l.by), 2)}`,
    amountSen: ls.some((l) => l.amountSen != null) ? sum(ls.map((l) => l.amountSen ?? 0)) : null,
    since: minDay(ls.map((l) => l.since)),
    action: { label: 'Decide', to: '/scm/limit-requests', primary: false }, desk,
  });
  const theirs = f.limits.filter((l) => !own(l));
  const mine = f.limits.filter(own);
  return [
    ...(theirs.length ? [job(theirs, 'limits', 'limits')] : []),
    ...(mine.length ? [{ ...job(mine, 'limits-asked', 'asker'), title: `${mine.length} project limit ${plural(mine.length, 'request')} you asked for` }] : []),
  ];
}

function bankMissing(f: TodoFacts): TodoBankAccount[] {
  const cutoff = addDays(f.today, -STATEMENT_GRACE_DAYS);
  return f.bankAccounts.filter((b) => {
    const last = f.lastStatementTo[b.accountCode] ?? null;
    return last == null || last < cutoff;
  });
}

function bankJobs(f: TodoFacts): Raised[] {
  const out: Raised[] = [];
  for (const b of bankMissing(f)) {
    const last = f.lastStatementTo[b.accountCode] ?? null;
    out.push({
      key: `bank-missing:${b.accountCode}`, rule: 'bank-missing', group: 'bank', tone: 'bank', icon: 'upload',
      title: `Upload ${bankName(b.bankCode)} statement`,
      detail: last
        ? `${b.accountCode} ${b.accountName} · the last upload stops at ${showDate(last)} · ${showDate(addDays(last, 1))} onward is missing`
        : `${b.accountCode} ${b.accountName} · no statement uploaded yet`,
      amountSen: null, since: last ? addDays(last, 1) : b.createdOn,
      action: { label: 'Upload', to: BANK_PAGE, primary: true }, desk: 'finance',
    });
  }
  for (const b of f.bankAccounts) {
    const lines = f.bankLines.filter((l) => l.accountCode === b.accountCode);
    if (lines.length === 0) continue;
    const statements = [...new Set(lines.map((l) => l.statementId))];
    const months = [...new Set(lines.map((l) => l.periodTo).filter((d): d is string => !!d).map(monthOf))];
    const first = lines.find((l) => l.statementId === statements[0])!;
    out.push({
      key: `bank-decide:${b.accountCode}`, rule: 'bank-decide', group: 'bank', tone: 'bank', icon: 'landmark',
      title: `Match ${lines.length} ${bankName(b.bankCode)} ${plural(lines.length, 'line')}`,
      detail: statements.length === 1
        ? `${b.accountCode} · ${first.periodTo ? `${monthOf(first.periodTo)} statement` : 'statement'} · uploaded ${showDate(first.uploadedOn)}`
        : `${b.accountCode} · ${statements.length} statements${months.length ? ` · ${months.join(', ')}` : ''}`,
      amountSen: sum(lines.map((l) => Math.abs(l.amountSen))), since: minDay(lines.map((l) => l.uploadedOn)),
      action: { label: 'Match', to: BANK_PAGE, primary: false }, desk: 'finance',
    });
  }
  return out;
}

function moneyInJobs(f: TodoFacts): Raised[] {
  const out: Raised[] = [];
  const r = f.receipts.length;
  if (r > 0) {
    out.push({
      key: 'receipts', rule: 'receipts', group: 'in', tone: 'money', icon: 'receipt',
      title: `Confirm ${r} customer ${plural(r, 'payment')} received`,
      detail: `Receipts stay draft until the money is seen in the bank · ${firstFew(f.receipts.map((x) => x.customer))}`,
      amountSen: sum(f.receipts.map((x) => x.amountSen)), since: minDay(f.receipts.map((x) => x.paidOn)),
      action: { label: 'Confirm', to: '/scm/official-receipts?status=DRAFT', primary: true }, desk: 'finance',
    });
  }
  const d = f.deposits.length;
  if (d > 0) {
    out.push({
      key: 'deposit-invoices', rule: 'deposit-invoices', group: 'in', tone: 'money', icon: 'file-text',
      title: `Issue ${d} deposit ${plural(d, 'invoice')}`,
      detail: `Confirmed payments with no deposit invoice · ${firstFew(f.deposits.map((x) => x.soDocNo))}`,
      amountSen: sum(f.deposits.map((x) => x.amountSen)), since: minDay(f.deposits.map((x) => x.paidOn)),
      action: { label: 'Issue', to: '/scm/deposit-invoices', primary: false }, desk: 'finance',
    });
  }
  const e = f.einvoices.length;
  if (e > 0) {
    const rejected = f.einvoices.filter((x) => x.status === 'REJECTED').length;
    const missing = [...new Set(f.einvoices.flatMap((x) => x.missing))];
    out.push({
      key: 'einvoice', rule: 'einvoice', group: 'in', tone: rejected ? 'err' : 'money', icon: 'alert-triangle',
      title: `Fix ${e} ${plural(e, 'e-invoice')}`,
      detail: [rejected ? `${rejected} rejected` : '', missing.length ? `missing ${firstFew(missing)}` : '', firstFew(f.einvoices.map((x) => x.no), 2)]
        .filter(Boolean).join(' · '),
      amountSen: null, since: minDay(f.einvoices.map((x) => x.since)),
      action: { label: 'Open', to: '/scm/einvoice', primary: false }, desk: 'finance',
    });
  }
  return out;
}

/** 1,234.56 — a figure the checklist prints. */
const figure = (sen: number): string => (sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ── The month's checklist ──────────────────────────────────────────────── */

const lastDayOfMonth = (ymd: string): number => {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

function checklist(f: TodoFacts): FinanceTodo['checklist'] {
  const accounts = f.bankAccounts.length;
  const statementsIn = accounts - bankMissing(f).length;
  const bankOpen = f.bankLines.length;
  const prevMonth = addDays(`${f.today.slice(0, 7)}-01`, -1);
  const locked = f.bankAccounts.filter((b) => f.lockedLastMonth.includes(b.accountCode)).length;
  const toCheck = f.vouchers.filter((v) => v.stage === 'check').length;
  const toApprove = f.vouchers.filter((v) => v.stage === 'approve').length;
  const waiting = f.requests.length + f.claims.filter((c) => !c.float).length;
  const items: TodoCheck[] = [
    { key: 'statements-in', label: 'Bank statements in', value: `${statementsIn} / ${accounts}`, state: statementsIn < accounts ? 'open' : 'ok', to: BANK_PAGE },
    { key: 'bank-open', label: 'Bank lines open', value: String(bankOpen), state: bankOpen ? 'open' : 'ok', to: BANK_PAGE },
    {
      key: 'months-locked', label: `${monthOf(prevMonth)} locked`, value: `${locked} / ${accounts}`,
      /* Last month should be shut by mid-month; until then it is simply still open. */
      state: locked >= accounts ? 'ok' : Number(f.today.slice(8, 10)) > 15 ? 'late' : 'open', to: BANK_PAGE,
    },
    {
      key: 'vouchers', label: 'Vouchers in progress',
      value: toCheck + toApprove === 0 ? 'none' : [toCheck && `${toCheck} to check`, toApprove && `${toApprove} to approve`].filter(Boolean).join(' · '),
      state: toCheck + toApprove ? 'open' : 'ok', to: '/scm/payment-vouchers',
    },
    {
      key: 'waiting', label: 'Waiting for payment', value: waiting ? String(waiting) : 'none',
      state: waiting ? 'open' : 'ok', to: REQUESTS_PAGE, detail: 'Payment requests and staff claims finance pays, not started on',
    },
    {
      key: 'receipts', label: 'Payments to confirm', value: f.receipts.length ? String(f.receipts.length) : 'none',
      state: f.receipts.length ? 'open' : 'ok', to: '/scm/official-receipts?status=DRAFT',
    },
    {
      key: 'trial-balance', label: 'Trial balance',
      value: f.trialBalanceDiffSen == null ? 'not checked' : figure(Math.abs(f.trialBalanceDiffSen)),
      state: f.trialBalanceDiffSen == null ? 'open' : f.trialBalanceDiffSen === 0 ? 'ok' : 'late', to: '/scm/accounting?tab=tb',
      ...(f.trialBalanceDiffSen == null ? {} : { detail: f.trialBalanceDiffSen === 0 ? 'Debits equal credits' : 'Debits and credits differ' }),
    },
  ];
  return { month: f.today.slice(0, 7), daysLeft: lastDayOfMonth(f.today) - Number(f.today.slice(8, 10)), items };
}

/* ── The page ───────────────────────────────────────────────────────────── */

function whoseDesk(desk: Desk, v: TodoViewer): { mine: boolean; who: string } {
  if (desk === 'checker') return { mine: v.checker, who: 'Checker' };
  if (desk === 'approver') return { mine: v.approver, who: 'Approver' };
  if (desk === 'limits') return { mine: v.limitApprover, who: 'Approver' };
  if (desk === 'asker') return { mine: false, who: 'Approver' };
  return { mine: v.finance, who: 'Finance' };
}

/** Every job the rules raise, split by whose desk it is on. A rule switched off raises nothing. */
export function raiseJobs(f: TodoFacts, viewer: TodoViewer): { mine: TodoJob[]; others: TodoJob[] } {
  const off = new Set(f.rulesOff);
  const raised = [...paymentJobs(f), ...limitJobs(f, viewer), ...bankJobs(f), ...moneyInJobs(f)].filter((j) => !off.has(j.rule));
  const mine: TodoJob[] = [];
  const others: TodoJob[] = [];
  for (const { desk, ...job } of raised) {
    const d = whoseDesk(desk, viewer);
    if (d.mine) mine.push({ ...job, who: null });
    else others.push({ ...job, who: d.who });
  }
  return { mine, others };
}

export function buildFinanceTodo(f: TodoFacts, viewer: TodoViewer): FinanceTodo {
  const { mine, others } = raiseJobs(f, viewer);
  return {
    today: f.today,
    mine,
    others,
    done: [...f.done].sort((a, b) => b.at.localeCompare(a.at)),
    checklist: checklist(f),
    problems: f.problems,
  };
}
