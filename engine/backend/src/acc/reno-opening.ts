// Renovation contracts signed before the ledger start, seeded at go-live (finance, chew 30 Oct 2026; spec
// docs/superpowers/specs/2026-10-30-renovation-revenue-einvoice-design.md 7.3, 7.5; plan
// 2026-10-30-renovation-revenue-ledger.md Task 8).
//
// Finance uploads one row per old contract: its SO, its customer account (AutoCount's, one per project), its advance
// sub-account (a child of 480-0000 / 481-0000) and what AutoCount invoiced on it before go-live. The preview names
// every row's problems; Apply writes all rows or none:
//   • mfg_sales_orders.debtor_code                      the project's customer;
//   • reno_so_contracts.advance_account_code            the project's advance sub-account;
//   • reno_so_contracts.billed_before_golive_sen        the waterfall treats it as already filled (acc/reno-ledger);
//   • reno_so_contracts.golive_contract_sen             the contract amount the opening balances carry (set once), so
//                                                       a VO after go-live posts only its difference (RVO).
// It posts nothing: the opening balances carry the money.
//
// Two guards against doubling the advance: the advance account cannot change once this contract has posted to the
// one it has (its RCON / RVO / RCAN journals, or the invoices and credit notes allocated on it); and the go-live
// amount cannot change once revenue has been allocated from it.

import { paginateAll } from '../scm/lib/paginate-all';
import { isBeforeLedgerStart, loadLedgerSettings } from './ledger-settings';
import { ALLOC_BILL_CREDIT, ALLOC_CREDIT, ALLOC_INVOICE, CONTRACT_CANCELLED, CONTRACT_CHANGED, CONTRACT_SIGNED } from './reno-ledger';
import { ADVANCE_PARENT } from './reno-advance-account';
import { fmtSen } from '../scm/shared/format';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as everywhere in acc/ */
type Sb = any;

export type RenoOpeningRow = { soDocNo: string; debtorCode: string; advanceAccountCode: string; billedBeforeGoLiveSen: number };
export type RenoOpeningPreviewRow = RenoOpeningRow & {
  problems: string[];
  /** The contract as it stands (live SO rows without RENO-CREDIT); null when the SO is unknown. */
  contractSen: number | null;
  /** What the contract holds now, so finance sees what changes. */
  current: { debtorCode: string | null; advanceAccountCode: string | null; billedBeforeGoLiveSen: number } | null;
};

/** The customer controls a renovation project's customer may sit under. */
const CUSTOMER_CONTROLS = ['301', '302', '303'];
const ADVANCE_PARENTS = Object.values(ADVANCE_PARENT).map((p) => p.code);
const CHUNK = 200;

const errText = (e: unknown): string => (e as { message?: string } | null)?.message ?? String(e);

async function readIn<T>(sb: Sb, table: string, cols: string, column: string, values: string[], scope: (q: Sb) => Sb = (q) => q): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    const { data, error } = await scope(sb.from(table).select(cols).in(column, values.slice(i, i + CHUNK)));
    if (error) throw new Error(`${table} could not be read: ${errText(error)}`);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

/** Whether this contract has posted to `advance`: a live (not reversed) journal of its own (RCON / RVO / RCAN) or of
    a document allocated on it (an invoice, a credit note) with a line on that account. */
async function contractPostedTo(sb: Sb, companyId: number, soDocNo: string, advance: string, allocDocs: string[]): Promise<boolean> {
  const own = new RegExp(`^${soDocNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-\\d+)?$`);
  const { data: mine, error } = await sb.from('journal_entries').select('id, source_doc_no, reversed')
    .eq('company_id', companyId).in('source_type', [CONTRACT_SIGNED, CONTRACT_CHANGED, CONTRACT_CANCELLED]).like('source_doc_no', `${soDocNo}%`);
  if (error) throw new Error(`The journals of ${soDocNo} could not be read: ${errText(error)}`);
  const ids = ((mine ?? []) as Array<{ id: string; source_doc_no: string; reversed: boolean | null }>)
    .filter((j) => !j.reversed && own.test(j.source_doc_no)).map((j) => String(j.id));
  if (allocDocs.length > 0) {
    const docs = await readIn<{ id: string; reversed: boolean | null }>(sb, 'journal_entries', 'id, reversed', 'source_doc_no', allocDocs,
      (q) => q.eq('company_id', companyId).in('source_type', ['SI', 'CN']));
    ids.push(...docs.filter((j) => !j.reversed).map((j) => String(j.id)));
  }
  if (ids.length === 0) return false;
  const lines = await readIn<{ id: string }>(sb, 'journal_entry_lines', 'id', 'journal_entry_id', ids, (q) => q.eq('account_code', advance));
  return lines.length > 0;
}

