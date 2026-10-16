import { type Env, all, one, json, fail, nowIso } from '../../_lib/db';
import { taskCleanersReady, cleanerNamesSql } from '../../_lib/taskCleaners';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { MYT_DATE, hhmm, slaFor } from '../../_lib/ops';

/** GET /api/operations/today?date= — every open job for the day (cleaning, inspection, maintenance), riskiest first.
 *  Work that is already overdue from earlier days stays on the list until it is done. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Use your own task list.', 403);

  const today = (await one<{ d: string }>(env, `SELECT to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS d`))!.d;
  const asked = new URL(request.url).searchParams.get('date');
  const date = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : today;
  const day = MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)');
  const ready = await taskCleanersReady(env);

  const tasks = await all<any>(env, `
    SELECT t.id, t.kind, t.state, t.title, t.instructions, t.due_at, t.next_guest_at, t.assignee_id, ${day} AS day,
           u.id AS unit_id, u.unit_number, u.readiness, u.base_rate, p.name AS property_name, COALESCE(${cleanerNamesSql(ready)}, cl.full_name, a.full_name, '') AS assignee_name,
           o.id AS owner_id, o.display_name AS owner_name
    FROM tasks t JOIN units u ON u.id = t.unit_id JOIN properties p ON p.id = u.property_id JOIN owners o ON o.id = u.owner_id
    LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN cleaners cl ON cl.id = t.cleaner_id
    WHERE t.state != 'resolved' AND ${day} <= ?`, date);

  // Stays leaving that day with no clean planned: the turnover gap the roster cannot show.
  const gap = await one<{ n: number }>(env, `
    SELECT COUNT(*)::int AS n FROM reservations r
    WHERE r.check_out = ? AND r.state NOT IN ('cancelled','no_show','inquiry') AND r.channel != 'maintenance_block'
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.reservation_id = r.id AND t.kind IN ('turnover','deep_clean','light_clean'))
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.unit_id = r.unit_id AND t.kind IN ('turnover','deep_clean','light_clean') AND ${day} = r.check_out)`,
    date);

  const issues = await all<any>(env, `
    SELECT m.id, m.state, m.title, m.detail, m.vendor_name, m.blocks_unit, m.blocked_from, m.blocked_to,
           u.id AS unit_id, u.unit_number, u.readiness, u.base_rate, p.name AS property_name,
           o.id AS owner_id, o.display_name AS owner_name
    FROM maintenance_issues m JOIN units u ON u.id = m.unit_id JOIN properties p ON p.id = u.property_id JOIN owners o ON o.id = u.owner_id
    WHERE m.state != 'resolved'`);

  const arrivals = await all<any>(env, `
    SELECT r.unit_id, r.channel, r.notes, r.check_in, r.check_in_time, COALESCE(g.full_name, 'Guest') AS guest_name
    FROM reservations r LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.state IN ('confirmed','pending') AND r.channel NOT IN ('maintenance_block','owner_stay')
      AND r.check_in >= ? AND r.check_in <= to_char(?::date + 1, 'YYYY-MM-DD') ORDER BY r.check_in`, date, date);
  const guestFor = (unitId: string) => {
    const a = arrivals.find(x => x.unit_id === unitId);
    return a ? { name: a.guest_name, channel: a.channel, request: a.notes || `Arrives ${a.check_in_time}.` } : null;
  };

  const rows = [
    ...tasks.map(t => {
      const sla = slaFor(t.state, t.due_at);
      return {
        id: t.id, kind: t.kind, unitNumber: t.unit_number, propertyName: t.property_name,
        work: t.title, note: t.instructions, readiness: t.readiness, day: t.day, carriedOver: t.day < date,
        nextGuestAt: hhmm(t.next_guest_at), assigneeId: t.assignee_id, assigneeName: t.assignee_name || null,
        sla, riskRank: 0, guest: guestFor(t.unit_id),
        owner: t.readiness === 'maintenance' || t.readiness === 'blocked' ? { id: t.owner_id, name: t.owner_name, revenueAtRisk: Number(t.base_rate) } : null,
        _minutes: sla.state === 'none' ? 1e9 : sla.minutes, _guest: t.next_guest_at ? 0 : 1,
      };
    }),
    ...issues.map(m => {
      const nights = m.blocked_from && m.blocked_to ? Math.max(1, Math.round((Date.parse(m.blocked_to) - Date.parse(m.blocked_from)) / 864e5)) : 1;
      return {
        id: m.id, kind: 'maintenance', unitNumber: m.unit_number, propertyName: m.property_name,
        work: m.title, note: m.detail, readiness: m.readiness, day: null, carriedOver: false, nextGuestAt: null,
        assigneeId: null, assigneeName: m.vendor_name ?? null,
        sla: m.state === 'overdue' ? { state: 'escalated', minutes: 0, label: 'Escalated', tone: 'critical' } : { state: 'none', minutes: 0, label: 'No deadline', tone: 'neutral' },
        riskRank: 0, guest: null,
        owner: m.blocks_unit ? { id: m.owner_id, name: m.owner_name, revenueAtRisk: Number(m.base_rate) * nights } : null,
        _minutes: m.state === 'overdue' ? -1e6 : 1e9, _guest: 1,
      };
    }),
  ];

  rows.sort((a, b) => a._minutes - b._minutes || a._guest - b._guest);
  return json({
    generatedAt: nowIso(), date, checkoutsWithoutClean: Number(gap?.n ?? 0),
    rows: rows.map(({ _minutes, _guest, ...r }, i) => ({ ...r, riskRank: i + 1 })),
  });
};
