import { type Env, all, json, fail, mytToday } from '../../_lib/db';
import { requireSession, hasColumn } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { reconcileMonth, proposeIncomeType, RULES, INCOME_KINDS, type ReconTxn, type Stay } from '../../_lib/airbnbRecon';
import { bulkEligible, checkIncomeType, incomeKey, type Applied } from '../../_lib/airbnbConfirm';
import { confirmContext, planWith, previewOf } from '../../_lib/airbnbConfirmLoad';
import { hasIncomeTypes, loadIncomeTypes, type IncomeType } from './income-types';

/* Finance > Airbnb reconciliation (chew, 10 Nov 2026; docs/superpowers/plans/2026-11-10-airbnb-reconciliation.md).
   Airbnb's transaction lines for a month, from the uploaded CSVs, matched to the reservations by confirmation code and
   sorted by rule. Step 1 shows; step 2 (decisions.ts, undo.ts) confirms. Closed to every department until management
   opens the Airbnb reconciliation area (chew: "到时我才给权限"). */

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

/** The month's reconciliation, read fresh: every reservation with an Airbnb line dated in the month, compared whole with
 *  its lines of other months; the month's Airbnb check-ins with no payment yet; the files and months uploaded. Each
 *  stay carries its guest total and Airbnb's fee, which confirming changes. */
export async function loadMonth(env: Env, month: string, today: string) {
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
  const stayRows = await all<{ id: string; code: string; unit_id: string; unit: string | null; guest: string | null; check_in: string; check_out: string; state: string; gross: number; fee: number }>(env, `
    SELECT r.id, UPPER(TRIM(r.external_ref)) AS code, r.unit_id, COALESCE(NULLIF(u.unit_code, ''), u.unit_number) AS unit, g.full_name AS guest,
           r.check_in, r.check_out, r.state, COALESCE(r.gross_booking_value, 0) AS gross, COALESCE(r.channel_fee, 0) AS fee
    FROM reservations r LEFT JOIN units u ON u.id = r.unit_id LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.channel NOT IN ('maintenance_block', 'owner_stay') AND NULLIF(TRIM(r.external_ref), '') IS NOT NULL
      AND (UPPER(TRIM(r.external_ref)) IN (SELECT jsonb_array_elements_text(?::text::jsonb))
           OR (r.channel = 'airbnb' AND r.check_in >= ? AND r.check_in < ?))`,
    JSON.stringify(monthCodes), `${month}-01`, `${nextMonth(month)}-01`);
  const stays: Stay[] = stayRows.map(s => {
    const gross = Number(s.gross), fee = Number(s.fee);
    return { id: s.id, code: s.code, unitId: s.unit_id, unit: s.unit ?? s.unit_id, guest: s.guest, checkIn: s.check_in, checkOut: s.check_out, state: s.state, net: Math.max(0, gross - fee), gross, fee };
  });

  // Every uploaded line of those codes, in any month: a reservation is compared whole.
  const codes = [...new Set([...monthCodes, ...stays.map(s => s.code)])];
  const codeRows = codes.length
    ? await all<TxnRow>(env, `SELECT ${TXN_COLS} FROM airbnb_transactions WHERE code IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND month <> ?`, JSON.stringify(codes), month)
    : [];
  return { recon: reconcileMonth(month, [...monthRows, ...codeRows].map(txnOf), stays, today), files, months };
}

interface DecisionRow { id: string; code: string; action: string; note: string | null; applied: string | null; confirmed_at: string; confirmed_by: string | null }
interface RecordedRow { code: string | null; transaction_ids: string | null; type_id: string | null; sub_type_id: string | null; amount: number }
/** A recorded income line's key, as incomeKey gives it for the line it came from. */
const recordedKey = (r: RecordedRow) => {
  try { return (JSON.parse(r.transaction_ids ?? '[]') as string[]).join(','); } catch { return ''; }
};

