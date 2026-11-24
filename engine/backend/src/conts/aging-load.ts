// Conts only (ported from Houzs acc/aging-load.ts + acc/party-ledger.ts on 21 Nov 2026, then adapted): reads what
// the formal AR / AP aging needs and turns each control-account line into the pieces acc/aging.ts knocks off. Every
// counted line on the controls up to the date becomes one or more pieces that add back to it, so the report always
// adds up to the books.
//
// What is Conts here, not Houzs:
//   · the controls are every customer control (special type SDC) or every supplier control (SCC) of the chart, as
//     the Debtors page and the party ledger read them, plus the role accounts (300 / 305, 400 / 405) in case the chart
//     does not flag them; one of them can be asked for alone;
//   · a customer is its debtor code (scm.debtors), named as the Debtors page names it; a line coded with the order's
//     customer id is that debtor's when the debtor carries the id (party-ledger.ts reads a customer the same way);
//   · the OPENING journal names no party: it carries each control as one figure. Its line is replaced by the opening
//     documents it stands for (acc/opening.ts) — opening invoices and bills as bills of their own date, opening
//     customer credits and supplier opening vouchers as money against — and what the documents do not explain stays
//     one line, "Opening balance not split", so the total is still the books';
//   · AutoCount's own books between the start and the documents' cut-over (ACJ journals, acc/autocount-journals) are
//     what the opening documents already stand at: once the date reaches the cut-over they join the OPENING line and
//     are replaced by the same documents, never aged a second time beside them (chew, 23 Nov 2026: a customer read its
//     opening invoice and AutoCount's invoice for it both, SAFFIRE RM 136,000 owed of RM 68,000);
//   · a renovation contract posted whole to the customer at signing (RCON) and its changes (RVO, RCAN) belong to the
//     contract's order, with the order's payments and credit notes;
//   · there are no knock-off tables for notes in Conts: a credit / debit note joins the order or invoice its header
//     names, a supplier credit note the bill it names;
//   · a line no paper names (a claim, a payment request, an accrual, a voucher with no ticks) joins its party's pool:
//     the party's unnamed lines knock each other off oldest first;
//   · a department filter reads only that department's lines (as the trial balance does).
//   AR  SOPAY the payment → its order; SOCONV Dr the order the money left, Cr the order it went to; SIPAY the invoice
//       payment → its invoice → its order (or the invoice alone); SI the invoice → its order; DI the deposit invoice →
//       its order; CN / DN the note → its order, else its invoice; PV a customer refund → the order or invoice it
//       refunds; ODB an Other Debtor bill is its own group, ODR a receipt's allocations join the bills they name and
//       the rest is 未冲.
//   AP  PI / API lines are the bills; a voucher's line is split by its ticks (pv_allocations, an advance applied
//       counted from the day it was applied), a foreign bill's ticks turned into ringgit at its rate; SCN joins the bill
//       its header names.
// ----------------------------------------------------------------------------

import { chunkIn, paginateAll } from '../scm/lib/paginate-all';
import { toMyrSen } from '../scm/lib/fx';
import { customerPartyCode } from '../acc/payments';
import { countsInTheBooks } from '../acc/reversal-pairs';
import { apControlOf, resolveRoles, type Department, type RoleCodes } from '../acc/rules';
import { splitLine, type AgingEntry, type AgingParty } from '../acc/aging';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as everywhere in acc/ */
type Db = any;
type Row = Record<string, any>;
type Fail = { ok: false; reason: string };

export type AgingSide = 'AR' | 'AP';
export type ControlAccount = { code: string; name: string; other: boolean };
export type ControlBalance = { code: string; balanceSen: number };
export type ControlLine = {
  je_no: string; entry_date: string; source_type: string; source_doc_no: string | null; account_code: string;
  party_code: string | null; party_name: string | null; debit_sen: number; credit_sen: number;
};
export type AgingLoad =
  | {
      ok: true;
      entries: AgingEntry[];
      controls: ControlBalance[];
      /** Open invoices brought over as migrated paperwork (migrated_no_stock): never booked here, so not aged. */
      outside: { count: number; sen: number };
      /** The OPENING journal's lines on these controls: how much the opening documents explain, and how much stays
          one unsplit line. */
      opening: { splitSen: number; unsplitSen: number };
    }
  | Fail;

/** The source type of the one opening journal (acc/opening.ts). */
export const OPENING_SOURCE = 'OPENING';
/** The party of what the opening documents do not explain. */
export const UNSPLIT_KEY = 'OPENING:UNSPLIT';
/** The source type of AutoCount's books brought in after the start (acc/autocount-journals AUTOCOUNT_SOURCE). */
export const AUTOCOUNT_SOURCE = 'ACJ';

/** The documents' cut-over (acc_company_settings.documents_cutover_date), or null when none is set. */
export async function documentsCutover(sb: Db, companyId: number): Promise<{ ok: true; day: string | null } | Fail> {
  const { data, error } = await sb.from('acc_company_settings').select('documents_cutover_date').eq('company_id', companyId).maybeSingle();
  if (error) return { ok: false, reason: `acc_company_settings: ${errText(error)}` };
  const cut = day((data as Row | null)?.documents_cutover_date);
  return { ok: true, day: /^\d{4}-\d{2}-\d{2}$/.test(cut) ? cut : null };
}

