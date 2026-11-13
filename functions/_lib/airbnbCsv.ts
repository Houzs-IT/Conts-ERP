/** Airbnb's transaction history CSV (chew, 10 Nov 2026), parsed in the browser into objects keyed by its header row
 *  (src/lib/sheets.ts csvObjects) and turned here into rows for airbnb_transactions. Amounts in sen, dates YYYY-MM-DD.
 *  Pure: no database, so it is tested on its own (src/lib/airbnbRecon.test.mjs). */

export const AIRBNB_HEADERS = ['Date', 'Type', 'Confirmation code', 'Amount', 'Paid out'] as const;

export interface AirbnbTxn {
  txnDate: string; arrivingBy: string | null; type: string; code: string | null;
  bookingDate: string | null; startDate: string | null; endDate: string | null; nights: number | null;
  guest: string | null; listing: string | null; details: string | null; referenceCode: string | null; currency: string | null;
  amount: number; paidOut: number;
  serviceFee: number | null; fastPayFee: number | null; cleaningFee: number | null; grossEarnings: number | null; remittedTax: number | null;
  dedupeKey: string;
}

/** "10/29/2026" (Airbnb writes month/day/year) -> "2026-10-29". Blank -> null; anything else -> undefined. */
export function usDate(v: unknown): string | null | undefined {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (!m) return undefined;
  const iso = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? undefined : iso;
}

/** "1,234.56", "-42.09", "RM 80" -> sen. Blank -> null; not a number -> undefined. */
export function senOf(v: unknown): number | null | undefined {
  const t = String(v ?? '').trim().replace(/^RM\s*/i, '').replace(/,/g, '');
  if (!t) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return undefined;
  return Math.round(Number(t) * 100);
}

const text = (v: unknown) => { const t = String(v ?? '').trim(); return t ? t : null; };

/** The same line uploaded twice (or in two files) is one transaction (chew: "duplicate 的不要录到两次"). Two lines of
 *  one file that read the same are both real, so the second is keyed "#2": uploading that file again still finds both. */
export const dedupeKeyOf = (t: Pick<AirbnbTxn, 'txnDate' | 'type' | 'code' | 'amount' | 'paidOut' | 'referenceCode'>, nth = 1) =>
  [t.txnDate, t.type, t.code ?? '', t.amount, t.paidOut, t.referenceCode ?? ''].join('|') + (nth > 1 ? `#${nth}` : '');

/** Rows of one file -> transactions, or the lines that could not be read. A file without Airbnb's columns is refused. */
export function readAirbnbRows(rows: Record<string, unknown>[]): { txns: AirbnbTxn[]; errors: { line: number; message: string }[] } {
  const errors: { line: number; message: string }[] = [];
  const first = rows[0] ?? {};
  const keys = new Set(Object.keys(first).map(k => k.trim()));
  const missing = AIRBNB_HEADERS.filter(h => !keys.has(h));
  if (rows.length && missing.length) return { txns: [], errors: [{ line: 1, message: `This is not an Airbnb transaction file: no ${missing.join(', ')} column.` }] };
  const txns: AirbnbTxn[] = [];
  const seen = new Map<string, number>();
  rows.forEach((raw, i) => {
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) r[k.trim()] = v;
    const line = Number(r._row) || i + 2;
    const type = text(r['Type']);
    if (!type && Object.entries(r).every(([k, v]) => k === '_row' || !String(v ?? '').trim())) return;
    const txnDate = usDate(r['Date']);
    const amount = senOf(r['Amount']), paidOut = senOf(r['Paid out']);
    // vocab-ok: Airbnb's own CSV column names, matched exactly
    const dates = ['Arriving by date', 'Booking date', 'Start date', 'End date'].map(k => usDate(r[k]));
    const money = ['Service fee', 'Fast pay fee', 'Cleaning fee', 'Gross earnings', 'Airbnb remitted tax'].map(k => senOf(r[k]));
    if (!type || !txnDate) { errors.push({ line, message: 'The Date or Type is missing or not a date.' }); return; }
    if (amount === undefined || paidOut === undefined || money.includes(undefined) || dates.includes(undefined)) {
      errors.push({ line, message: 'An amount or a date cannot be read.' });
      return;
    }
    const nights = String(r['Nights'] ?? '').trim();
    const t = {
      txnDate, arrivingBy: dates[0] ?? null, type, code: text(r['Confirmation code'])?.toUpperCase() ?? null,
      bookingDate: dates[1] ?? null, startDate: dates[2] ?? null, endDate: dates[3] ?? null, nights: /^\d+$/.test(nights) ? Number(nights) : null,
      guest: text(r['Guest']), listing: text(r['Listing']), details: text(r['Details']), referenceCode: text(r['Reference code']), currency: text(r['Currency']),
      amount: amount ?? 0, paidOut: paidOut ?? 0,
      serviceFee: money[0] ?? null, fastPayFee: money[1] ?? null, cleaningFee: money[2] ?? null, grossEarnings: money[3] ?? null, remittedTax: money[4] ?? null,
    };
    const base = dedupeKeyOf(t), nth = (seen.get(base) ?? 0) + 1;
    seen.set(base, nth);
    txns.push({ ...t, dedupeKey: dedupeKeyOf(t, nth) });
  });
  return { txns, errors };
}