/** GET /api/airbnb-recon?month=YYYY-MM (default last month) — the month's reconciliation, and for step 2: each line's
 *  decision, the type each company income line starts with, what confirming would change (`preview`; for a line to
 *  check whose reservation can take Airbnb's figure, `previewSet` too), and the company income recorded. Amounts in sen. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'airbnbRecon', 'view')) return fail('FORBIDDEN', 'Your access does not include Airbnb reconciliation.', 403);
  const today = mytToday();
  const asked = new URL(request.url).searchParams.get('month') ?? '';
  const month = MONTH.test(asked) ? asked : lastMonth(today.slice(0, 7));
  const mayUpload = can(session, 'airbnbRecon', 'edit');
  if (!(await hasAirbnbRecon(env))) return json({ ready: false, month, today, mayUpload });
  // Migration 0259: income types, and company income by type. Until it runs the page only shows, as in step 1.
  const confirmReady = await hasIncomeTypes(env);

  const [{ recon, files, months }, decisions, types, recorded] = await Promise.all([
    loadMonth(env, month, today),
    confirmReady ? all<DecisionRow>(env, `
      SELECT d.id, d.code, d.action, d.note, d.applied, d.confirmed_at, u.full_name AS confirmed_by
      FROM airbnb_recon_decisions d LEFT JOIN users u ON u.id = d.confirmed_by WHERE d.month = ?`, month) : Promise.resolve([] as DecisionRow[]),
    confirmReady ? loadIncomeTypes(env) : Promise.resolve([] as IncomeType[]),
    confirmReady ? all<RecordedRow>(env, `SELECT code, transaction_ids, type_id, sub_type_id, amount FROM airbnb_company_income WHERE month = ?`, month)
      : Promise.resolve([] as RecordedRow[]),
  ]);

  const decided = new Map(decisions.map(d => [d.code, d]));
  const open = recon.lines.filter(l => l.needsConfirm && !decided.has(l.code));
  const ctx = confirmReady && open.length ? await confirmContext(env, open) : null;
  const lines = recon.lines.map(l => {
    const d = decided.get(l.code);
    const income = l.income.map(i => ({ ...i, key: incomeKey(i), proposed: confirmReady ? proposeIncomeType(types, i.kind, i.details) : null }));
    const toConfirm = !!ctx && !d && l.needsConfirm;
    const preview = toConfirm ? previewOf(ctx!, l, planWith(ctx!, l, today)) : null;
    const previewSet = toConfirm && l.action === 'check' && l.newAmount != null ? previewOf(ctx!, l, planWith(ctx!, l, today, true)) : null;
    const bulk = !!preview?.ok && bulkEligible(l) && income.every(i => !!i.proposed && checkIncomeType(types, i.proposed.typeId, i.proposed.subTypeId).ok);
    let decision = null;
    if (d) {
      const applied = d.applied ? JSON.parse(d.applied) as Applied : null;
      decision = {
        action: d.action, note: d.note, at: d.confirmed_at, by: d.confirmed_by,
        reservations: applied?.changes.length ?? 0, income: applied?.incomeIds.length ?? 0,
        ownerShares: (applied?.shares ?? []).map(s => ({ sen: s.sen, onMonth: s.onMonth })),
      };
    }
    return { ...l, income, decision, preview, previewSet, bulk };
  });

  return json({
    ready: true, confirmReady, month, today, mayUpload,
    mayConfirm: confirmReady && can(session, 'airbnbRecon', 'edit'), mayManageTypes: confirmReady && can(session, 'airbnbRecon', 'full'),
    rules: RULES, incomeKinds: INCOME_KINDS, incomeTypes: types,
    months: months.map(m => ({ month: m.month, lines: Number(m.n) })),
    files: files.map(f => ({ id: f.id, fileName: f.file_name, lines: Number(f.row_count), added: Number(f.added), duplicates: Number(f.duplicates), uploadedAt: f.uploaded_at, uploadedBy: f.uploaded_by })),
    lines, summary: recon.summary, totals: recon.totals,
    recordedIncome: recorded.map(r => ({ code: r.code, key: recordedKey(r), typeId: r.type_id, subTypeId: r.sub_type_id, amount: Number(r.amount) })),
    payouts: recon.payouts.map(p => ({ id: p.id, date: p.txnDate, arrivingBy: p.arrivingBy ?? null, details: p.details, referenceCode: p.referenceCode ?? null, paidOut: p.paidOut })),
    loose: recon.loose.map(t => ({ id: t.id, date: t.txnDate, type: t.type, details: t.details, amount: t.amount })),
  });
};