/** Whether a control line stands with the OPENING line: the opening journal itself, and, once the report reaches the
    documents' cut-over, AutoCount's journals up to it (the opening documents are as at that day). */
export function standsAsOpening(l: Pick<ControlLine, 'source_type' | 'entry_date'>, asOf: string, cutover: string | null): boolean {
  if (l.source_type === OPENING_SOURCE) return true;
  return cutover != null && asOf >= cutover && l.source_type === AUTOCOUNT_SOURCE && l.entry_date <= cutover;
}

const mytDate = (iso: unknown): string => new Date(Date.parse(String(iso)) + 8 * 3_600_000).toISOString().slice(0, 10);
const uniq = (xs: Array<string | null | undefined>): string[] => [...new Set(xs.filter((x): x is string => !!x))];
const day = (v: unknown): string => String(v ?? '').slice(0, 10);
const errText = (e: unknown): string => (e as { message?: string } | null)?.message ?? String(e);

/** Rows of `table` whose `col` is one of `values`, in this company. */
async function byValues(sb: Db, companyId: number, table: string, cols: string, col: string, values: string[]): Promise<{ ok: true; rows: Row[] } | Fail> {
  if (values.length === 0) return { ok: true, rows: [] };
  const { data, error } = await chunkIn<Row>(values, (batch, from, to) =>
    sb.from(table).select(cols).eq('company_id', companyId).in(col, batch).order(col).range(from, to));
  if (error) return { ok: false, reason: `${table}: ${error.message}` };
  return { ok: true, rows: data };
}

/** Every row of `table` in this company matching `filter`. */
async function allRows(sb: Db, companyId: number, table: string, cols: string, filter: (q: any) => any = (q) => q): Promise<{ ok: true; rows: Row[] } | Fail> {
  const { data, error } = await paginateAll<Row>((f, t) => filter(sb.from(table).select(cols).eq('company_id', companyId)).order('id').range(f, t));
  if (error) return { ok: false, reason: `${table}: ${errText(error)}` };
  return { ok: true, rows: (data ?? []) as Row[] };
}

