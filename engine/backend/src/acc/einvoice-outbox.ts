// ----------------------------------------------------------------------------
// E-invoice outbox (plan 2026-10-30-renovation-einvoice-ready.md Task 5; spec
// goal 7). One row per renovation invoice / credit note in
// scm.acc_einvoice_outbox, prepared when the document posts: READY, or
// NOT_READY with what is missing in plain words. It is prepared again when the
// customer's or the seller's details change, and CANCELLED with its document.
// Rows a connector has taken (SUBMITTED, VALID, REJECTED) are never touched
// here. Nothing sends anything: the connector comes later (chew).
//
// The buyer's address comes from the customer account when it holds one (a renovation contract carries only two
// address lines, and LHDN needs the state); otherwise from the document itself.
//
// Callers run this after posting and never let it undo or block a posting:
// failures are logged by the caller and the next refresh catches up.
// ----------------------------------------------------------------------------

import { buildEInvoice, MAX_DESCRIPTION, type EInvoiceBuyer, type EInvoiceDoc } from './einvoice-build';
import { loadEInvoiceSettings, type EInvoiceSettings } from './einvoice-settings';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped throughout the acc layer */
type Db = any;
type Row = Record<string, any>;

export type OutboxStatus = 'NOT_READY' | 'READY' | 'SUBMITTED' | 'VALID' | 'REJECTED' | 'CANCELLED';
export type DocKind = 'INVOICE' | 'CREDIT_NOTE';
type Prepared = { status: OutboxStatus; missing: string[] } | null;

/** Rows this module may still rewrite or cancel. */
const OPEN: OutboxStatus[] = ['NOT_READY', 'READY'];

const fail = (what: string, error: { message?: string }): never => { throw new Error(`e-invoice outbox: ${what}: ${error.message ?? 'failed'}`); };

async function isRenovation(sb: Db, companyId: number, soDocNo: string | null): Promise<boolean> {
  if (!soDocNo) return false;
  const { data, error } = await sb.from('mfg_sales_orders').select('so_kind').eq('company_id', companyId).eq('doc_no', soDocNo).maybeSingle();
  if (error) fail('order', error);
  return (data as Row | null)?.so_kind === 'RENOVATION';
}

async function debtorOf(sb: Db, companyId: number, code: string | null): Promise<Row | null> {
  if (!code) return null;
  const { data, error } = await sb.from('debtors').select('name, phone, email, tin, id_type, id_number, sst_no, address, city, postcode, state, country').eq('company_id', companyId).eq('code', code).maybeSingle();
  if (error) fail('customer account', error);
  return (data as Row | null) ?? null;
}

const pick = (...v: unknown[]): string | null => { for (const x of v) { const s = String(x ?? '').trim(); if (s) return s; } return null; };

const buyerOf = (debtor: Row | null, fallbackName: string | null, addr: Row): EInvoiceBuyer => {
  const own = pick(debtor?.address);
  return {
    name: pick(debtor?.name, fallbackName) ?? '',
    tin: debtor?.tin ?? null, idType: debtor?.id_type ?? null, idNumber: debtor?.id_number ?? null, sstNo: debtor?.sst_no ?? null,
    address1: own ?? pick(addr.address1), address2: own ? null : pick(addr.address2),
    city: pick(debtor?.city, addr.city), postcode: pick(debtor?.postcode, addr.postcode),
    state: pick(debtor?.state, addr.state, addr.customer_state), country: pick(debtor?.country, addr.customer_country),
    phone: pick(addr.phone, debtor?.phone), email: pick(addr.email, debtor?.email),
  };
};

/** Write the row unless a connector already holds it; returns the row's status after. */
async function save(
  sb: Db, companyId: number, kind: DocKind, doc: EInvoiceDoc, buyer: EInvoiceBuyer, debtorCode: string | null,
  ids: { sales_invoice_id?: string; credit_note_id?: string }, s: EInvoiceSettings,
): Promise<NonNullable<Prepared>> {
  const { data: cur, error } = await sb.from('acc_einvoice_outbox').select('id, status')
    .eq('company_id', companyId).eq('doc_kind', kind).eq('doc_number', doc.number).maybeSingle();
  if (error) fail('read', error);
  const existing = cur as { id: string; status: OutboxStatus } | null;
  /* A connector's rows stay as they are; a CANCELLED row comes back when its document is posted again (reopened). */
  if (existing && !OPEN.includes(existing.status) && existing.status !== 'CANCELLED') return { status: existing.status, missing: [] };
  const built = buildEInvoice(doc, buyer, s);
  const missing = built.ok ? [] : built.missing;
  const status: OutboxStatus = built.ok ? 'READY' : 'NOT_READY';
  const row = { status, missing, payload: built.payload, debtor_code: debtorCode, prepared_at: new Date().toISOString(), ...ids };
  const res = existing
    ? await sb.from('acc_einvoice_outbox').update(row).eq('company_id', companyId).eq('id', existing.id)
    : await sb.from('acc_einvoice_outbox').insert({ company_id: companyId, doc_kind: kind, doc_number: doc.number, ...row });
  if (res.error) fail('save', res.error);
  return { status, missing };
}

