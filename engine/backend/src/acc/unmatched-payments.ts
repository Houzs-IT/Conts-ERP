// ----------------------------------------------------------------------------
// unmatched-payments — every customer payment that is not matched yet, on one
// list. Ported from Houzs (acc/unmatched-payments.ts) and cut to what Conts has.
//
// In Conts a customer payment is RECEIVED only once finance confirms it
// (acc/receipt-confirm.ts): its receipt turns FORMAL, and only then does it
// post. So a payment is open on this list while either is true:
//   1. it is still waiting for confirmation — its receipt is a DRAFT (a card
//      payment waits for Merchant recon, step 1; cash and transfers wait for
//      finance to confirm them against the bank);
//   2. it is confirmed but its money is not matched to a bank statement line
//      yet (Bank recon, step 2): its live entry is claimed by no POSTED line —
//      neither a match row on one, nor the line's own posted_je_no.
// A card payment whose merchant report line is confirmed is matched here: what
// is left of it is the report's payout, which is on the bank lines list.
//
// Not listed, on purpose:
//   converted / imported / credit — not money arriving from a customer
//               (acc/receipts awaitsConfirmation);
//   before the ledger start date — inside the AutoCount opening balances,
//               never booked here;
//   a confirmed payment booked on the CASH account — booked before
//               confirmation existed; that account takes no statement;
//   cancelled orders.
//
// Houzs concepts left out: merchant names / acquirer aliases, DuitNow QR lines,
// payments a bank movement settled itself, and "previous records".
//
// The decision is `classifyUnmatched`, a pure function; `loadUnmatchedPayments`
// only gathers the facts. Every read fails CLOSED — a short list would call
// money nobody has looked at "matched".
// ----------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped throughout the acc layer */
import { chunkIn, paginateAll } from '../scm/lib/paginate-all';
import { jeNosOf } from './bank';
import { isBeforeLedgerStart, loadLedgerSettings } from './ledger-settings';
import { awaitsConfirmation } from './receipts';
import { resolveRoles } from './rules';

export type PaymentSource = 'SOPAY' | 'SIPAY';

/** Where an unmatched payment is stuck — the screen words each one. */
export type UnmatchedState =
  /** A card payment no merchant report line has claimed yet. */
  | 'CARD_NOT_REPORTED'
  /** A merchant report line claims it; nobody has confirmed that line yet. */
  | 'CARD_TO_CONFIRM'
  /** Cash or a transfer finance has not confirmed against the bank yet. */
  | 'WAITING_CONFIRMATION'
  /** Confirmed, but there is no live entry for it in the books. */
  | 'CONFIRMED_NOT_POSTED'
  /** Confirmed and booked; its bank's statement for the day is uploaded, no line matched to it. */
  | 'NOT_MATCHED'
  /** Confirmed and booked; no statement of its bank reaching its day is uploaded yet. */
  | 'NO_STATEMENT';

export type UnmatchedPayment = {
  source: PaymentSource;
  paymentId: string;
  docNo: string;
  customerName: string | null;
  salespersonName: string | null;
  /** Who took the money — the payment's own collected_by. */
  collectedByName: string | null;
  paidOn: string;
  method: string;
  kind: 'card' | 'transfer' | 'cash';
  /** card: the bank it was keyed with; transfer: its sub-type (TNG, Bank Transfer …). */
  channel: string | null;
  amountSen: number;
  /** The approval code or transfer reference keyed with it. */
  reference: string | null;
  /** The receipt's number (its draft number while it waits). */
  orNumber: string | null;
  ageDays: number;
  state: UnmatchedState;
  /** Confirmed: the money account its entry debits, and the last day that account's statements reach. */
  bankAccountCode: string | null;
  statementUpTo: string | null;
  /** Confirmed: its live entry's number. */
  jeNo: string | null;
};

/** One recorded payment, as the classifier needs it. */
export type PaymentFact = {
  source: PaymentSource;
  id: string;
  docNo: string;
  customerName: string | null;
  salespersonName: string | null;
  collectedByName?: string | null;
  paidOn: string;
  method: string;
  merchantProvider: string | null;
  onlineType: string | null;
  amountSen: number;
  approvalCode: string | null;
};

