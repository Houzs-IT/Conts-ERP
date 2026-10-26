import { type Env, run, json, fail, audit, nowIso, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { peopleWithAccess } from '../../_lib/access';
import { notifyUsers } from '../../_lib/notify';
import { hasEmployees, employeeForUser, ensureEmployeeId } from '../../_lib/hr';
import { hasLeaves, NOT_MIGRATED, readHolidays, leavesInYear, overlapping, toLeave, balancesFor } from '../../_lib/leave';
import { leaveRequest, calendarDays, LEAVE_TYPE_LABEL } from '../../_lib/leaveRules';
import { day } from '../../_lib/notices';

const NOT_ON_LIST = 'Leave is for the company\'s own cleaners and technicians. Ask the office to add you.';
/** How far back a request may start: a medical certificate is often brought in after the days off. */
const BACKDATE_DAYS = 30;

/** GET /api/field/leave — the signed-in person's balances this year, their requests, and the year's public holidays. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await hasEmployees(env)) || !(await hasLeaves(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const me = await employeeForUser(env, session.userId);
  if (!me) return fail('FORBIDDEN', NOT_ON_LIST, 403);

  const today = mytToday();
  const year = Number(today.slice(0, 4));
  const holidays = await readHolidays(env);
  const leaves = me.id ? (await leavesInYear(env, year, me.id)).map(r => toLeave(r, holidays)) : [];
  return json({
    name: me.name, employeeId: me.employeeId, year, today,
    balances: balancesFor(me, leaves, year, holidays, today),
    leaves, holidays: holidays.filter(h => h.date.startsWith(`${year}-`)),
  });
};

/** POST /api/field/leave { type, startDate, endDate, reason? } — apply for leave. The office is told and decides. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await hasEmployees(env)) || !(await hasLeaves(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const me = await employeeForUser(env, session.userId);
  if (!me) return fail('FORBIDDEN', NOT_ON_LIST, 403);
  if (me.status === 'resigned') return fail('FORBIDDEN', 'Your employee record says you have left. Ask the office if that is wrong.', 403);

  const parsed = leaveRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail('VALIDATION', 'Some fields need a fix.', 422, Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0] ?? 'form'), i.message])));
  }
  const r = parsed.data;
  const earliest = new Date(Date.parse(`${mytToday()}T00:00:00Z`) - BACKDATE_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (r.startDate < earliest) return fail('VALIDATION', 'Some fields need a fix.', 422, { startDate: `Leave can start at most ${BACKDATE_DAYS} days back. Ask the office for older days.` });

  const employeeId = await ensureEmployeeId(env, me);
  const clash = await overlapping(env, employeeId, r.startDate, r.endDate);
  if (clash) return fail('CONFLICT', `You already asked for leave from ${day(clash.start_date)} to ${day(clash.end_date)}. Cancel that one first.`, 409, { startDate: 'Overlaps another request.' });

  const id = crypto.randomUUID(), now = nowIso();
  const days = calendarDays(r.startDate, r.endDate);
  await run(env, `
    INSERT INTO leaves (id, employee_id, type, start_date, end_date, days, reason, status, requested_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`, id, employeeId, r.type, r.startDate, r.endDate, days, r.reason, session.userId, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'leave.request', entityTable: 'leaves', entityId: id, source: 'field_app', after: { ...r, days } });

  const office = await peopleWithAccess(env, 'hr', 'edit');
  const span = r.startDate === r.endDate ? day(r.startDate) : `${day(r.startDate)} to ${day(r.endDate)}`;
  await notifyUsers(env, office.map(p => p.id), {
    kind: 'leave.requested', title: `${me.name} asked for ${LEAVE_TYPE_LABEL[r.type].toLowerCase()} leave`,
    body: `${span}, ${days} ${days === 1 ? 'day' : 'days'}.${r.reason ? ` ${r.reason}` : ''}`,
    link: '/operations/workers?tab=leave', entityTable: 'leaves', entityId: id, dedupeKey: `leave-${id}`, except: session.userId,
  });
  return json({ id }, 201);
};
