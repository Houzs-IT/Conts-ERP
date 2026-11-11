import { type Env, all, run, json, fail, nowIso, transaction } from '../../_lib/db';
import { auditMany } from '../../_lib/history';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { readAirbnbRows, type AirbnbTxn } from '../../_lib/airbnbCsv';
import { MONTH, hasAirbnbRecon } from './index';

const MAX_FILES = 10, MAX_LINES = 20000;
const COLS = ['id', 'file_id', 'month', 'dedupe_key', 'txn_date', 'arriving_by', 'type', 'code', 'booking_date', 'start_date', 'end_date', 'nights',
  'guest', 'listing', 'details', 'reference_code', 'currency', 'amount', 'paid_out', 'service_fee', 'fast_pay_fee', 'cleaning_fee',
  'gross_earnings', 'remitted_tax', 'created_at'] as const;
const INT_COLS = new Set(['nights', 'amount', 'paid_out', 'service_fee', 'fast_pay_fee', 'cleaning_fee', 'gross_earnings', 'remitted_tax']);
const RECORD = COLS.map(c => `${c} ${INT_COLS.has(c) ? 'integer' : 'text'}`).join(', ');

const rowOf = (t: AirbnbTxn, fileId: string, at: string) => ({
  id: crypto.randomUUID(), file_id: fileId, month: t.txnDate.slice(0, 7), dedupe_key: t.dedupeKey, txn_date: t.txnDate, arriving_by: t.arrivingBy,
  type: t.type, code: t.code, booking_date: t.bookingDate, start_date: t.startDate, end_date: t.endDate, nights: t.nights, guest: t.guest,
  listing: t.listing, details: t.details, reference_code: t.referenceCode, currency: t.currency, amount: t.amount, paid_out: t.paidOut,
  service_fee: t.serviceFee, fast_pay_fee: t.fastPayFee, cleaning_fee: t.cleaningFee, gross_earnings: t.grossEarnings, remitted_tax: t.remittedTax,
  created_at: at,
});

/** POST /api/airbnb-recon/upload { month, files: [{ name, rows }] } — Airbnb transaction CSVs, read in the browser into
 *  rows keyed by their header line. Every file is checked first and nothing is kept if one cannot be read. A line
 *  already uploaded (in this file, another file, or before) is not recorded again (chew: "duplicate 的不要录到两次"):
 *  the answer says how many lines were new and how many were already there. Uploading changes no reservation. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'airbnbRecon', 'edit')) return fail('FORBIDDEN', 'Only people who can edit Airbnb reconciliation upload Airbnb files.', 403);
  if (!(await hasAirbnbRecon(env))) return fail('NOT_READY', 'Airbnb reconciliation is not set up on this database yet (migration 0258).', 503);

  const b = await request.json<any>().catch(() => null);
  const month = typeof b?.month === 'string' ? b.month : '';
  if (!MONTH.test(month)) return fail('VALIDATION', 'Pick the month.', 422, { month: 'Pick the month.' });
  const files = Array.isArray(b?.files) ? b.files : [];
  if (!files.length || files.length > MAX_FILES) {
    return fail('VALIDATION', `Choose between 1 and ${MAX_FILES} Airbnb CSV files.`, 422, { files: `Choose between 1 and ${MAX_FILES} Airbnb CSV files.` });
  }
  const read: { name: string; txns: AirbnbTxn[]; errors: { line: number; message: string }[] }[] = files.map((f: any, i: number) => {
    const name = (typeof f?.name === 'string' ? f.name.trim() : '').slice(0, 200) || `File ${i + 1}`;
    return { name, ...readAirbnbRows(Array.isArray(f?.rows) ? f.rows.filter((r: unknown) => r && typeof r === 'object') : []) };
  });
  const bad = read.find(f => f.errors.length);
  if (bad) {
    const e = bad.errors[0];
    const more = bad.errors.length > 1 ? ` (${bad.errors.length} lines cannot be read)` : '';
    return fail('VALIDATION', `${bad.name}, line ${e.line}: ${e.message}${more}`, 422, { files: `${bad.name}, line ${e.line}: ${e.message}` });
  }
  const empty = read.find(f => !f.txns.length);
  if (empty) return fail('VALIDATION', `${empty.name} has no transaction lines.`, 422, { files: `${empty.name} has no transaction lines.` });
  if (read.reduce((n, f) => n + f.txns.length, 0) > MAX_LINES) {
    return fail('VALIDATION', `Upload at most ${MAX_LINES.toLocaleString('en-MY')} lines at a time.`, 422, { files: `Upload at most ${MAX_LINES.toLocaleString('en-MY')} lines at a time.` });
  }

  // A line in two of these files is recorded from the first; the database skips lines uploaded before.
  const at = nowIso();
  const seen = new Set<string>();
  const plan = read.map(f => {
    const fileId = crypto.randomUUID();
    const fresh = f.txns.filter(t => (seen.has(t.dedupeKey) ? false : (seen.add(t.dedupeKey), true)));
    return { id: fileId, name: f.name, lines: f.txns.length, rows: fresh.map(t => rowOf(t, fileId, at)) };
  });
  const done = await transaction(env, async tx => {
    await run(tx, `
      INSERT INTO airbnb_recon_files (id, month, file_name, row_count, added, duplicates, uploaded_by, uploaded_at)
      SELECT x.id, ?, x.file_name, x.row_count, 0, 0, ?, ? FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, file_name text, row_count integer)`,
      month, session.userId, at, JSON.stringify(plan.map(p => ({ id: p.id, file_name: p.name, row_count: p.lines }))));
    const added = await all<{ file_id: string; n: number }>(tx, `
      WITH ins AS (
        INSERT INTO airbnb_transactions (${COLS.join(', ')})
        SELECT ${COLS.join(', ')} FROM jsonb_to_recordset(?::text::jsonb) AS x(${RECORD})
        ON CONFLICT (dedupe_key) DO NOTHING RETURNING file_id)
      SELECT file_id, count(*)::int AS n FROM ins GROUP BY file_id`, JSON.stringify(plan.flatMap(p => p.rows)));
    const addedBy = new Map(added.map(r => [r.file_id, Number(r.n)]));
    const result = plan.map(p => {
      const n = addedBy.get(p.id) ?? 0;
      return { id: p.id, name: p.name, lines: p.lines, added: n, duplicates: p.lines - n };
    });
    await run(tx, `
      UPDATE airbnb_recon_files f SET added = x.added, duplicates = x.duplicates
      FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, added integer, duplicates integer) WHERE f.id = x.id`, JSON.stringify(result));
    await auditMany(tx, result.map(r => ({
      actorId: session.userId, actorLabel: session.fullName, action: 'airbnb_recon.upload', entityTable: 'airbnb_recon_files', entityId: r.id,
      after: { month, fileName: r.name, lines: r.lines, added: r.added, duplicates: r.duplicates },
    })));
    return result;
  });

  // Which months the lines are dated in, so the page can open the right one.
  const byMonth: Record<string, number> = {};
  for (const t of read.flatMap(f => f.txns)) byMonth[t.txnDate.slice(0, 7)] = (byMonth[t.txnDate.slice(0, 7)] ?? 0) + 1;
  return json({
    files: done, added: done.reduce((n, f) => n + f.added, 0), duplicates: done.reduce((n, f) => n + f.duplicates, 0),
    months: Object.entries(byMonth).sort((a, b) => b[1] - a[1]).map(([m, lines]) => ({ month: m, lines })),
  });
};