/** Check every row (see the header). Never writes. */
export async function previewRenoOpening(sb: Sb, companyId: number, input: RenoOpeningRow[]): Promise<{ ok: true; rows: RenoOpeningPreviewRow[] } | { ok: false; error: string }> {
  const rows = input.map((r) => ({
    soDocNo: r.soDocNo.trim(),
    debtorCode: r.debtorCode.trim(),
    advanceAccountCode: r.advanceAccountCode.trim(),
    billedBeforeGoLiveSen: Number(r.billedBeforeGoLiveSen),
  }));
  try {
    const ls = await loadLedgerSettings(sb, companyId);
    if (!ls.ok) return { ok: false, error: 'The ledger settings could not be read.' };
    const start = ls.settings.ledgerStartDate;

    const docs = [...new Set(rows.map((r) => r.soDocNo).filter(Boolean))];
    const debtorCodes = [...new Set(rows.map((r) => r.debtorCode).filter(Boolean))];
    const accountCodes = [...new Set(rows.map((r) => r.advanceAccountCode).filter(Boolean))];
    const byCompany = (q: Sb) => q.eq('company_id', companyId);

    const sos = await readIn<{ doc_no: string; so_kind: string; so_date: string | null; debtor_code: string | null }>(
      sb, 'mfg_sales_orders', 'doc_no, so_kind, so_date, debtor_code', 'doc_no', docs, byCompany);
    const contracts = await readIn<{ so_doc_no: string; company_id: number | null; advance_account_code: string | null; billed_before_golive_sen: number | null }>(
      sb, 'reno_so_contracts', 'so_doc_no, company_id, advance_account_code, billed_before_golive_sen', 'so_doc_no', docs);
    const debtors = await readIn<{ code: string; control_account: string | null }>(sb, 'debtors', 'code, control_account', 'code', debtorCodes, byCompany);
    const accounts = await readIn<{ account_code: string; parent_code: string | null; is_active: boolean | null }>(
      sb, 'accounts', 'account_code, parent_code, is_active', 'account_code', accountCodes, byCompany);
    const children = await readIn<{ parent_code: string }>(sb, 'accounts', 'parent_code', 'parent_code', accountCodes, byCompany);
    const allocs = await readIn<{ so_doc_no: string; source_type: string; source_doc_no: string }>(
      sb, 'reno_revenue_allocations', 'so_doc_no, source_type, source_doc_no', 'so_doc_no', docs, byCompany);
    const items: Array<{ doc_no: string; item_code: string | null; total_sen: number | null; cancelled: boolean | null }> = [];
    for (let i = 0; i < docs.length; i += CHUNK) {
      const part = docs.slice(i, i + CHUNK);
      const { data, error } = await paginateAll((from, to) => sb.from('mfg_sales_order_items').select('id, doc_no, item_code, total_sen, cancelled')
        .eq('company_id', companyId).in('doc_no', part).order('id').range(from, to));
      if (error) throw new Error(`The contract lines could not be read: ${errText(error)}`);
      items.push(...((data ?? []) as typeof items));
    }

    const soOf = new Map(sos.map((s) => [s.doc_no, s]));
    const contractOf = new Map(contracts.filter((c) => c.company_id == null || Number(c.company_id) === companyId).map((c) => [c.so_doc_no, c]));
    const debtorOf = new Map(debtors.map((d) => [d.code, d]));
    const accountOf = new Map(accounts.map((a) => [a.account_code, a]));
    const isHeader = new Set(children.map((c) => c.parent_code));
    const count = new Map<string, number>();
    for (const r of rows) count.set(r.soDocNo, (count.get(r.soDocNo) ?? 0) + 1);

    const out: RenoOpeningPreviewRow[] = [];
    for (const r of rows) {
      const problems: string[] = [];
      const so = soOf.get(r.soDocNo);
      const contract = contractOf.get(r.soDocNo);
      const contractSen = so
        ? items.filter((i) => i.doc_no === r.soDocNo && i.cancelled !== true && i.item_code !== 'RENO-CREDIT').reduce((s, i) => s + Number(i.total_sen ?? 0), 0)
        : null;
      const current = contract ? {
        debtorCode: so?.debtor_code ?? null,
        advanceAccountCode: String(contract.advance_account_code ?? '').trim() || null,
        billedBeforeGoLiveSen: Number(contract.billed_before_golive_sen ?? 0),
      } : null;

      if (!start) problems.push('Set the day the books start first (Books, above): only contracts signed before it are seeded here.');
      if (!r.soDocNo) problems.push('No SO doc no.');
      else if ((count.get(r.soDocNo) ?? 0) > 1) problems.push(`${r.soDocNo} is listed more than once.`);
      if (r.soDocNo && (!so || so.so_kind !== 'RENOVATION' || !contract)) {
        problems.push(`${r.soDocNo} is not a renovation contract of this company.`);
      } else if (so && start && !isBeforeLedgerStart(String(so.so_date ?? '').slice(0, 10), ls.settings)) {
        problems.push(`${r.soDocNo} was signed on or after the ledger start (${start}): it posts through the ledger, not this import.`);
      }

      const debtor = debtorOf.get(r.debtorCode);
      if (!r.debtorCode) problems.push('No customer account.');
      else if (!debtor) problems.push(`${r.debtorCode} is not a customer of this company (Debtors).`);
      else {
        const control = String(debtor.control_account ?? '');
        if (!CUSTOMER_CONTROLS.includes(control.slice(0, 3))) {
          problems.push(`Customer ${r.debtorCode} is under ${control || 'no control account'}, not 301, 302 or 303 (renovation customers).`);
        }
      }

      const acc = accountOf.get(r.advanceAccountCode);
      if (!r.advanceAccountCode) problems.push('No advance account.');
      else if (!acc || !ADVANCE_PARENTS.includes(String(acc.parent_code ?? ''))) {
        problems.push(`${r.advanceAccountCode} is not a sub-account of ${ADVANCE_PARENTS.join(' or ')} in the chart.`);
      } else if (acc.is_active === false) problems.push(`${r.advanceAccountCode} is deactivated in the chart.`);
      else if (isHeader.has(r.advanceAccountCode)) problems.push(`${r.advanceAccountCode} has sub-accounts of its own: pick the project's own account.`);

      if (!Number.isInteger(r.billedBeforeGoLiveSen) || r.billedBeforeGoLiveSen < 0) {
        problems.push('The amount invoiced before go-live must be a plain RM figure, zero or more.');
      } else if (contractSen != null && r.billedBeforeGoLiveSen > contractSen) {
        problems.push(`${fmtSen(r.billedBeforeGoLiveSen)} invoiced before go-live is more than the contract (${fmtSen(contractSen)}).`);
      }

      if (current && so) {
        const mine = allocs.filter((a) => a.so_doc_no === r.soDocNo);
        if (mine.length > 0 && Number.isInteger(r.billedBeforeGoLiveSen) && r.billedBeforeGoLiveSen !== current.billedBeforeGoLiveSen) {
          problems.push(`Revenue is already allocated on ${r.soDocNo} from its go-live amount (${fmtSen(current.billedBeforeGoLiveSen)}): it cannot change now.`);
        }
        const old = current.advanceAccountCode;
        if (old && r.advanceAccountCode && old !== r.advanceAccountCode) {
          const allocDocs = [...new Set(mine.filter((a) => [ALLOC_INVOICE, ALLOC_CREDIT, ALLOC_BILL_CREDIT].includes(a.source_type)).map((a) => a.source_doc_no))];
          if (await contractPostedTo(sb, companyId, r.soDocNo, old, allocDocs)) {
            problems.push(`${r.soDocNo} has already posted to ${old}: changing its advance account to ${r.advanceAccountCode} would leave those postings behind and double the advance.`);
          }
        }
      }
      out.push({ ...r, problems, contractSen, current });
    }
    return { ok: true, rows: out };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

/** Write every row, or none when any row has a problem (see the header). Posts nothing. */
export async function applyRenoOpening(sb: Sb, companyId: number, input: RenoOpeningRow[]): Promise<
  { ok: true; applied: number } | { ok: false; status: 'problems'; rows: RenoOpeningPreviewRow[] } | { ok: false; status: 'failed'; error: string }
> {
  const pv = await previewRenoOpening(sb, companyId, input);
  if (!pv.ok) return { ok: false, status: 'failed', error: pv.error };
  if (pv.rows.some((r) => r.problems.length > 0)) return { ok: false, status: 'problems', rows: pv.rows };

  const { data: existing, error: eErr } = await sb.from('reno_so_contracts').select('so_doc_no, golive_contract_sen').in('so_doc_no', pv.rows.map((r) => r.soDocNo));
  if (eErr) return { ok: false, status: 'failed', error: errText(eErr) };
  const baselineOf = new Map(((existing ?? []) as Array<{ so_doc_no: string; golive_contract_sen: number | null }>).map((c) => [c.so_doc_no, c.golive_contract_sen]));

  let applied = 0;
  for (const r of pv.rows) {
    const { error: soErr } = await sb.from('mfg_sales_orders').update({ debtor_code: r.debtorCode, updated_at: new Date().toISOString() })
      .eq('company_id', companyId).eq('doc_no', r.soDocNo);
    if (soErr) return { ok: false, status: 'failed', error: `${r.soDocNo}: the customer could not be saved (${errText(soErr)}); ${applied} row${applied === 1 ? '' : 's'} before it saved. Apply again.` };
    /* The baseline is the contract when first seeded: a VO posted since then is already in the ledger. */
    const patch: Record<string, unknown> = { advance_account_code: r.advanceAccountCode, billed_before_golive_sen: r.billedBeforeGoLiveSen };
    if (baselineOf.get(r.soDocNo) == null) patch.golive_contract_sen = r.contractSen ?? 0;
    const { error: cErr } = await sb.from('reno_so_contracts').update(patch).eq('so_doc_no', r.soDocNo);
    if (cErr) return { ok: false, status: 'failed', error: `${r.soDocNo}: the contract could not be saved (${errText(cErr)}); ${applied} row${applied === 1 ? '' : 's'} before it saved. Apply again.` };
    applied += 1;
  }
  return { ok: true, applied };
}