/** What the confirmation and the two reconciliations have said, keyed `${source}:${id}`. */
export type MatchFacts = {
  /** Payments finance has confirmed: a FORMAL receipt, or a live entry from before confirmation existed. */
  confirmed: Set<string>;
  /** Each payment's receipt number. */
  receiptNo: Map<string, string>;
  /** The merchant report line claiming a card payment, and whether it is confirmed. */
  merchantClaims: Map<string, { confirmed: boolean }>;
  /** A payment's live journal entry: its number and the money account it debits. */
  entries: Map<string, { jeNo: string; accountCode: string | null }>;
  /** Entry numbers a POSTED bank statement line claims. */
  onTheBank: Set<string>;
  /** Money account → the last day its uploaded statements cover. */
  statementUpTo: Map<string, string>;
  /** The CASH role's account: no statement is ever uploaded for it. */
  cashAccount: string | null;
};

const CARD_METHODS: ReadonlySet<string> = new Set(['merchant', 'installment']);

export const dayGap = (from: string, to: string): number =>
  Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));

const tagOf = (v: string | null | undefined): string | null => {
  const t = String(v ?? '').trim();
  return t === '' ? null : t;
};

const kindOf = (method: string): UnmatchedPayment['kind'] =>
  (CARD_METHODS.has(method) ? 'card' : method === 'cash' ? 'cash' : 'transfer');

/** Every payment below that is not matched, oldest first — the one that has waited longest is the one to chase. */
export function classifyUnmatched(payments: readonly PaymentFact[], facts: MatchFacts, today: string): UnmatchedPayment[] {
  const out: UnmatchedPayment[] = [];
  for (const p of payments) {
    if (!awaitsConfirmation(p.method, p.amountSen)) continue;
    const key = `${p.source}:${p.id}`;
    const kind = kindOf(p.method);
    const claim = facts.merchantClaims.get(key);
    /* A card the merchant report confirmed is matched; its payout is the bank's question. */
    if (kind === 'card' && claim?.confirmed) continue;
    const base = {
      source: p.source,
      paymentId: p.id,
      docNo: p.docNo,
      customerName: p.customerName,
      salespersonName: p.salespersonName,
      collectedByName: p.collectedByName ?? null,
      paidOn: p.paidOn,
      method: p.method,
      kind,
      channel: tagOf(kind === 'card' ? p.merchantProvider : p.onlineType),
      amountSen: p.amountSen,
      reference: tagOf(p.approvalCode),
      orNumber: facts.receiptNo.get(key) ?? null,
      ageDays: dayGap(p.paidOn, today),
      bankAccountCode: null,
      statementUpTo: null,
      jeNo: null,
    };
    if (!facts.confirmed.has(key)) {
      const state: UnmatchedState = kind !== 'card' ? 'WAITING_CONFIRMATION' : claim ? 'CARD_TO_CONFIRM' : 'CARD_NOT_REPORTED';
      out.push({ ...base, state });
      continue;
    }
    const entry = facts.entries.get(key);
    if (!entry) {
      out.push({ ...base, state: 'CONFIRMED_NOT_POSTED' });
      continue;
    }
    if (facts.onTheBank.has(entry.jeNo)) continue;
    /* Booked on the cash account before confirmation existed: nothing to match it against. */
    if (entry.accountCode != null && entry.accountCode === facts.cashAccount) continue;
    const upTo = entry.accountCode ? (facts.statementUpTo.get(entry.accountCode) ?? null) : null;
    out.push({
      ...base,
      state: upTo != null && upTo >= p.paidOn ? 'NOT_MATCHED' : 'NO_STATEMENT',
      bankAccountCode: entry.accountCode,
      statementUpTo: upTo,
      jeNo: entry.jeNo,
    });
  }
  return out.sort((a, b) => b.ageDays - a.ageDays || a.docNo.localeCompare(b.docNo));
}

/* ── The reads ──────────────────────────────────────────────────────────── */

type Fail = { ok: false; reason: string };
type Rows = Array<Record<string, any>>;

const isoDay = (v: unknown): string => String(v ?? '').slice(0, 10);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Both payment tables, in the window — paged, so the row ceiling cannot quietly shorten the list. */
async function readPayments(sb: any, companyId: number, from: string, to: string): Promise<{ ok: true; so: Rows; si: Rows } | Fail> {
  const cols = 'id, paid_at, amount_sen, approval_code, method, merchant_provider, online_type, collected_by';
  const so = await paginateAll<Record<string, any>>((lo, hi) => sb.from('mfg_sales_order_payments')
    .select(`${cols}, so_doc_no`).eq('company_id', companyId)
    .gte('paid_at', from).lte('paid_at', `${to}T23:59:59.999`)
    .order('id').range(lo, hi));
  if (so.error) return { ok: false, reason: `SO payments: ${so.error.message}` };
  const si = await paginateAll<Record<string, any>>((lo, hi) => sb.from('sales_invoice_payments')
    .select(`${cols}, sales_invoice_id`).eq('company_id', companyId)
    .gte('paid_at', from).lte('paid_at', `${to}T23:59:59.999`)
    .order('id').range(lo, hi));
  if (si.error) return { ok: false, reason: `SI payments: ${si.error.message}` };
  return { ok: true, so: so.data ?? [], si: si.data ?? [] };
}