/** The controls of one side: every SDC (customers) or SCC (suppliers) account of the chart, and the role accounts. */
export async function agingControls(sb: Db, companyId: number, side: AgingSide): Promise<{ ok: true; accounts: ControlAccount[]; roles: RoleCodes } | Fail> {
  const roles = await resolveRoles(sb, companyId);
  const { data, error } = await sb.from('accounts').select('account_code, account_name, special_type')
    .eq('company_id', companyId).eq('special_type', side === 'AR' ? 'SDC' : 'SCC');
  if (error) return { ok: false, reason: `accounts: ${error.message}` };
  const trade = side === 'AR' ? roles.AR : roles.AP;
  const other = side === 'AR' ? roles.AR_OTHER : roles.AP_OTHER;
  const byCode = new Map<string, string>();
  for (const a of (data ?? []) as Array<{ account_code: string; account_name: string | null }>) byCode.set(a.account_code, a.account_name ?? a.account_code);
  for (const code of [trade, other]) if (code && !byCode.has(code)) byCode.set(code, code);
  const accounts = [...byCode].map(([code, name]) => ({ code, name, other: code === other }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return { ok: true, accounts, roles };
}

/** Every counted line on these controls up to `asOf` (inclusive), one department's when asked. Fails closed: a read
    that errors is reported, never read as "no lines". */
export async function loadControlLines(sb: Db, companyId: number, codes: readonly string[], asOf: string, department: Department | null):
  Promise<{ ok: true; lines: ControlLine[] } | Fail> {
  const accounts = [...new Set(codes.filter(Boolean))];
  if (accounts.length === 0) return { ok: true, lines: [] };
  const { data, error } = await paginateAll((from, to) => {
    let q = sb.from('v_gl_entries')
      .select('line_id, je_no, entry_date, source_type, source_doc_no, account_code, party_code, party_name, debit_sen, credit_sen, posted, reversed, reversed_by_je')
      .eq('company_id', companyId).in('account_code', accounts).lte('entry_date', asOf);
    if (department) q = q.eq('department', department);
    return q.order('line_id').range(from, to);
  });
  if (error) return { ok: false, reason: `v_gl_entries: ${errText(error)}` };
  const lines: ControlLine[] = [];
  for (const r of (data ?? []) as Row[]) {
    if (!countsInTheBooks(r)) continue;
    lines.push({
      je_no: String(r.je_no ?? ''), entry_date: day(r.entry_date), source_type: String(r.source_type ?? ''),
      source_doc_no: r.source_doc_no == null ? null : String(r.source_doc_no), account_code: String(r.account_code ?? ''),
      party_code: r.party_code == null || r.party_code === '' ? null : String(r.party_code),
      party_name: r.party_name == null ? null : String(r.party_name),
      debit_sen: Number(r.debit_sen ?? 0), credit_sen: Number(r.credit_sen ?? 0),
    });
  }
  return { ok: true, lines };
}

function controlsOf(lines: readonly ControlLine[], codes: readonly string[], sideOf: (l: ControlLine) => number): ControlBalance[] {
  return codes.map((code) => ({ code, balanceSen: lines.filter((l) => l.account_code === code).reduce((n, l) => n + sideOf(l), 0) }));
}

/** What a line or a document names its party by, for when its paper does not. */
type Named = Pick<ControlLine, 'party_code' | 'party_name'>;
const nameKey = (name: string | null | undefined): string => `name:${String(name ?? '').trim().toUpperCase() || '—'}`;
/** The pool of a party's lines no paper names. */
const poolOf = (p: AgingParty): string => `PARTY:${p.key}`;

/**
 * The OPENING lines, replaced by the documents they stand for. `docs` are the opening documents with the control
 * each one sits on; a control's OPENING figure less its documents stays one unsplit piece. Documents on a control
 * with no OPENING line here (another department, an as-at day before the opening) are left out: the line they
 * explain is not in this report.
 */
export function openingEntries(
  openingLines: ReadonlyArray<{ line: ControlLine; amountSen: number }>,
  docs: ReadonlyArray<{ control: string; entries: AgingEntry[] }>,
): { entries: AgingEntry[]; splitSen: number; unsplitSen: number } {
  const byControl = new Map<string, { amountSen: number; date: string; jeNo: string }>();
  for (const { line, amountSen } of openingLines) {
    const at = byControl.get(line.account_code);
    if (at) at.amountSen += amountSen;
    else byControl.set(line.account_code, { amountSen, date: line.entry_date, jeNo: line.je_no });
  }
  const entries: AgingEntry[] = [];
  let splitSen = 0;
  let unsplitSen = 0;
  for (const [code, o] of byControl) {
    let explained = 0;
    for (const d of docs) {
      if (d.control !== code) continue;
      for (const e of d.entries) { entries.push(e); explained += e.amountSen; }
    }
    splitSen += explained;
    const left = o.amountSen - explained;
    if (left !== 0) {
      unsplitSen += left;
      entries.push({
        group: `OPENING:${code}`, party: { key: UNSPLIT_KEY, code: null, name: 'Opening balance not split' },
        docNo: o.jeNo, kind: `Opening balance ${code}`, date: o.date, dueDate: null, amountSen: left,
      });
    }
  }
  return { entries, splitSen, unsplitSen };
}

/* ── AR ─────────────────────────────────────────────────────────────────── */

export async function loadArAging(sb: Db, companyId: number, codes: readonly string[], asOf: string, department: Department | null, roles: RoleCodes): Promise<AgingLoad> {
  const got = await loadControlLines(sb, companyId, codes, asOf, department);
  if (!got.ok) return got;
  const lines = got.lines;
  const docsOf = (...types: string[]) => uniq(lines.filter((l) => types.includes(l.source_type)).map((l) => l.source_doc_no));
  /* A contract's change is numbered after its order (SO-…-2): the order is the number, or the number less its tail. */
  const contractDocs = docsOf('RCON', 'RVO', 'RCAN');
  const contractCandidates = uniq(contractDocs.flatMap((d) => [d, d.replace(/-\d+$/, '')]));
  const hasOpening = lines.some((l) => l.source_type === OPENING_SOURCE);

  const [pays, siPays, sisByNo, dis, notes, pvs, bills, receipts, debtors] = await Promise.all([
    byValues(sb, companyId, 'mfg_sales_order_payments', 'id, so_doc_no, converted_from_so_doc_no', 'id', docsOf('SOPAY', 'SOCONV')),
    byValues(sb, companyId, 'sales_invoice_payments', 'id, sales_invoice_id', 'id', docsOf('SIPAY')),
    byValues(sb, companyId, 'sales_invoices', 'id, invoice_number, so_doc_no, due_date, debtor_code, debtor_name', 'invoice_number', docsOf('SI')),
    byValues(sb, companyId, 'acc_deposit_invoices', 'di_number, so_doc_no', 'di_number', docsOf('DI')),
    byValues(sb, companyId, 'acc_credit_notes', 'id, note_number, kind, so_doc_no, sales_invoice_id', 'note_number', docsOf('CN', 'DN')),
    byValues(sb, companyId, 'payment_vouchers', 'pv_number, refund_source_type, refund_source_doc_no', 'pv_number', docsOf('PV')),
    byValues(sb, companyId, 'acc_debtor_bills', 'id, bill_number, debtor_id', 'bill_number', docsOf('ODB')),
    byValues(sb, companyId, 'acc_debtor_receipts', 'id, receipt_number, debtor_id', 'receipt_number', docsOf('ODR')),
    allRows(sb, companyId, 'debtors', 'id, code, name, customer_id, control_account'),
  ]);
  if (!pays.ok) return pays;
  if (!siPays.ok) return siPays;
  if (!sisByNo.ok) return sisByNo;
  if (!dis.ok) return dis;
  if (!notes.ok) return notes;
  if (!pvs.ok) return pvs;
  if (!bills.ok) return bills;
  if (!receipts.ok) return receipts;
  if (!debtors.ok) return debtors;

  /* Invoices named by id (a payment's or a note's) or by number (a refund's) that the SI lines did not bring. */
  const siById = new Map<string, Row>(sisByNo.rows.map((s) => [String(s.id), s]));
  const siByNo = new Map<string, Row>(sisByNo.rows.map((s) => [String(s.invoice_number), s]));
  const wantIds = uniq([...siPays.rows.map((p) => p.sales_invoice_id), ...notes.rows.map((n) => n.sales_invoice_id)].map((x) => (x == null ? null : String(x)))).filter((id) => !siById.has(id));
  const wantNos = uniq(pvs.rows.filter((v) => v.refund_source_type === 'SI').map((v) => v.refund_source_doc_no)).filter((n) => !siByNo.has(n));
  const [moreById, moreByNo, allocs, openingSis, openingCredits] = await Promise.all([
    byValues(sb, companyId, 'sales_invoices', 'id, invoice_number, so_doc_no, due_date, debtor_code, debtor_name', 'id', wantIds),
    byValues(sb, companyId, 'sales_invoices', 'id, invoice_number, so_doc_no, due_date, debtor_code, debtor_name', 'invoice_number', wantNos),
    byValues(sb, companyId, 'acc_debtor_receipt_allocations', 'id, receipt_id, bill_id, amount_sen', 'receipt_id', uniq(receipts.rows.map((r) => String(r.id)))),
    hasOpening
      ? allRows(sb, companyId, 'sales_invoices', 'id, invoice_number, so_doc_no, invoice_date, due_date, debtor_code, debtor_name, total_sen, status',
        (q) => q.eq('opening_balance', true).neq('status', 'CANCELLED'))
      : Promise.resolve({ ok: true as const, rows: [] as Row[] }),
    hasOpening
      ? allRows(sb, companyId, 'customer_credits', 'id, debtor_code, debtor_name, entry_date, amount_sen, source_doc_no', (q) => q.eq('source_type', 'OPENING'))
      : Promise.resolve({ ok: true as const, rows: [] as Row[] }),
  ]);
  if (!moreById.ok) return moreById;
  if (!moreByNo.ok) return moreByNo;
  if (!allocs.ok) return allocs;
  if (!openingSis.ok) return openingSis;
  if (!openingCredits.ok) return openingCredits;
  for (const s of [...moreById.rows, ...moreByNo.rows]) { siById.set(String(s.id), s); siByNo.set(String(s.invoice_number), s); }

  const payById = new Map(pays.rows.map((p) => [String(p.id), p]));
  const siPayById = new Map(siPays.rows.map((p) => [String(p.id), p]));
  const diByNo = new Map(dis.rows.map((d) => [String(d.di_number), d]));
  const noteByNo = new Map(notes.rows.map((n) => [String(n.note_number), n]));
  const pvByNo = new Map(pvs.rows.map((v) => [String(v.pv_number), v]));
  const billByNo = new Map(bills.rows.map((b) => [String(b.bill_number), b]));
  const billById = new Map(bills.rows.map((b) => [String(b.id), b]));
  const receiptByNo = new Map(receipts.rows.map((r) => [String(r.receipt_number), r]));
  const debtorByCode = new Map(debtors.rows.map((d) => [String(d.code), d]));
  const debtorByCustomer = new Map(debtors.rows.filter((d) => d.customer_id).map((d) => [String(d.customer_id), d]));

  /* The orders every line points at, and the Other Debtors of the other-debtor paper. */
  const soNos = uniq([
    ...pays.rows.flatMap((p) => [p.so_doc_no, p.converted_from_so_doc_no]),
    ...[...siById.values()].map((s) => s.so_doc_no),
    ...dis.rows.map((d) => d.so_doc_no),
    ...notes.rows.map((n) => n.so_doc_no),
    ...pvs.rows.filter((v) => v.refund_source_type === 'SO').map((v) => v.refund_source_doc_no),
    ...contractCandidates,
  ].map((x) => (x == null ? null : String(x))));
  const otherDebtorIds = uniq([...bills.rows.map((b) => b.debtor_id), ...receipts.rows.map((r) => r.debtor_id)].map((x) => (x == null ? null : String(x))));
  const [orders, otherDebtors] = await Promise.all([
    byValues(sb, companyId, 'mfg_sales_orders', 'doc_no, debtor_code, debtor_name, customer_id', 'doc_no', soNos),
    byValues(sb, companyId, 'acc_debtors', 'id, name', 'id', otherDebtorIds),
  ]);
  if (!orders.ok) return orders;
  if (!otherDebtors.ok) return otherDebtors;
  const orderByNo = new Map(orders.rows.map((o) => [String(o.doc_no), o]));
  const otherDebtorById = new Map(otherDebtors.rows.map((d) => [String(d.id), d]));

  /** A customer by the code its paper carries: a debtor code, or an order's customer id that a debtor carries. */
  const customer = (code: string | null | undefined, name: string | null | undefined): AgingParty => {
    const c = String(code ?? '').trim();
    const d = c ? debtorByCode.get(c) ?? debtorByCustomer.get(c) : undefined;
    if (d) return { key: String(d.code), code: String(d.code), name: String(d.name ?? name ?? d.code) };
    if (c) return { key: c, code: c, name: name ?? c };
    return { key: nameKey(name), code: null, name: name ?? '(no party)' };
  };
  const lineParty = (l: ControlLine): AgingParty => customer(l.party_code, l.party_name);

  const orderGroup = (so: string, l: Named): { group: string; party: AgingParty } => {
    const o = orderByNo.get(so);
    const code = customerPartyCode(o?.debtor_code, o?.customer_id) ?? l.party_code;
    return { group: `SO:${so}`, party: customer(code, o?.debtor_name ?? l.party_name) };
  };
  const invoiceGroup = (si: Row, l: Named): { group: string; party: AgingParty } => {
    if (si.so_doc_no) return orderGroup(String(si.so_doc_no), l);
    return { group: `SI:${si.id}`, party: customer(customerPartyCode(si.debtor_code, null) ?? l.party_code, si.debtor_name ?? l.party_name) };
  };
  const otherDebtorParty = (debtorId: unknown, l: ControlLine): AgingParty => {
    const id = debtorId == null ? null : String(debtorId);
    const d = id ? otherDebtorById.get(id) : undefined;
    return id ? { key: `DEBTOR:${id}`, code: null, name: d?.name ?? l.party_name ?? 'Other debtor' } : lineParty(l);
  };
  const contractOrder = (doc: string): string | null => {
    if (orderByNo.has(doc)) return doc;
    const base = doc.replace(/-\d+$/, '');
    return orderByNo.has(base) ? base : null;
  };

  const cut = await documentsCutover(sb, companyId);
  if (!cut.ok) return cut;
  const entries: AgingEntry[] = [];
  const openingLines: Array<{ line: ControlLine; amountSen: number }> = [];
  for (const l of lines) {
    const amountSen = l.debit_sen - l.credit_sen;
    if (amountSen === 0) continue;
    if (standsAsOpening(l, asOf, cut.day)) { openingLines.push({ line: l, amountSen }); continue; }
    const base = { docNo: l.source_doc_no ?? l.je_no, kind: l.source_type, date: l.entry_date, dueDate: null as string | null, amountSen };
    const doc = l.source_doc_no ?? '';
    let at: { group: string; party: AgingParty } | null = null;
    switch (l.source_type) {
      case 'SOPAY': {
        const p = payById.get(doc);
        base.kind = 'Payment';
        if (p?.so_doc_no) { at = orderGroup(String(p.so_doc_no), l); base.docNo = String(p.so_doc_no); }
        break;
      }
      case 'SOCONV': {
        const p = payById.get(doc);
        /* Dr the order the money left, Cr the order it went to (acc/payments.ts). */
        const so = amountSen > 0 ? p?.converted_from_so_doc_no : p?.so_doc_no;
        base.kind = amountSen > 0 ? 'Moved to another order' : 'Moved from another order';
        if (so) { at = orderGroup(String(so), l); base.docNo = String(so); }
        break;
      }
      case 'SIPAY': {
        const si = siById.get(String(siPayById.get(doc)?.sales_invoice_id ?? ''));
        base.kind = 'Payment';
        if (si) { at = invoiceGroup(si, l); base.docNo = String(si.invoice_number); }
        break;
      }
      case 'SI': {
        const si = siByNo.get(doc);
        base.kind = 'Invoice';
        if (si) { at = invoiceGroup(si, l); base.dueDate = si.due_date ? day(si.due_date) : null; }
        break;
      }
      case 'DI': {
        const d = diByNo.get(doc);
        base.kind = 'Deposit invoice';
        if (d?.so_doc_no) at = orderGroup(String(d.so_doc_no), l);
        break;
      }
      case 'CN':
      case 'DN': {
        const n = noteByNo.get(doc);
        const si = n?.sales_invoice_id ? siById.get(String(n.sales_invoice_id)) : undefined;
        base.kind = l.source_type === 'CN' ? 'Credit note' : 'Debit note';
        if (n?.so_doc_no) at = orderGroup(String(n.so_doc_no), l);
        else if (si) at = invoiceGroup(si, l);
        break;
      }
      case 'PV': {
        const v = pvByNo.get(doc);
        base.kind = 'Refund';
        if (v?.refund_source_type === 'SO' && v.refund_source_doc_no) at = orderGroup(String(v.refund_source_doc_no), l);
        else if (v?.refund_source_type === 'SI' && siByNo.get(String(v.refund_source_doc_no))) at = invoiceGroup(siByNo.get(String(v.refund_source_doc_no))!, l);
        break;
      }
      case 'RCON':
      case 'RVO':
      case 'RCAN': {
        const so = contractOrder(doc);
        base.kind = l.source_type === 'RCON' ? 'Contract' : l.source_type === 'RVO' ? 'Contract change' : 'Contract cancelled';
        if (so) { at = orderGroup(so, l); base.docNo = doc; }
        break;
      }
      case 'ODB': {
        const b = billByNo.get(doc);
        base.kind = 'Other debtor bill';
        if (b) at = { group: `ODB:${b.id}`, party: otherDebtorParty(b.debtor_id, l) };
        break;
      }
      case 'ODR': {
        const r = receiptByNo.get(doc);
        base.kind = 'Receipt';
        if (r) {
          const party = otherDebtorParty(r.debtor_id, l);
          const parts = allocs.rows.filter((a) => String(a.receipt_id) === String(r.id) && billById.has(String(a.bill_id)))
            .map((a) => ({ group: `ODB:${a.bill_id}`, amountSen: Number(a.amount_sen ?? 0), date: l.entry_date }));
          entries.push(...splitLine({ ...base, group: `ODR:${r.id}`, party }, parts));
          continue;
        }
        break;
      }
      default:
        break;
    }
    if (at) { entries.push({ ...base, ...at }); continue; }
    const party = lineParty(l);
    entries.push({ ...base, group: poolOf(party), party });
  }

  /* The OPENING line, by the documents it stands for: each opening invoice on its customer's control, each opening
     credit (paid ahead) in its customer's pool. */
  const controlOfDebtor = (code: string | null | undefined): string => {
    const d = code ? debtorByCode.get(String(code)) : undefined;
    return String(d?.control_account || roles.AR);
  };
  const docs: Array<{ control: string; entries: AgingEntry[] }> = [];
  for (const s of openingSis.rows) {
    const sen = Number(s.total_sen ?? 0);
    if (sen === 0 || day(s.invoice_date) > asOf) continue;
    const at = s.so_doc_no ? orderGroup(String(s.so_doc_no), { party_code: s.debtor_code ?? null, party_name: s.debtor_name ?? null })
      : { group: `SI:${s.id}`, party: customer(s.debtor_code, s.debtor_name) };
    docs.push({ control: controlOfDebtor(s.debtor_code), entries: [{
      ...at, docNo: String(s.invoice_number), kind: 'Opening invoice', date: day(s.invoice_date),
      dueDate: s.due_date ? day(s.due_date) : null, amountSen: sen,
    }] });
  }
  for (const c of openingCredits.rows) {
    const sen = Number(c.amount_sen ?? 0);
    if (sen === 0 || day(c.entry_date) > asOf) continue;
    const party = customer(c.debtor_code, c.debtor_name);
    docs.push({ control: controlOfDebtor(c.debtor_code), entries: [{
      group: poolOf(party), party, docNo: String(c.source_doc_no ?? 'OPENING'), kind: 'Opening credit', date: day(c.entry_date), dueDate: null, amountSen: -sen,
    }] });
  }
  const opening = openingEntries(openingLines, docs);
  entries.push(...opening.entries);

  const outside = await outsideTheBooks(sb, companyId, 'sales_invoices', false);
  if (!outside.ok) return outside;
  return {
    ok: true, entries, controls: controlsOf(lines, codes, (l) => l.debit_sen - l.credit_sen), outside: outside.outside,
    opening: { splitSen: opening.splitSen, unsplitSen: opening.unsplitSen },
  };
}

/* ── AP ─────────────────────────────────────────────────────────────────── */

export async function loadApAging(sb: Db, companyId: number, codes: readonly string[], asOf: string, department: Department | null, roles: RoleCodes): Promise<AgingLoad> {
  const got = await loadControlLines(sb, companyId, codes, asOf, department);
  if (!got.ok) return got;
  const lines = got.lines;
  const docsOf = (t: string) => uniq(lines.filter((l) => l.source_type === t).map((l) => l.source_doc_no));
  const hasOpening = lines.some((l) => l.source_type === OPENING_SOURCE);
  const none = Promise.resolve({ ok: true as const, rows: [] as Row[] });

  const [pisByNo, apisByNo, pvs, scns, sups, openingPis, openingPvs] = await Promise.all([
    byValues(sb, companyId, 'purchase_invoices', 'id, invoice_number, due_date, exchange_rate', 'invoice_number', docsOf('PI')),
    byValues(sb, companyId, 'ap_invoices', 'id, invoice_number, due_date', 'invoice_number', docsOf('API')),
    byValues(sb, companyId, 'payment_vouchers', 'id, pv_number, voucher_date', 'pv_number', docsOf('PV')),
    byValues(sb, companyId, 'acc_credit_notes', 'id, note_number, purchase_invoice_id, ap_invoice_id', 'note_number', docsOf('SCN')),
    allRows(sb, companyId, 'suppliers', 'id, code, name, control_account'),
    hasOpening
      ? allRows(sb, companyId, 'purchase_invoices', 'id, invoice_number, supplier_id, invoice_date, due_date, total_sen, exchange_rate, status',
        (q) => q.eq('opening_balance', true).neq('status', 'CANCELLED'))
      : none,
    hasOpening
      ? allRows(sb, companyId, 'payment_vouchers', 'id, pv_number, supplier_id, voucher_date, total_sen, status', (q) => q.eq('opening_balance', true).neq('status', 'CANCELLED'))
      : none,
  ]);
  if (!pisByNo.ok) return pisByNo;
  if (!apisByNo.ok) return apisByNo;
  if (!pvs.ok) return pvs;
  if (!scns.ok) return scns;
  if (!sups.ok) return sups;
  if (!openingPis.ok) return openingPis;
  if (!openingPvs.ok) return openingPvs;

  const pvAllocs = await byValues(sb, companyId, 'pv_allocations', 'id, pv_id, pi_id, ap_invoice_id, amount_sen, applied_sen, from_advance, created_at', 'pv_id',
    uniq([...pvs.rows, ...openingPvs.rows].map((v) => String(v.id))));
  if (!pvAllocs.ok) return pvAllocs;

  /* The bills a tick or a note names that no bill line brought (one paid in an earlier month, an opening bill) — for
     their number and rate. */
  const piById = new Map(pisByNo.rows.map((p) => [String(p.id), p]));
  const apiById = new Map(apisByNo.rows.map((a) => [String(a.id), a]));
  for (const p of openingPis.rows) piById.set(String(p.id), p);
  const named = [...pvAllocs.rows, ...scns.rows];
  const [morePis, moreApis] = await Promise.all([
    byValues(sb, companyId, 'purchase_invoices', 'id, invoice_number, due_date, exchange_rate', 'id',
      uniq(named.map((a) => (a.pi_id ?? a.purchase_invoice_id) == null ? null : String(a.pi_id ?? a.purchase_invoice_id))).filter((id) => !piById.has(id))),
    byValues(sb, companyId, 'ap_invoices', 'id, invoice_number, due_date', 'id',
      uniq(named.map((a) => (a.ap_invoice_id == null ? null : String(a.ap_invoice_id)))).filter((id) => !apiById.has(id))),
  ]);
  if (!morePis.ok) return morePis;
  if (!moreApis.ok) return moreApis;
  for (const p of morePis.rows) piById.set(String(p.id), p);
  for (const a of moreApis.rows) apiById.set(String(a.id), a);
  const piByNo = new Map([...piById.values()].map((p) => [String(p.invoice_number), p]));
  const apiByNo = new Map([...apiById.values()].map((a) => [String(a.invoice_number), a]));

  const supByCode = new Map(sups.rows.map((s) => [String(s.code), s]));
  const supById = new Map(sups.rows.map((s) => [String(s.id), s]));
  const supplierOf = (s: Row | undefined, l?: ControlLine): AgingParty => {
    if (s) return { key: String(s.code), code: String(s.code), name: String(s.name ?? s.code) };
    if (l?.party_code) return { key: l.party_code, code: l.party_code, name: l.party_name ?? l.party_code };
    return { key: nameKey(l?.party_name), code: null, name: l?.party_name ?? '(no party)' };
  };
  const lineSupplier = (l: ControlLine): AgingParty => supplierOf(l.party_code ? supByCode.get(l.party_code) : undefined, l);
  /** The group a tick lands in, and what it is worth in ringgit. */
  const target = (piId: unknown, apiId: unknown, sen: number): { group: string; sen: number } | null => {
    if (piId != null) {
      const p = piById.get(String(piId));
      return p ? { group: `PI:${p.invoice_number}`, sen: toMyrSen(sen, p.exchange_rate) } : null;
    }
    if (apiId != null) {
      const a = apiById.get(String(apiId));
      return a ? { group: `API:${a.invoice_number}`, sen } : null;
    }
    return null;
  };
  /** A voucher's ticks as parts: an advance applied later is a tick of its own day, the voucher's own ticks its day.
      Conts writes amount_sen on a tick and applied_sen on an advance applied; either is what it moved. */
  const ticksOf = (pvId: string, ownDate: string) => pvAllocs.rows.filter((a) => String(a.pv_id) === pvId)
    .map((a) => {
      const sen = Number(a.applied_sen ?? 0) > 0 ? Number(a.applied_sen) : Number(a.amount_sen ?? 0);
      if (!(sen > 0)) return null;
      const date = a.from_advance === true ? mytDate(a.created_at) : ownDate;
      const t = target(a.pi_id, a.ap_invoice_id, sen);
      return t && date <= asOf ? { group: t.group, amountSen: t.sen, date, kind: a.from_advance === true ? 'Advance applied' : 'Payment' } : null;
    })
    .filter((p): p is { group: string; amountSen: number; date: string; kind: string } => p !== null);

  const pvByNo = new Map(pvs.rows.map((v) => [String(v.pv_number), v]));
  const scnByNo = new Map(scns.rows.map((n) => [String(n.note_number), n]));
  const cut = await documentsCutover(sb, companyId);
  if (!cut.ok) return cut;
  const entries: AgingEntry[] = [];
  const openingLines: Array<{ line: ControlLine; amountSen: number }> = [];
  for (const l of lines) {
    const amountSen = l.credit_sen - l.debit_sen;
    if (amountSen === 0) continue;
    if (standsAsOpening(l, asOf, cut.day)) { openingLines.push({ line: l, amountSen }); continue; }
    const party = lineSupplier(l);
    const doc = l.source_doc_no ?? '';
    const base = { party, docNo: doc || l.je_no, date: l.entry_date, dueDate: null as string | null, amountSen };
    if (l.source_type === 'PI' || l.source_type === 'API') {
      const inv = l.source_type === 'PI' ? piByNo.get(doc) : apiByNo.get(doc);
      entries.push({ ...base, group: `${l.source_type}:${doc}`, kind: l.source_type === 'PI' ? 'Purchase invoice' : 'AP invoice', dueDate: inv?.due_date ? day(inv.due_date) : null });
      continue;
    }
    if (l.source_type === 'PV' && pvByNo.has(doc)) {
      const parts = ticksOf(String(pvByNo.get(doc)!.id), l.entry_date);
      /* A voucher with no ticks (a claim, a payment request, an accrual paid) pays its party's unnamed lines. */
      entries.push(...splitLine({ ...base, group: parts.length ? `PV:${doc}` : poolOf(party), kind: 'Payment' }, parts));
      continue;
    }
    if (l.source_type === 'SCN' && scnByNo.has(doc)) {
      const n = scnByNo.get(doc)!;
      const t = target(n.purchase_invoice_id, n.ap_invoice_id, 0);
      entries.push({ ...base, group: t ? t.group : poolOf(party), kind: 'Credit note' });
      continue;
    }
    entries.push({ ...base, group: poolOf(party), kind: l.source_type });
  }

  /* The OPENING line, by the documents it stands for: each opening bill, each opening voucher (paid ahead) split by
     what it has knocked off since. */
  const controlOfSupplier = (s: Row | undefined): string => apControlOf(roles, { code: s?.code ?? null, control_account: s?.control_account ?? null });
  const docs: Array<{ control: string; entries: AgingEntry[] }> = [];
  for (const p of openingPis.rows) {
    const sen = toMyrSen(Number(p.total_sen ?? 0), p.exchange_rate);
    if (sen === 0 || day(p.invoice_date) > asOf) continue;
    const s = supById.get(String(p.supplier_id));
    docs.push({ control: controlOfSupplier(s), entries: [{
      group: `PI:${p.invoice_number}`, party: supplierOf(s), docNo: String(p.invoice_number), kind: 'Opening bill',
      date: day(p.invoice_date), dueDate: p.due_date ? day(p.due_date) : null, amountSen: sen,
    }] });
  }
  for (const v of openingPvs.rows) {
    const sen = Number(v.total_sen ?? 0);
    if (sen === 0 || day(v.voucher_date) > asOf) continue;
    const s = supById.get(String(v.supplier_id));
    const line = { group: `PV:${v.pv_number}`, party: supplierOf(s), docNo: String(v.pv_number), kind: 'Opening advance', date: day(v.voucher_date), dueDate: null, amountSen: -sen };
    docs.push({ control: controlOfSupplier(s), entries: splitLine(line, ticksOf(String(v.id), line.date)) });
  }
  const opening = openingEntries(openingLines, docs);
  entries.push(...opening.entries);

  const outside = await outsideTheBooks(sb, companyId, 'purchase_invoices', true);
  if (!outside.ok) return outside;
  return {
    ok: true, entries, controls: controlsOf(lines, codes, (l) => l.credit_sen - l.debit_sen), outside: outside.outside,
    opening: { splitSen: opening.splitSen, unsplitSen: opening.unsplitSen },
  };
}

/** Open invoices brought over as migrated paperwork (migrated_no_stock): never booked in this ledger, so they are not
    in the aging — the footer says how many. */
async function outsideTheBooks(sb: Db, companyId: number, table: 'sales_invoices' | 'purchase_invoices', withRate: boolean):
  Promise<{ ok: true; outside: { count: number; sen: number } } | Fail> {
  const got = await allRows(sb, companyId, table, withRate ? 'id, total_sen, paid_sen, status, exchange_rate' : 'id, total_sen, paid_sen, status',
    (q) => q.eq('migrated_no_stock', true).neq('status', 'CANCELLED'));
  if (!got.ok) return got;
  let count = 0;
  let sen = 0;
  for (const r of got.rows) {
    if (String(r.status ?? '').toUpperCase() === 'DRAFT') continue;
    const left = Number(r.total_sen ?? 0) - Number(r.paid_sen ?? 0);
    if (left <= 0) continue;
    count += 1;
    sen += withRate ? toMyrSen(left, r.exchange_rate) : left;
  }
  return { ok: true, outside: { count, sen } };
}
