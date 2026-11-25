// Conts only (not part of Houzs's code): what a renovation contract signed before go-live was PAID in AutoCount
// (chew, 23 Nov 2026). Finance seeds what AutoCount invoiced on it (acc/reno-opening: billed_before_golive_sen, or the
// whole contract AutoCount booked at its cut-over, golive_contract_sen — the greater; chew 23 Nov 2026); the
// customer's opening invoices (Ledger setup > "2. Invoices customers still owe", acc/opening importOpeningReceivables:
// scm.sales_invoices with opening_balance, by debtor code) say what was still owed at go-live, and a minus on that
// list is a customer credit paid ahead (scm.customer_credits, source OPENING). So:
//
//   paid before go-live = invoiced before go-live - what its customer still owed at go-live (owed net of paid ahead)
//
// never below 0 nor above what was invoiced. The customer is the contract's own (mfg_sales_orders.debtor_code, set by
// the reno-opening import; one per project). When one customer code has several contracts AutoCount invoiced, its
// opening outstanding is laid on the OLDEST contract first (so_date, then doc no), up to what each was invoiced, the
// rest on the next: the newer contracts read as paid first. No posting changes: AutoCount's opening balances carry
// the money already. Readers: scm/lib/renovation-billing (billingViews), acc/receipt-confirm (the bill-next offer).

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as everywhere in acc/ */
type Db = any;

export interface PreGoLiveContract {
  soDocNo: string; debtorCode: string; soDate: string | null; billedBeforeGoLiveSen: number;
  /** The contract's sum now (its lines). Money the customer paid ahead in AutoCount, beyond every invoice it had,
      counts on the contract up to the part AutoCount never invoiced (chew, 25 Nov 2026: MS LEE's RM 712). */
  contractSen?: number | null;
  /** What AutoCount actually collected on the contract up to go-live, from its AR collection list (chew, 25 Nov 2026:
      "开多少单我不理，先把collection做好先"). When given it is the answer, whatever was invoiced or still owed. */
  autocountReceivedSen?: number | null;
}

/** Paid before go-live per contract (see the header). `owedByDebtor`: what each customer code still owed at go-live,
    net of what it had paid ahead (a negative owes nothing). A contract with no customer code owes its whole amount:
    nothing says it was paid. */
export function allocatePaidBeforeGoLive(contracts: readonly PreGoLiveContract[], owedByDebtor: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const byDebtor = new Map<string, PreGoLiveContract[]>();
  for (const c of contracts) {
    const billed = Math.max(0, Math.trunc(Number(c.billedBeforeGoLiveSen) || 0));
    const code = String(c.debtorCode).trim();
    if (billed === 0 || !code) { out.set(c.soDocNo, 0); continue; }
    byDebtor.set(code, [...(byDebtor.get(code) ?? []), { ...c, billedBeforeGoLiveSen: billed }]);
  }
  for (const [code, list] of byDebtor) {
    const net = Math.trunc(Number(owedByDebtor.get(code) ?? 0) || 0);
    let owed = Math.max(0, net);
    /* Paid ahead beyond every invoice (an opening credit larger than the opening invoices): it paid for the part of a
       contract AutoCount had not invoiced yet (a VO after go-live, a later instalment), oldest contract first. */
    let ahead = Math.max(0, -net);
    const oldestFirst = [...list].sort((a, b) => String(a.soDate ?? '9999').localeCompare(String(b.soDate ?? '9999')) || a.soDocNo.localeCompare(b.soDocNo));
    for (const c of oldestFirst) {
      const owes = Math.min(owed, c.billedBeforeGoLiveSen);
      owed -= owes;
      const room = c.contractSen == null ? 0 : Math.max(0, Math.trunc(Number(c.contractSen) || 0) - c.billedBeforeGoLiveSen);
      const extra = owes > 0 ? 0 : Math.min(ahead, room);
      ahead -= extra;
      out.set(c.soDocNo, c.billedBeforeGoLiveSen - owes + extra);
    }
  }
  /* AutoCount's own collection, where finance gave it, is the figure; the customer's owed above is laid as before so the
     customer's other contracts read the same. */
  for (const c of contracts) {
    const got = c.autocountReceivedSen;
    if (got != null && Number.isFinite(Number(got))) out.set(c.soDocNo, Math.max(0, Math.trunc(Number(got))));
  }
  return out;
}