/** Whose sale each payment is, and the names of the salespeople and collectors. */
async function readParties(sb: any, companyId: number, so: Rows, si: Rows): Promise<{
  ok: true; orders: Map<string, { customer: string | null; cancelled: boolean; salesperson: string | null }>;
  invoices: Map<string, { number: string | null; customer: string | null }>;
  staffName: Map<string, string>;
} | Fail> {
  const docs = [...new Set(so.map((r) => String(r.so_doc_no ?? '')).filter(Boolean))];
  const orderRows = await chunkIn<Record<string, any>>(docs, (batch, lo, hi) => sb.from('mfg_sales_orders')
    .select('doc_no, debtor_name, status, salesperson_id')
    .eq('company_id', companyId).in('doc_no', batch).order('doc_no').range(lo, hi));
  if (orderRows.error) return { ok: false, reason: `orders: ${orderRows.error.message}` };

  const staffIds = [...new Set([
    ...orderRows.data.map((r) => String(r.salesperson_id ?? '')),
    ...[...so, ...si].map((r) => String(r.collected_by ?? '')),
  ].filter(Boolean))];
  const staffRows = await chunkIn<Record<string, any>>(staffIds, (batch, lo, hi) => sb.from('staff')
    .select('id, name').in('id', batch).order('id').range(lo, hi));
  if (staffRows.error) return { ok: false, reason: `staff: ${staffRows.error.message}` };
  const nameOf = new Map(staffRows.data.filter((r) => r.name).map((r) => [String(r.id), String(r.name)]));

  const orders = new Map<string, { customer: string | null; cancelled: boolean; salesperson: string | null }>();
  for (const r of orderRows.data) {
    orders.set(String(r.doc_no), {
      customer: r.debtor_name ?? null,
      cancelled: String(r.status ?? '').toUpperCase() === 'CANCELLED',
      salesperson: nameOf.get(String(r.salesperson_id ?? '')) ?? null,
    });
  }
  const invoiceIds = [...new Set(si.map((r) => String(r.sales_invoice_id ?? '')).filter(Boolean))];
  const invoiceRows = await chunkIn<Record<string, any>>(invoiceIds, (batch, lo, hi) => sb.from('sales_invoices')
    .select('id, invoice_number, debtor_name')
    .eq('company_id', companyId).in('id', batch).order('id').range(lo, hi));
  if (invoiceRows.error) return { ok: false, reason: `invoices: ${invoiceRows.error.message}` };
  const invoices = new Map(invoiceRows.data.map((r) => [String(r.id), { number: r.invoice_number ?? null, customer: r.debtor_name ?? null }]));
  return { ok: true, orders, invoices, staffName: nameOf };
}

/** Each payment's receipt — FORMAL is confirmed — and its number. */
async function readReceipts(sb: any, companyId: number, ids: string[]): Promise<{ ok: true; formal: Set<string>; receiptNo: Map<string, string> } | Fail> {
  const rows = await chunkIn<Record<string, any>>(ids, (batch, lo, hi) => sb.from('acc_official_receipts')
    .select('payment_source, payment_id, or_number, status')
    .eq('company_id', companyId).in('payment_id', batch).order('payment_id').range(lo, hi));
  if (rows.error) return { ok: false, reason: `receipts: ${rows.error.message}` };
  const formal = new Set<string>();
  const receiptNo = new Map<string, string>();
  for (const r of rows.data) {
    const key = `${String(r.payment_source)}:${String(r.payment_id)}`;
    if (r.or_number) receiptNo.set(key, String(r.or_number));
    if (String(r.status) === 'FORMAL') formal.add(key);
  }
  return { ok: true, formal, receiptNo };
}

