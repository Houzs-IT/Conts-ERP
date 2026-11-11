import { type Env, all, json, fail, mytToday } from '../../_lib/db';
import { requireSession, hasColumn } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { reconcileMonth, RULES, INCOME_KINDS, type ReconTxn, type Stay } from '../../_lib/airbnbRecon';

/* Finance > Airbnb reconciliation (chew, 10 Nov 2026; docs/superpowers/plans/2026-11-10-airbnb-reconciliation.md).
   Airbnb's transaction lines for a month, from the uploaded CSVs, matched to the bookings by confirmation code and
   sorted by rule. Step 1 only shows: nothing here writes. Closed to every department until management opens the
   Airbnb reconciliation area (chew: "到时我才给权限"). */

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Migration 0258 made the tables; until it runs the page says so instead of failing. */
export const hasAirbnbRecon = (env: Env) => hasColumn(env, 'airbnb_transactions', 'dedupe_key');
export const nextMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};
const lastMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
};

interface TxnRow {
  id: string; txn_date: string; arriving_by: string | null; type: string; code: string | null; start_date: string | null; end_date: string | null;
  nights: number | null; guest: string | null; listing: string | null; details: string | null; reference_code: string | null; amount: number; paid_out: number;
}
const TXN_COLS = `id, txn_date, arriving_by, type, code, start_date, end_date, nights, guest, listing, details, reference_code, amount, paid_out`;
const txnOf = (r: TxnRow): ReconTxn => ({
  id: r.id, txnDate: r.txn_date, arrivingBy: r.arriving_by, type: r.type, code: r.code, startDate: r.start_date, endDate: r.end_date,
  nights: r.nights == null ? null : Number(r.nights), guest: r.guest, listing: r.listing, details: r.details, referenceCode: r.reference_code,
  amount: Number(r.amount), paidOut: Number(r.paid_out),
});

/** GET /api/airbnb-recon?month=YYYY-MM (default last month) — the month's reconciliation: every booking with an
 *  Airbnb line dated in the month, compared whole with its lines of other months; the month's Airbnb check-ins with no
 *  payment yet; company income by kind; the bank transfers; the files uploaded for the month. Amounts in sen. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'airbnbRecon', 'view')) return fail('FORBIDDEN', 'Your access does not include Airbnb reconciliation.', 403);
  const today = mytToday();
  const asked = new URL(request.url).searchParams.get('month') ?? '';
  const month = MONTH.test(asked) ? asked : lastMonth(today.slice(0, 7));
  const mayUpload = can(session, 'airbnbRecon', 'edit');
  if (!(await hasAirbnbRecon(env))) return json({ ready: false, month, today, mayUpload });

  const [monthRows, files, months] = await Promise.all([
    all<TxnRow>(env, `SELECT ${TXN_COLS} FROM airbnb_transactions WHERE month = ?`, month),
    all<{ id: string; file_name: string; row_count: number; added: number; duplicates: number; uploaded_at: string; uploaded_by: string | null }>(env, `
      SELECT f.id, f.file_name, f.row_count, f.added, f.duplicates, f.uploaded_at, u.full_name AS uploaded_by
      FROM airbnb_recon_files f LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.month = ? OR f.id IN (SELECT DISTINCT file_id FROM airbnb_transactions WHERE month = ?)
      ORDER BY f.uploaded_at DESC`, month, month),
    all<{ month: string; n: number }>(env, `SELECT month, count(*)::int AS n FROM airbnb_transactions GROUP BY month ORDER BY month DESC LIMIT 24`),
  ]);

  // The system's stays for the month's codes, and the month's Airbnb check-ins (R12: not paid yet).
  const monthCodes = [...new Set(monthRows.map(r => r.code).filter((c): c is string => !!c))];
  const stayRows = await all<{ id: string; code: string; unit_id: string; unit: string | null; guest: string | null; check_in: string; check_out: string; state: string; net: number }>(env, `
    SELECT r.id, UPPER(TRIM(r.external_ref)) AS code, r.unit_id, COALESCE(NULLIF(u.unit_code, ''), u.unit_number) AS unit, g.full_name AS guest,
           r.check_in, r.check_out, r.state, GREATEST(0, COALESCE(r.gross_booking_value, 0) - COALESCE(r.channel_fee, 0)) AS net
    FROM reservations r LEFT JOIN units u ON u.id = r.unit_id LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.channel NOT IN ('maintenance_block', 'owner_stay') AND NULLIF(TRIM(r.external_ref), '') IS NOT NULL
      AND (UPPER(TRIM(r.external_ref)) IN (SELECT jsonb_array_elements_text(?::text::jsonb))
           OR (r.channel = 'airbnb' AND r.check_in >= ? AND r.check_in < ?))`,
    JSON.stringify(monthCodes), `${month}-01`, `${nextMonth(month)}-01`);
  const stays: Stay[] = stayRows.map(s => ({
    id: s.id, code: s.code, unitId: s.unit_id, unit: s.unit ?? s.unit_id, guest: s.guest, checkIn: s.check_in, checkOut: s.check_out, state: s.state, net: Number(s.net),
  }));

  // Every uploaded line of those codes, in any month: a booking is compared whole.
  const codes = [...new Set([...monthCodes, ...stays.map(s => s.code)])];
  const codeRows = codes.length
    ? await all<TxnRow>(env, `SELECT ${TXN_COLS} FROM airbnb_transactions WHERE code IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND month <> ?`, JSON.stringify(codes), month)
    : [];
  const txns = [...monthRows, ...codeRows].map(txnOf);
  const recon = reconcileMonth(month, txns, stays, today);

  return json({
    ready: true, month, today, mayUpload, rules: RULES, incomeKinds: INCOME_KINDS,
    months: months.map(m => ({ month: m.month, lines: Number(m.n) })),
    files: files.map(f => ({ id: f.id, fileName: f.file_name, lines: Number(f.row_count), added: Number(f.added), duplicates: Number(f.duplicates), uploadedAt: f.uploaded_at, uploadedBy: f.uploaded_by })),
    lines: recon.lines, summary: recon.summary, totals: recon.totals,
    payouts: recon.payouts.map(p => ({ id: p.id, date: p.txnDate, arrivingBy: p.arrivingBy ?? null, details: p.details, referenceCode: p.referenceCode ?? null, paidOut: p.paidOut })),
    loose: recon.loose.map(t => ({ id: t.id, date: t.txnDate, type: t.type, details: t.details, amount: t.amount })),
  });
};