/** A renovation invoice's row; null when the invoice is not a renovation contract's. */
export async function prepareInvoice(sb: Db, companyId: number, salesInvoiceId: string, settings?: EInvoiceSettings): Promise<Prepared> {
  const { data, error } = await sb.from('sales_invoices')
    .select('id, invoice_number, so_doc_no, invoice_date, total_sen, debtor_code, debtor_name, address1, address2, city, postcode, state, customer_country, phone, email')
    .eq('company_id', companyId).eq('id', salesInvoiceId).maybeSingle();
  if (error) fail('invoice', error);
  const si = data as Row | null;
  if (!si || !(await isRenovation(sb, companyId, si.so_doc_no))) return null;
  const { data: lines, error: lErr } = await sb.from('sales_invoice_items').select('description, line_no').eq('sales_invoice_id', si.id).order('line_no');
  if (lErr) fail('invoice lines', lErr);
  const description = String(((lines ?? []) as Row[])[0]?.description ?? '');
  const s = settings ?? await loadEInvoiceSettings(sb, companyId);
  const doc: EInvoiceDoc = {
    kind: 'INVOICE', number: si.invoice_number, date: String(si.invoice_date).slice(0, 10), description, amountSen: Number(si.total_sen), references: [],
  };
  const debtor = await debtorOf(sb, companyId, si.debtor_code ?? null);
  return save(sb, companyId, 'INVOICE', doc, buyerOf(debtor, si.debtor_name ?? null, si), si.debtor_code ?? null, { sales_invoice_id: si.id }, s);
}

const capped = (s: string): string => { const t = s.trim(); return t.length > MAX_DESCRIPTION ? `${t.slice(0, MAX_DESCRIPTION - 1)}…` : t; };

/** A renovation credit note's row; null when its order is not a renovation contract. It references the contract's
    live invoices dated on or before it (a contract credit is not tied to one invoice). */
export async function prepareCreditNote(sb: Db, companyId: number, creditNoteId: string, settings?: EInvoiceSettings): Promise<Prepared> {
  const { data, error } = await sb.from('acc_credit_notes')
    .select('id, note_number, kind, party_code, party_name, so_doc_no, note_date, total_sen, reason')
    .eq('company_id', companyId).eq('id', creditNoteId).maybeSingle();
  if (error) fail('credit note', error);
  const cn = data as Row | null;
  if (!cn || cn.kind !== 'CN' || !(await isRenovation(sb, companyId, cn.so_doc_no))) return null;
  const [{ data: lines, error: lErr }, { data: so, error: soErr }, { data: invs, error: iErr }] = await Promise.all([
    sb.from('acc_credit_note_lines').select('description, line_no').eq('company_id', companyId).eq('note_id', cn.id).order('line_no'),
    sb.from('mfg_sales_orders').select('address1, address2, city, postcode, customer_state, customer_country, phone, email')
      .eq('company_id', companyId).eq('doc_no', cn.so_doc_no).maybeSingle(),
    sb.from('sales_invoices').select('invoice_number, invoice_date, status').eq('company_id', companyId).eq('so_doc_no', cn.so_doc_no),
  ]);
  if (lErr) fail('credit note lines', lErr);
  if (soErr) fail('order', soErr);
  if (iErr) fail('contract invoices', iErr);
  const noteDate = String(cn.note_date).slice(0, 10);
  const references = ((invs ?? []) as Row[])
    .filter((i) => i.status !== 'CANCELLED' && String(i.invoice_date).slice(0, 10) <= noteDate)
    .sort((a, b) => String(a.invoice_date).localeCompare(String(b.invoice_date)) || String(a.invoice_number).localeCompare(String(b.invoice_number)))
    .map((i) => String(i.invoice_number));
  const s = settings ?? await loadEInvoiceSettings(sb, companyId);
  const doc: EInvoiceDoc = {
    kind: 'CREDIT_NOTE', number: cn.note_number, date: noteDate,
    /* The note's reason as it was raised: posting rewrites its lines with the ledger's own wording. */
    description: capped(String(cn.reason ?? ((lines ?? []) as Row[])[0]?.description ?? '')), amountSen: Number(cn.total_sen), references,
  };
  const debtor = await debtorOf(sb, companyId, cn.party_code ?? null);
  return save(sb, companyId, 'CREDIT_NOTE', doc, buyerOf(debtor, cn.party_name ?? null, (so as Row | null) ?? {}), cn.party_code ?? null, { credit_note_id: cn.id }, s);
}

/** The document is cancelled: its row leaves the queue (unless a connector already holds it). */
export async function cancelOutbox(sb: Db, companyId: number, kind: DocKind, docNumber: string): Promise<void> {
  const { error } = await sb.from('acc_einvoice_outbox').update({ status: 'CANCELLED' })
    .eq('company_id', companyId).eq('doc_kind', kind).eq('doc_number', docNumber).in('status', OPEN);
  if (error) fail('cancel', error);
}