/** Which card payments a merchant report line claims, and whether that line is confirmed (its fee booked). */
async function readMerchantClaims(sb: any, companyId: number, ids: string[]): Promise<{ ok: true; claims: MatchFacts['merchantClaims'] } | Fail> {
  const claims: MatchFacts['merchantClaims'] = new Map();
  if (ids.length === 0) return { ok: true, claims };
  const links = await chunkIn<Record<string, any>>(ids, (batch, lo, hi) => sb.from('acc_settlement_matches')
    .select('payment_source, payment_id, settlement_row_id')
    .eq('company_id', companyId).in('payment_id', batch).order('payment_id').range(lo, hi));
  if (links.error) return { ok: false, reason: `settlement links: ${links.error.message}` };
  const rowIds = [...new Set(links.data.map((l) => Number(l.settlement_row_id)).filter((n) => Number.isInteger(n)))];
  const lines = await chunkIn<Record<string, any>, number>(rowIds, (batch, lo, hi) => sb.from('acc_settlement_rows')
    .select('id, confirmed_at, posted_je_no')
    .eq('company_id', companyId).in('id', batch).order('id').range(lo, hi));
  if (lines.error) return { ok: false, reason: `settlement lines: ${lines.error.message}` };
  /* Confirmed = its fee booked — the test acc/payment-reconciled applies too. A link alone is the matcher's word. */
  const confirmedLine = new Set(lines.data.filter((r) => r.confirmed_at != null || r.posted_je_no != null).map((r) => Number(r.id)));
  for (const l of links.data) {
    const key = `${String(l.payment_source)}:${String(l.payment_id)}`;
    const confirmed = confirmedLine.has(Number(l.settlement_row_id)) || (claims.get(key)?.confirmed ?? false);
    claims.set(key, { confirmed });
  }
  return { ok: true, claims };
}

/** Each payment's live entry and money account, which entries a POSTED statement line claims, and how far each
    account's statements reach. */
async function readBankFacts(sb: any, companyId: number, ids: string[]): Promise<{
  ok: true; entries: MatchFacts['entries']; onTheBank: MatchFacts['onTheBank']; statementUpTo: MatchFacts['statementUpTo'];
} | Fail> {
  const jeRows = await chunkIn<Record<string, any>>(ids, (batch, lo, hi) => sb.from('journal_entries')
    .select('id, je_no, source_type, source_doc_no, reversed')
    .eq('company_id', companyId).in('source_type', ['SOPAY', 'SIPAY']).in('source_doc_no', batch)
    .eq('posted', true).order('je_no').range(lo, hi));
  if (jeRows.error) return { ok: false, reason: `entries: ${jeRows.error.message}` };
  /* `reversed` read here, not filtered in the query: the fake leaves it absent on a fresh row. */
  const live = jeRows.data.filter((r) => r.reversed !== true);

  const lineRows = await chunkIn<Record<string, any>>(live.map((r) => String(r.id)), (batch, lo, hi) => sb.from('journal_entry_lines')
    .select('journal_entry_id, account_code, debit_sen')
    .in('journal_entry_id', batch).order('journal_entry_id').range(lo, hi));
  if (lineRows.error) return { ok: false, reason: `entry lines: ${lineRows.error.message}` };
  /* The MONEY leg is the debit — the credit is the customer's control, never a bank. */
  const moneyOf = new Map<string, string>();
  for (const l of lineRows.data) {
    const id = String(l.journal_entry_id);
    if (Number(l.debit_sen ?? 0) > 0 && !moneyOf.has(id)) moneyOf.set(id, String(l.account_code));
  }
  const entries: MatchFacts['entries'] = new Map();
  for (const r of live) entries.set(`${String(r.source_type)}:${String(r.source_doc_no)}`, { jeNo: String(r.je_no), accountCode: moneyOf.get(String(r.id)) ?? null });

  const jeNos = [...new Set(live.map((r) => String(r.je_no)))];
  const matchRows = await chunkIn<Record<string, any>>(jeNos, (batch, lo, hi) => sb.from('acc_bank_statement_matches')
    .select('je_no, bank_line_id').eq('company_id', companyId).in('je_no', batch).order('bank_line_id').range(lo, hi));
  if (matchRows.error) return { ok: false, reason: `bank matches: ${matchRows.error.message}` };
  const matchedLineIds = [...new Set(matchRows.data.map((m) => Number(m.bank_line_id)).filter((n) => Number.isInteger(n)))];
  const matchedLines = await chunkIn<Record<string, any>, number>(matchedLineIds, (batch, lo, hi) => sb.from('acc_bank_statement_lines')
    .select('id, state').eq('company_id', companyId).in('id', batch).order('id').range(lo, hi));
  if (matchedLines.error) return { ok: false, reason: `bank lines: ${matchedLines.error.message}` };
  /* A match row on a line that is not POSTED is nobody's claim (an older undo left it behind). */
  const postedLine = new Set(matchedLines.data.filter((l) => String(l.state) === 'POSTED').map((l) => Number(l.id)));
  const onTheBank = new Set<string>();
  for (const m of matchRows.data) if (postedLine.has(Number(m.bank_line_id))) onTheBank.add(String(m.je_no));

  const named = await paginateAll<Record<string, any>>((lo, hi) => sb.from('acc_bank_statement_lines')
    .select('id, posted_je_no').eq('company_id', companyId).eq('state', 'POSTED').not('posted_je_no', 'is', null)
    .order('id').range(lo, hi));
  if (named.error) return { ok: false, reason: `bank lines: ${named.error.message}` };
  for (const l of named.data ?? []) for (const n of jeNosOf(l.posted_je_no)) onTheBank.add(n);

  const statements = await paginateAll<Record<string, any>>((lo, hi) => sb.from('acc_bank_statements')
    .select('id, account_code, period_to').eq('company_id', companyId).order('id').range(lo, hi));
  if (statements.error) return { ok: false, reason: `bank statements: ${statements.error.message}` };
  const statementUpTo: MatchFacts['statementUpTo'] = new Map();
  for (const s of statements.data ?? []) {
    const account = String(s.account_code ?? '');
    const to = isoDay(s.period_to);
    if (!account || !DAY.test(to)) continue;
    const had = statementUpTo.get(account);
    if (had == null || to > had) statementUpTo.set(account, to);
  }
  return { ok: true, entries, onTheBank, statementUpTo };
}

