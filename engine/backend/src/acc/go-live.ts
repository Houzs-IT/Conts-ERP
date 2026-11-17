// Conts only (not part of Houzs's code): the day renovation contracts go live in the ERP's ledger. AutoCount kept the
// books until the documents' cut-over (acc/opening documentsDayOf; chew, 17 Nov 2026), and a contract it booked by
// then (its "TOTAL SALES ORDER" invoice to the project's 480/481 account) is carried by AutoCount's figures, not by a
// signing the ERP posts. So the go-live is the day after the cut-over when one is set, else the ledger start.

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as everywhere in acc/ */
type Db = any;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const nextDay = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** The go-live from the settings row: the day after the cut-over when it is later than the ledger start. */
export function goLiveOf(row: { ledger_start_date?: string | null; documents_cutover_date?: string | null } | null): string | null {
  const start = String(row?.ledger_start_date ?? '').slice(0, 10);
  const cut = String(row?.documents_cutover_date ?? '').slice(0, 10);
  const after = DAY.test(cut) ? nextDay(cut) : null;
  if (!DAY.test(start)) return after;
  return after && after > start ? after : start;
}

export async function renoGoLiveDay(sb: Db, companyId: number): Promise<{ ok: true; day: string | null } | { ok: false; error: string }> {
  const { data, error } = await sb.from('acc_company_settings').select('ledger_start_date, documents_cutover_date').eq('company_id', companyId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, day: goLiveOf(data) };
}