async function reprepare(sb: Db, companyId: number, rows: Row[]): Promise<number> {
  if (!rows.length) return 0;
  const s = await loadEInvoiceSettings(sb, companyId);
  let n = 0;
  for (const r of rows) {
    const out = r.doc_kind === 'INVOICE'
      ? (r.sales_invoice_id ? await prepareInvoice(sb, companyId, r.sales_invoice_id, s) : null)
      : (r.credit_note_id ? await prepareCreditNote(sb, companyId, r.credit_note_id, s) : null);
    if (out) n += 1;
  }
  return n;
}

const OPEN_COLS = 'id, doc_kind, sales_invoice_id, credit_note_id';

/** A customer's details changed: prepare its open rows again. Returns how many were prepared. */
export async function refreshForDebtor(sb: Db, companyId: number, debtorCode: string): Promise<number> {
  const { data, error } = await sb.from('acc_einvoice_outbox').select(OPEN_COLS)
    .eq('company_id', companyId).eq('debtor_code', debtorCode).in('status', OPEN);
  if (error) fail('read', error);
  return reprepare(sb, companyId, (data ?? []) as Row[]);
}

/** The seller's details or the codes changed (or finance asked): prepare every open row again. */
export async function refreshAll(sb: Db, companyId: number): Promise<number> {
  const { data, error } = await sb.from('acc_einvoice_outbox').select(OPEN_COLS).eq('company_id', companyId).in('status', OPEN);
  if (error) fail('read', error);
  return reprepare(sb, companyId, (data ?? []) as Row[]);
}

/** One request's worth of catching up after the settings changed: the open rows prepared before the settings were last
    saved, oldest first, at most `limit` of them (each row is several reads and writes; a request has a ceiling). When
    none is stale, the not-ready rows are tried once. `remaining` is what is still stale after this batch. */
export async function refreshStale(sb: Db, companyId: number, limit: number): Promise<{ refreshed: number; remaining: number }> {
  const { data: set, error: sErr } = await sb.from('acc_company_settings').select('updated_at').eq('company_id', companyId).maybeSingle();
  if (sErr) fail('settings', sErr);
  const since = (set as { updated_at?: string | null } | null)?.updated_at ?? null;
  let stale: Row[] = [];
  if (since) {
    const { data, error } = await sb.from('acc_einvoice_outbox').select(OPEN_COLS).eq('company_id', companyId).in('status', OPEN)
      .lt('prepared_at', since).order('prepared_at', { ascending: true }).order('id', { ascending: true });
    if (error) fail('read', error);
    stale = (data ?? []) as Row[];
  }
  if (!stale.length) {
    const { data, error } = await sb.from('acc_einvoice_outbox').select(OPEN_COLS).eq('company_id', companyId).eq('status', 'NOT_READY')
      .order('prepared_at', { ascending: true }).order('id', { ascending: true }).limit(limit);
    if (error) fail('read', error);
    return { refreshed: await reprepare(sb, companyId, (data ?? []) as Row[]), remaining: 0 };
  }
  const batch = stale.slice(0, limit);
  return { refreshed: await reprepare(sb, companyId, batch), remaining: stale.length - batch.length };
}

/** What the billing screen says after a document posted: a warning only while e-invoice is on and the row lacks
    something. Null otherwise. */
export async function einvoiceWarning(sb: Db, companyId: number, kind: DocKind, docNumber: string): Promise<string | null> {
  const s = await loadEInvoiceSettings(sb, companyId);
  if (!s.active) return null;
  const { data, error } = await sb.from('acc_einvoice_outbox').select('status, missing')
    .eq('company_id', companyId).eq('doc_kind', kind).eq('doc_number', docNumber).maybeSingle();
  if (error) fail('read', error);
  const row = data as { status: OutboxStatus; missing: string[] } | null;
  if (!row || row.status !== 'NOT_READY') return null;
  const what = kind === 'INVOICE' ? 'invoice' : 'credit note';
  return `E-invoice not ready: ${row.missing.join(', ')}. The ${what} is saved; fill in the customer's details on the customer account.`;
}

/** Best-effort wrappers for the posting paths: logged, never thrown. */
export async function prepareAfterPosting(sb: Db, companyId: number, kind: DocKind, id: string): Promise<void> {
  try {
    if (kind === 'INVOICE') await prepareInvoice(sb, companyId, id);
    else await prepareCreditNote(sb, companyId, id);
  } catch (err) {
    /* eslint-disable-next-line no-console */
    console.error('[einvoice] prepare failed — the next refresh catches up:', kind, id, err instanceof Error ? err.message : err);
  }
}
export async function cancelAfterReversal(sb: Db, companyId: number, kind: DocKind, docNumber: string): Promise<void> {
  try { await cancelOutbox(sb, companyId, kind, docNumber); } catch (err) {
    /* eslint-disable-next-line no-console */
    console.error('[einvoice] cancel failed:', kind, docNumber, err instanceof Error ? err.message : err);
  }
}
