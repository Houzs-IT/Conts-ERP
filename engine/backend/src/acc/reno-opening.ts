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
// Guards: the advance account cannot change once this contract has posted to the one it has, nor the customer once
// it has posted lines naming the old customer as party (its RCON / RVO / RCAN journals, the invoices and credit notes
// allocated on it, the payments on the order and its invoices); and the go-live amount cannot change once revenue has
// been allocated from it. The generic SO header edit cannot change a renovation SO's customer at all (the renovation
// write fence), so this import is the one place it changes after conversion.

import { paginateAll } from '../scm/lib/paginate-all';
import { isBeforeLedgerStart, loadLedgerSettings } from './ledger-settings';
import { ALLOC_BILL_CREDIT, ALLOC_CREDIT, ALLOC_INVOICE, CONTRACT_CANCELLED, CONTRACT_CHANGED, CONTRACT_SIGNED } from './reno-ledger';
import { ADVANCE_PARENT } from './reno-advance-account';
import { fmtSen } from '../scm/shared/format';
import type { RenoDb } from '../scm/lib/renovation-db';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as everywhere in acc/ */
type Sb = any;

export type RenoOpeningRow = { soDocNo: string; debtorCode: string; advanceAccountCode: string; billedBeforeGoLiveSen: number };
export type RenoOpeningPreviewRow = RenoOpeningRow & {
  problems: string[];
  /** The contract as it stands (live SO rows without RENO-CREDIT); null when the SO is unknown. */
  contractSen: number | null;
  /** The contract at go-live: contractSen less the VOs approved or dated on or after the ledger start. It becomes the
      baseline (golive_contract_sen) the first time the contract is seeded; those VOs then post as RVO. */
  goLiveContractSen: number | null;
  /** What the contract holds now, so finance sees what changes. */
  current: { debtorCode: string | null; advanceAccountCode: string | null; billedBeforeGoLiveSen: number } | null;
};

/** The customer controls a renovation project's customer may sit under. */
const CUSTOMER_CONTROLS = ['301', '302', '303'];
const ADVANCE_PARENTS = Object.values(ADVANCE_PARENT).map((p) => p.code);
const CHUNK = 200;

/** A timestamp's day in Malaysia (UTC+8), the day the ledger dates by. */
const mytDay = (ts: string): string => new Date(new Date(ts).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);

/** Runs `f` in one SQL transaction (the renovation routes' inRenoTx): a throw rolls every write back. */
export type RenoOpeningTx = <T>(f: (db: RenoDb) => Promise<T>) => Promise<T>;

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

/** The live (not reversed) journals this contract has posted: its own (RCON / RVO / RCAN), the documents allocated on
    it (invoices, credit notes), and the payments on the order and on its invoices (SOPAY / SIPAY). */
async function contractJournalIds(sb: Sb, companyId: number, soDocNo: string, allocDocs: string[]): Promise<string[]> {
  const own = new RegExp(`^${soDocNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-\\d+)?$`);
  const { data: mine, error } = await sb.from('journal_entries').select('id, source_doc_no, reversed')
    .eq('company_id', companyId).in('source_type', [CONTRACT_SIGNED, CONTRACT_CHANGED, CONTRACT_CANCELLED]).like('source_doc_no', `${soDocNo}%`);
  if (error) throw new Error(`The journals of ${soDocNo} could not be read: ${errText(error)}`);
  const ids = ((mine ?? []) as Array<{ id: string; source_doc_no: string; reversed: boolean | null }>)
    .filter((j) => !j.reversed && own.test(j.source_doc_no)).map((j) => String(j.id));
  const live = (rows: Array<{ id: string; reversed: boolean | null }>) => rows.filter((j) => !j.reversed).map((j) => String(j.id));
  if (allocDocs.length > 0) {
    ids.push(...live(await readIn(sb, 'journal_entries', 'id, reversed', 'source_doc_no', allocDocs,
      (q) => q.eq('company_id', companyId).in('source_type', ['SI', 'CN']))));
  }
  const soPays = await readIn<{ id: string }>(sb, 'mfg_sales_order_payments', 'id', 'so_doc_no', [soDocNo], (q) => q.eq('company_id', companyId));
  const sis = await readIn<{ id: string }>(sb, 'sales_invoices', 'id', 'so_doc_no', [soDocNo], (q) => q.eq('company_id', companyId));
  const siPays = sis.length > 0
    ? await readIn<{ id: string }>(sb, 'sales_invoice_payments', 'id', 'sales_invoice_id', sis.map((s) => String(s.id)), (q) => q.eq('company_id', companyId))
    : [];
  for (const [source, pays] of [['SOPAY', soPays], ['SIPAY', siPays]] as const) {
    if (pays.length === 0) continue;
    ids.push(...live(await readIn(sb, 'journal_entries', 'id, reversed', 'source_doc_no', pays.map((p) => String(p.id)),
      (q) => q.eq('company_id', companyId).eq('source_type', source))));
  }
  return [...new Set(ids)];
}