/** Every customer payment dated in [from, to] that is not matched yet. */
export async function loadUnmatchedPayments(
  sb: any,
  companyId: number,
  window: { from: string; to: string; today: string },
): Promise<{ ok: true; rows: UnmatchedPayment[] } | Fail> {
  const ls = await loadLedgerSettings(sb, companyId);
  if (!ls.ok) return { ok: false, reason: 'ledger settings could not be read' };
  const pay = await readPayments(sb, companyId, window.from, window.to);
  if (!pay.ok) return pay;
  const parties = await readParties(sb, companyId, pay.so, pay.si);
  if (!parties.ok) return parties;

  const facts: PaymentFact[] = [];
  const take = (source: PaymentSource, r: Record<string, any>, docNo: string, customer: string | null, salesperson: string | null) => {
    const paidOn = isoDay(r.paid_at);
    if (!DAY.test(paidOn)) return;
    /* Before the books start here: inside the opening balances, never booked or matched here. */
    if (isBeforeLedgerStart(paidOn, ls.settings)) return;
    facts.push({
      source, id: String(r.id), docNo, customerName: customer, salespersonName: salesperson,
      collectedByName: parties.staffName.get(String(r.collected_by ?? '')) ?? null, paidOn,
      method: String(r.method ?? ''), merchantProvider: r.merchant_provider ?? null, onlineType: r.online_type ?? null,
      amountSen: Number(r.amount_sen ?? 0), approvalCode: r.approval_code ?? null,
    });
  };
  for (const r of pay.so) {
    const doc = String(r.so_doc_no ?? '');
    const order = parties.orders.get(doc);
    if (order?.cancelled) continue;
    take('SOPAY', r, doc, order?.customer ?? null, order?.salesperson ?? null);
  }
  for (const r of pay.si) {
    const inv = parties.invoices.get(String(r.sales_invoice_id ?? ''));
    take('SIPAY', r, inv?.number ?? String(r.sales_invoice_id ?? ''), inv?.customer ?? null, null);
  }
  const listed = facts.filter((f) => awaitsConfirmation(f.method, f.amountSen));
  const ids = [...new Set(listed.map((f) => f.id))];
  if (ids.length === 0) return { ok: true, rows: [] };

  const [receipts, merchant, bank] = await Promise.all([
    readReceipts(sb, companyId, ids),
    readMerchantClaims(sb, companyId, [...new Set(listed.filter((f) => CARD_METHODS.has(f.method)).map((f) => f.id))]),
    readBankFacts(sb, companyId, ids),
  ]);
  if (!receipts.ok) return receipts;
  if (!merchant.ok) return merchant;
  if (!bank.ok) return bank;
  /* Confirmed: a FORMAL receipt, or a live entry from before confirmation existed (acc/receipts receiptConfirmation). */
  const confirmed = new Set(receipts.formal);
  for (const key of bank.entries.keys()) confirmed.add(key);
  const roles = await resolveRoles(sb, companyId);

  return {
    ok: true,
    rows: classifyUnmatched(listed, {
      confirmed,
      receiptNo: receipts.receiptNo,
      merchantClaims: merchant.claims,
      entries: bank.entries,
      onTheBank: bank.onTheBank,
      statementUpTo: bank.statementUpTo,
      cashAccount: roles.CASH,
    }, window.today),
  };
}
