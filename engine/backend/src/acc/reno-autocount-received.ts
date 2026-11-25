// Conts only: what AutoCount collected on a renovation contract before go-live, from its AR collection list (chew,
// 25 Nov 2026: "开多少单我不理，先把collection做好先"; migration 0379). Paid before go-live was worked out as what AutoCount
// invoiced less what the customer still owed (acc/reno-paid-before-golive); where the invoiced figure seeded at go-live
// is off, so was the collection. Finance gives the collection itself here, per contract, and it is the figure from then
// on. Null takes it back to the worked-out figure. Posts nothing: AutoCount's opening balances carry the money.

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as everywhere in acc/ */
type Sb = any;

export const AUTOCOUNT_RECEIVED_MAX_ROWS = 500;

export interface AutocountReceivedRow { soDocNo: string; receivedSen: number | null }
export interface AutocountReceivedPreviewRow extends AutocountReceivedRow {
  problems: string[];
  /** What the contract holds now (null: not given). */
  currentSen: number | null;
}

/** Each row's problems: the SO must be a renovation contract of this company, the figure whole sen and not negative. */
export async function previewAutocountReceived(sb: Sb, companyId: number, rows: readonly AutocountReceivedRow[]): Promise<{ ok: true; rows: AutocountReceivedPreviewRow[] } | { ok: false; error: string }> {
  const docs = [...new Set(rows.map((r) => r.soDocNo).filter(Boolean))];
  const known = new Map<string, number | null>();
  for (let i = 0; i < docs.length; i += 200) {
    const part = docs.slice(i, i + 200);
    const orders = await sb.from('mfg_sales_orders').select('doc_no').eq('company_id', companyId).in('doc_no', part);
    if (orders.error) return { ok: false, error: orders.error.message };
    const mine = (orders.data ?? []).map((o: { doc_no: string }) => String(o.doc_no));
    if (mine.length === 0) continue;
    const k = await sb.from('reno_so_contracts').select('so_doc_no, autocount_received_sen').in('so_doc_no', mine);
    if (k.error) return { ok: false, error: k.error.message };
    for (const c of k.data ?? []) known.set(String(c.so_doc_no), c.autocount_received_sen == null ? null : Number(c.autocount_received_sen));
  }
  const seen = new Set<string>();
  return {
    ok: true,
    rows: rows.map((r) => {
      const problems: string[] = [];
      if (!r.soDocNo) problems.push('The SO is missing.');
      else if (!known.has(r.soDocNo)) problems.push(`${r.soDocNo} is not a renovation contract of this company.`);
      if (seen.has(r.soDocNo)) problems.push(`${r.soDocNo} is in the file twice.`);
      seen.add(r.soDocNo);
      if (r.receivedSen !== null && !(Number.isInteger(r.receivedSen) && r.receivedSen >= 0)) problems.push('The amount must be whole sen, not negative, or blank.');
      return { ...r, problems, currentSen: known.get(r.soDocNo) ?? null };
    }),
  };
}

/** Writes every row or none: a row with a problem stops the lot. */
export async function applyAutocountReceived(sb: Sb, companyId: number, rows: readonly AutocountReceivedRow[]): Promise<
  { ok: true; applied: number } | { ok: false; status: 'problems'; rows: AutocountReceivedPreviewRow[] } | { ok: false; status: 'error'; error: string }
> {
  const p = await previewAutocountReceived(sb, companyId, rows);
  if (!p.ok) return { ok: false, status: 'error', error: p.error };
  if (p.rows.some((r) => r.problems.length > 0)) return { ok: false, status: 'problems', rows: p.rows };
  let applied = 0;
  for (const r of p.rows) {
    if (r.currentSen === r.receivedSen) continue;
    const up = await sb.from('reno_so_contracts').update({ autocount_received_sen: r.receivedSen }).eq('so_doc_no', r.soDocNo);
    if (up.error) return { ok: false, status: 'error', error: `${r.soDocNo}: ${up.error.message}` };
    applied++;
  }
  return { ok: true, applied };
}