/** Whether any of `ids` has a line on `account`, or (with `party`) a customer line naming that party. */
async function anyLine(sb: Sb, ids: string[], match: { account: string } | { party: string }): Promise<boolean> {
  if (ids.length === 0) return false;
  const lines = await readIn<{ id: string }>(sb, 'journal_entry_lines', 'id', 'journal_entry_id', ids,
    (q) => ('account' in match ? q.eq('account_code', match.account) : q.eq('party_code', match.party)));
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

    const sos = await readIn<{ doc_no: string; so_kind: string; so_date: string | null; debtor_code: string | null; status: string | null }>(
      sb, 'mfg_sales_orders', 'doc_no, so_kind, so_date, debtor_code, status', 'doc_no', docs, byCompany);
    const contracts = await readIn<{ so_doc_no: string; company_id: number | null; advance_account_code: string | null; billed_before_golive_sen: number | null }>(
      sb, 'reno_so_contracts', 'so_doc_no, company_id, advance_account_code, billed_before_golive_sen', 'so_doc_no', docs);
    const debtors = await readIn<{ code: string; control_account: string | null }>(sb, 'debtors', 'code, control_account', 'code', debtorCodes, byCompany);
    const accounts = await readIn<{ account_code: string; parent_code: string | null; is_active: boolean | null }>(
      sb, 'accounts', 'account_code, parent_code, is_active', 'account_code', accountCodes, byCompany);
    const children = await readIn<{ parent_code: string }>(sb, 'accounts', 'parent_code', 'parent_code', accountCodes, byCompany);
    const allocs = await readIn<{ so_doc_no: string; source_type: string; source_doc_no: string }>(
      sb, 'reno_revenue_allocations', 'so_doc_no, source_type, source_doc_no', 'so_doc_no', docs, byCompany);
    const vos = await readIn<{ so_doc_no: string; status: string; doc_date: string | null; approved_at: string | null; net_sen: number | null }>(
      sb, 'reno_variation_orders', 'so_doc_no, status, doc_date, approved_at, net_sen', 'so_doc_no', docs, byCompany);
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
      /* The contract at go-live: today's less the VOs approved or dated on or after the ledger start (they post as RVO). */
      const afterStart = start
        ? vos.filter((v) => v.so_doc_no === r.soDocNo && v.status === 'APPROVED'
          && ((v.doc_date != null && String(v.doc_date).slice(0, 10) >= start) || (v.approved_at != null && mytDay(v.approved_at) >= start)))
          .reduce((s, v) => s + Number(v.net_sen ?? 0), 0)
        : 0;
      const goLiveContractSen = contractSen == null ? null : contractSen - afterStart;
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
      } else if (so?.status === 'CANCELLED') {
        problems.push(`${r.soDocNo} is cancelled: there is nothing to seed.`);
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
        const oldDebtor = String(current.debtorCode ?? '').trim();
        const advanceMoves = !!old && !!r.advanceAccountCode && old !== r.advanceAccountCode;
        const debtorMoves = !!oldDebtor && !!r.debtorCode && oldDebtor !== r.debtorCode;
        if (advanceMoves || debtorMoves) {
          const allocDocs = [...new Set(mine.filter((a) => [ALLOC_INVOICE, ALLOC_CREDIT, ALLOC_BILL_CREDIT].includes(a.source_type)).map((a) => a.source_doc_no))];
          const ids = await contractJournalIds(sb, companyId, r.soDocNo, allocDocs);
          if (advanceMoves && old && await anyLine(sb, ids, { account: old })) {
            problems.push(`${r.soDocNo} has already posted to ${old}: changing its advance account to ${r.advanceAccountCode} would leave those postings behind and double the advance.`);
          }
          if (debtorMoves && await anyLine(sb, ids, { party: oldDebtor })) {
            problems.push(`${r.soDocNo} has already posted with customer ${oldDebtor}: changing its customer account to ${r.debtorCode} would leave those postings (what the customer owes and has paid) on ${oldDebtor}. Keep ${oldDebtor}, or move them first.`);
          }
        }
      }
      out.push({ ...r, problems, contractSen, goLiveContractSen, current });
    }
    return { ok: true, rows: out };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

/** Write every row, or none (see the header): every row is checked first, then all are written in ONE SQL transaction
    (`runTx`), so any failure rolls back every row. Posts nothing. `runTx` null = no database connection: nothing. */
export async function applyRenoOpening(sb: Sb, companyId: number, input: RenoOpeningRow[], runTx: RenoOpeningTx | null): Promise<
  { ok: true; applied: number } | { ok: false; status: 'problems'; rows: RenoOpeningPreviewRow[] } | { ok: false; status: 'failed'; error: string }
> {
  const pv = await previewRenoOpening(sb, companyId, input);
  if (!pv.ok) return { ok: false, status: 'failed', error: pv.error };
  if (pv.rows.some((r) => r.problems.length > 0)) return { ok: false, status: 'problems', rows: pv.rows };
  if (!runTx) return { ok: false, status: 'failed', error: 'The database connection is not configured: nothing was applied.' };
  try {
    const applied = await runTx(async (db) => {
      for (const r of pv.rows) {
        const so = await db.q<{ doc_no: string }>(
          'update scm.mfg_sales_orders set debtor_code = $2, updated_at = now() where doc_no = $1 and company_id = $3 returning doc_no',
          [r.soDocNo, r.debtorCode, companyId]);
        if (so.length === 0) throw new Error(`${r.soDocNo} was not found`);
        /* The baseline is the contract at go-live, set the first time only: a VO posted since is in the ledger. */
        const c = await db.q<{ so_doc_no: string }>(
          `update scm.reno_so_contracts set advance_account_code = $2, billed_before_golive_sen = $3,
              golive_contract_sen = coalesce(golive_contract_sen, $4), updated_at = now()
            where so_doc_no = $1 returning so_doc_no`,
          [r.soDocNo, r.advanceAccountCode, r.billedBeforeGoLiveSen, r.goLiveContractSen ?? 0]);
        if (c.length === 0) throw new Error(`the contract record of ${r.soDocNo} was not found`);
      }
      return pv.rows.length;
    });
    return { ok: true, applied };
  } catch (err) {
    return { ok: false, status: 'failed', error: `Nothing was applied: ${errText(err)}. Apply again.` };
  }
}