const LIVE_INVOICE = (status: unknown): boolean => !['DRAFT', 'CANCELLED', 'VOID'].includes(String(status ?? '').toUpperCase());

/** allocatePaidBeforeGoLive for `soDocNos`, read through PostgREST: their customers, every contract AutoCount invoiced
    of those customers, and the customers' opening invoices and opening credits. Throws on a read that fails. */
export async function paidBeforeGoLiveOf(sb: Db, companyId: number, soDocNos: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const docs = [...new Set(soDocNos)];
  if (docs.length === 0) return out;
  const read = async (q: any, what: string): Promise<any[]> => {
    const { data, error } = await q;
    if (error) throw new Error(`paid before go-live: ${what}: ${error.message ?? error}`);
    return (data ?? []) as any[];
  };
  const mine = await read(sb.from('mfg_sales_orders').select('doc_no, debtor_code').eq('company_id', companyId).in('doc_no', docs), 'orders');
  const codes = [...new Set(mine.map((o) => String(o.debtor_code ?? '').trim()).filter(Boolean))];
  if (codes.length === 0) return out;
  const [orders, sis, credits] = await Promise.all([
    read(sb.from('mfg_sales_orders').select('doc_no, debtor_code, so_date, status, local_total_sen').eq('company_id', companyId).in('debtor_code', codes), 'customer orders'),
    read(sb.from('sales_invoices').select('debtor_code, total_sen, status').eq('company_id', companyId).eq('opening_balance', true).in('debtor_code', codes), 'opening invoices'),
    read(sb.from('customer_credits').select('debtor_code, amount_sen').eq('company_id', companyId).eq('source_type', 'OPENING').in('debtor_code', codes), 'opening credits'),
  ]);
  const liveOrders = orders.filter((o) => String(o.status ?? '') !== 'CANCELLED');
  const contracts = liveOrders.length === 0 ? [] : await read(sb.from('reno_so_contracts').select('so_doc_no, billed_before_golive_sen, golive_contract_sen, autocount_received_sen')
    .in('so_doc_no', liveOrders.map((o) => String(o.doc_no))), 'contracts');
  /* What AutoCount invoiced: the seeded figure, or the whole contract AutoCount booked at its cut-over (golive_contract_sen,
     acc/reno-opening; 16 Nov 2026 it booked every contract whole), whichever is more. */
  const billedOf = new Map(contracts.map((c) => [String(c.so_doc_no), Math.max(Number(c.billed_before_golive_sen ?? 0), Number(c.golive_contract_sen ?? 0))]));
  const owed = new Map<string, number>();
  for (const i of sis) if (LIVE_INVOICE(i.status)) owed.set(String(i.debtor_code), (owed.get(String(i.debtor_code)) ?? 0) + Number(i.total_sen ?? 0));
  for (const c of credits) owed.set(String(c.debtor_code), (owed.get(String(c.debtor_code)) ?? 0) - Number(c.amount_sen ?? 0));
  const receivedOf = new Map(contracts.filter((c) => c.autocount_received_sen != null).map((c) => [String(c.so_doc_no), Number(c.autocount_received_sen)]));
  const all = allocatePaidBeforeGoLive(liveOrders.filter((o) => (billedOf.get(String(o.doc_no)) ?? 0) > 0 || receivedOf.has(String(o.doc_no))).map((o) => ({
    soDocNo: String(o.doc_no), debtorCode: String(o.debtor_code ?? ''), soDate: o.so_date ? String(o.so_date).slice(0, 10) : null,
    billedBeforeGoLiveSen: billedOf.get(String(o.doc_no)) ?? 0, contractSen: o.local_total_sen == null ? null : Number(o.local_total_sen),
    autocountReceivedSen: receivedOf.get(String(o.doc_no)) ?? null,
  })), owed);
  for (const d of docs) out.set(d, all.get(d) ?? 0);
  return out;
}
