import { type Env, all, json, fail, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { MYT_DATE } from '../../_lib/ops';
import { CLEAN_KINDS_SQL, LIVE_STAY_SQL, windowsOnDay, mytToday, isDay } from '../../_lib/cleaning';

/** GET /api/operations/day?date= — the Today screen, in the same terms as Cleaning: guests arriving (with the
 *  state of their unit's clean), guests leaving (and whether they have left), the day's cleans by status, and
 *  repairs: windows booked that day plus urgent open jobs. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Use your own job list.', 403);

  const today = mytToday();
  const asked = new URL(request.url).searchParams.get('date');
  const date = isDay(asked) ? asked : today;
  const when = MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)');

  const arrivals = await all<any>(env, `
    SELECT r.id, r.state, r.channel, r.check_in_time, r.check_out, r.guests_count, u.id AS unit_id, u.unit_number, u.readiness,
           p.id AS property_id, p.name AS property_name, COALESCE(NULLIF(g.full_name, ''), CASE WHEN r.channel = 'owner_stay' THEN 'Owner stay' ELSE 'Guest' END) AS guest_name,
           (SELECT t.state FROM tasks t WHERE t.unit_id = r.unit_id AND t.kind IN ${CLEAN_KINDS_SQL} AND ${when} = r.check_in ORDER BY t.created_at DESC LIMIT 1) AS clean_state
    FROM reservations r JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.check_in = ? AND ${LIVE_STAY_SQL('r')}
    ORDER BY r.check_in_time, p.name, u.unit_number`, date);

  const departures = await all<any>(env, `
    SELECT r.id, r.state, r.channel, r.check_out_time, u.id AS unit_id, u.unit_number, p.id AS property_id, p.name AS property_name,
           COALESCE(NULLIF(g.full_name, ''), CASE WHEN r.channel = 'owner_stay' THEN 'Owner stay' ELSE 'Guest' END) AS guest_name,
           c.id AS task_id, c.state AS task_state, c.guest_left_at
    FROM reservations r JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id LEFT JOIN guests g ON g.id = r.guest_id
    LEFT JOIN LATERAL (
      SELECT t.id, t.state, t.guest_left_at FROM tasks t
      WHERE t.kind IN ${CLEAN_KINDS_SQL} AND (t.reservation_id = r.id OR (t.unit_id = r.unit_id AND ${when} = r.check_out))
      ORDER BY (t.reservation_id = r.id) DESC LIMIT 1
    ) c ON TRUE
    WHERE r.check_out = ? AND ${LIVE_STAY_SQL('r')}
    ORDER BY r.check_out_time, p.name, u.unit_number`, date);

  const cleans = await all<{ state: string; assigned: boolean; left: boolean; n: number }>(env, `
    SELECT t.state, (t.cleaner_id IS NOT NULL OR t.assignee_id IS NOT NULL) AS assigned,
           (t.guest_left_at IS NOT NULL OR EXISTS (SELECT 1 FROM reservations r WHERE r.id = t.reservation_id AND r.state = 'checked_out')) AS left,
           COUNT(*)::int AS n
    FROM tasks t WHERE t.kind IN ${CLEAN_KINDS_SQL} AND (${when} = ? OR (? = ? AND ${when} < ? AND t.state != 'resolved'))
    GROUP BY 1, 2, 3`, date, date, today, date);
  const sum = (f: (c: typeof cleans[number]) => boolean) => cleans.filter(f).reduce((s, c) => s + Number(c.n), 0);

  const urgent = await all<any>(env, `
    SELECT m.id, m.title, m.state, m.category, m.vendor_name, m.blocks_unit, u.unit_number, p.name AS property_name
    FROM maintenance_issues m JOIN units u ON u.id = m.unit_id JOIN properties p ON p.id = u.property_id
    WHERE m.state != 'resolved' AND (m.urgency = 'urgent' OR m.blocks_unit = 1) ORDER BY m.reported_at`);

  return json({
    generatedAt: nowIso(), date, today,
    arrivals: arrivals.map(a => ({
      reservationId: a.id, state: a.state, channel: a.channel, guestName: a.guest_name, guests: Number(a.guests_count ?? 0),
      checkInTime: a.check_in_time || '15:00', checkOut: a.check_out,
      unitId: a.unit_id, unitNumber: a.unit_number, readiness: a.readiness, buildingId: a.property_id, propertyName: a.property_name,
      cleanState: a.clean_state ?? null,
    })),
    departures: departures.map(d => ({
      reservationId: d.id, state: d.state, channel: d.channel, guestName: d.guest_name, checkOutTime: d.check_out_time || '11:00',
      unitId: d.unit_id, unitNumber: d.unit_number, buildingId: d.property_id, propertyName: d.property_name,
      taskId: d.task_id ?? null, taskState: d.task_state ?? null,
      guestOut: d.state === 'checked_out' || !!d.guest_left_at,
    })),
    cleans: {
      total: sum(() => true), done: sum(c => c.state === 'resolved'), cleaning: sum(c => c.state === 'in_progress'),
      ready: sum(c => c.state !== 'resolved' && c.state !== 'in_progress' && c.left),
      unassigned: sum(c => c.state !== 'resolved' && !c.assigned),
    },
    repairs: await windowsOnDay(env, date),
    urgent: urgent.map(m => ({ id: m.id, title: m.title, state: m.state, category: m.category, assigneeName: m.vendor_name ?? null, blocksUnit: !!m.blocks_unit, unitNumber: m.unit_number, propertyName: m.property_name })),
  });
};
