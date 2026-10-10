import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { invalidLeave, toDriverLeavePayload, type DriverLeaveRow } from '../../_lib/driver-leave';
import { strOrNull, genId } from '../../_lib/scm-util';
import { checkDate, invalid, type Fields } from '../../_lib/validate';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LIST_SQL = `
  SELECT l.id, l.driver_id, l.start_date, l.end_date, l.reason, d.driver_code, d.name AS driver_name
  FROM driver_leave l JOIN drivers d ON d.id = l.driver_id`;

/** GET /api/driver-leave?driverId=&from=&to= — overlapping leave, newest first. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const driverId = url.searchParams.get('driverId');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const where: string[] = ['1 = 1']; const args: unknown[] = [];
  if (driverId) { where.push('l.driver_id = ?'); args.push(driverId); }
  if (to && ISO_DATE.test(to)) { where.push('l.start_date <= ?'); args.push(to); }
  if (from && ISO_DATE.test(from)) { where.push('l.end_date >= ?'); args.push(from); }
  const rows = await all<DriverLeaveRow>(env, `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY l.start_date DESC`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toDriverLeavePayload) });
};

/** POST /api/driver-leave { driverId, startDate, endDate, reason? } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can record driver leave.', 403);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const bad = invalidLeave(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });
  const fields: Fields = {};
  checkDate(fields, 'startDate', b.startDate, { label: 'From', required: true });
  checkDate(fields, 'endDate', b.endDate, { label: 'To', required: true });
  const badDate = invalid(fields); if (badDate) return badDate;
  const driverId = (b.driverId as string).trim();
  if (!await one(env, 'SELECT 1 AS x FROM drivers WHERE id = ?', driverId)) return fail('VALIDATION', 'Unknown driver.', 422, { driverId: 'Unknown driver.' });
  const id = genId('lve');
  const now = nowIso();
  await run(env, 'INSERT INTO driver_leave (id, driver_id, start_date, end_date, reason, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, driverId, b.startDate, b.endDate, strOrNull(b.reason), session.userId, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'driver_leave.create', entityTable: 'driver_leave', entityId: id, after: { driverId, startDate: b.startDate, endDate: b.endDate } });
  return json({ id }, 201);
};
