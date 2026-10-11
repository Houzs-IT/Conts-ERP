import { type Env, all, json, fail, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { MYT_DATE } from '../../_lib/ops';
import { CLEAN_KINDS_SQL, LIVE_STAY_SQL, windowsOnDay, mytToday, isDay } from '../../_lib/cleaning';

// The last time the booking was moved into a state, from the audit trail: when the guest was recorded in or out.
const MOVED_AT = (state: string) => `(SELECT a.occurred_at FROM audit_log a WHERE a.entity_table = 'reservations' AND a.entity_id = r.id
  AND a.action = 'reservation.status' AND a.after_state LIKE '%"state":"${state}"%' ORDER BY a.occurred_at DESC LIMIT 1)`;

/** GET /api/operations/day?date= — the Today screen, in the same terms as Cleaning: guests arriving (with the
 *  state of their unit's clean, and when they were recorded in), guests leaving (and when they left), the day's
 *  cleans by status, maintenance to watch that day, and the units with nobody staying that night. */
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
           (SELECT t.state FROM tasks t WHERE t.unit_id = r.unit_id AND t.kind IN ${CLEAN_KINDS_SQL} AND ${when} = r.check_in ORDER BY t.created_at DESC LIMIT 1) AS clean_state,
           ${MOVED_AT('checked_in')} AS arrived_at
    FROM reservations r JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.check_in = ? AND ${LIVE_STAY_SQL('r')}
    ORDER BY r.check_in_time, p.name, u.unit_number`, date);

  const departures = await all<any>(env, `
    SELECT r.id, r.state, r.channel, r.check_out_time, u.id AS unit_id, u.unit_number, p.id AS property_id, p.name AS property_name,
           COALESCE(NULLIF(g.full_name, ''), CASE WHEN r.channel = 'owner_stay' THEN 'Owner stay' ELSE 'Guest' END) AS guest_name,
           c.id AS task_id, c.state AS task_state, COALESCE(c.guest_left_at, ${MOVED_AT('checked_out')}) AS left_at
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
      cleanState: a.clean_state ?? null, arrivedAt: a.state === 'checked_in' || a.state === 'checked_out' ? a.arrived_at ?? null : null,
    })),
    departures: departures.map(d => ({
      reservationId: d.id, state: d.state, channel: d.channel, guestName: d.guest_name, checkOutTime: d.check_out_time || '11:00',
      unitId: d.unit_id, unitNumber: d.unit_number, buildingId: d.property_id, propertyName: d.property_name,
      taskId: d.task_id ?? null, taskState: d.task_state ?? null,
      guestOut: d.state === 'checked_out' || !!d.left_at, leftAt: d.left_at ?? null,
    })),
    cleans: {
      total: sum(() => true), done: sum(c => c.state === 'resolved'), cleaning: sum(c => c.state === 'in_progress'),
      ready: sum(c => c.state !== 'resolved' && c.state !== 'in_progress' && c.left),
      unassigned: sum(c => c.state !== 'resolved' && !c.assigned),
    },
    repairs: await windowsOnDay(env, date),
    maintenance: await maintenanceOnDay(env, date, today),
    available: await availableOnNight(env, date, today),
    urgent: urgent.map(m => ({ id: m.id, title: m.title, state: m.state, category: m.category, assigneeName: m.vendor_name ?? null, blocksUnit: !!m.blocks_unit, unitNumber: m.unit_number, propertyName: m.property_name })),
  });
};

/** Where a job is, in the words of the Maintenance screen (its statusOf). */
function progressOf(m: any): string {
  if (m.state === 'resolved') return 'done';
  if (m.owner_approval_required && !m.owner_approved_at && m.charge_to === 'owner') return 'awaiting_owner';
  if (m.ended_at) return 'repair_finished';
  if (m.state === 'in_progress' || m.started_at) return 'in_progress';
  if (m.vendor_name || m.assignee_user_id) return 'assigned';
  return 'reported';
}

/** Maintenance to watch on a day: a repair visit booked that day, urgent or unit-blocking jobs still open (and those
 *  finished that day, so the screen shows them done), and jobs past due: marked overdue, a visit already over with the
 *  repair not finished, or a repair block meant to end by that day. */
async function maintenanceOnDay(env: Env, date: string, today: string) {
  const from = `${date}T00:00:00+08:00`, to = `${date}T23:59:59+08:00`;
  // A visit counts as missed once it is over: today that is now, on another day the start of that day.
  const cutoff = date === today ? new Date().toISOString() : from;
  const rows = await all<any>(env, `
    SELECT m.id, m.title, m.state, m.urgency, m.category, m.vendor_name, m.assignee_user_id, m.blocks_unit, m.blocked_to,
           m.owner_approval_required, m.owner_approved_at, m.charge_to, m.started_at, m.ended_at, m.resolved_at, m.reported_at,
           u.id AS unit_id, u.unit_number, p.id AS property_id, p.name AS property_name,
           w.starts_at AS window_start, w.ends_at AS window_end,
           EXISTS (SELECT 1 FROM maintenance_windows x WHERE x.issue_id = m.id AND x.ends_at::timestamptz < ?::timestamptz) AS visit_missed
    FROM maintenance_issues m JOIN units u ON u.id = m.unit_id JOIN properties p ON p.id = u.property_id
    LEFT JOIN LATERAL (
      SELECT x.starts_at, x.ends_at FROM maintenance_windows x
      WHERE x.issue_id = m.id AND x.starts_at::timestamptz <= ?::timestamptz AND x.ends_at::timestamptz >= ?::timestamptz
      ORDER BY x.starts_at LIMIT 1
    ) w ON TRUE
    WHERE w.starts_at IS NOT NULL
       OR (m.state != 'resolved' AND (m.urgency = 'urgent' OR m.blocks_unit = 1 OR m.state = 'overdue'
           OR (m.blocked_to IS NOT NULL AND m.blocked_to <= ?)
           OR (m.ended_at IS NULL AND EXISTS (SELECT 1 FROM maintenance_windows x WHERE x.issue_id = m.id AND x.ends_at::timestamptz < ?::timestamptz))))
       OR (m.state = 'resolved' AND (m.urgency = 'urgent' OR m.blocks_unit = 1) AND ${MYT_DATE('m.resolved_at')} = ?)
    ORDER BY m.reported_at`, cutoff, to, from, date, cutoff, date);
  const rank: Record<string, number> = { overdue: 0, urgent: 1, visit: 2, blocking: 3 };
  return rows.map(m => {
    const open = m.state !== 'resolved';
    const overdue = open && (m.state === 'overdue' || (!!m.blocked_to && m.blocked_to <= date) || (!!m.visit_missed && !m.ended_at && !m.window_start));
    const why = overdue ? 'overdue' : m.urgency === 'urgent' ? 'urgent' : m.window_start ? 'visit' : 'blocking';
    return {
      id: m.id, title: m.title, state: m.state, progress: progressOf(m), why, urgent: m.urgency === 'urgent',
      category: m.category, assigneeName: m.vendor_name ?? null, blocksUnit: !!m.blocks_unit,
      visit: m.window_start ? { startsAt: m.window_start, endsAt: m.window_end } : null,
      dueBy: m.blocked_to ?? null, reportedAt: m.reported_at, resolvedAt: m.resolved_at ?? null,
      unitId: m.unit_id, unitNumber: m.unit_number, buildingId: m.property_id, propertyName: m.property_name,
    };
  }).sort((a, b) => Number(a.progress === 'done') - Number(b.progress === 'done') || rank[a.why] - rank[b.why]);
}

/** Units with nobody staying the night of `date`, and whether each can take a guest: ready, needs a clean first (a guest
 *  leaves that day, or it is dirty or being cleaned now), or blocked for repair. */
async function availableOnNight(env: Env, date: string, today: string) {
  const when = MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)');
  const rows = await all<any>(env, `
    SELECT u.id, u.unit_number, u.readiness, u.bedrooms, u.max_guests, p.id AS property_id, p.name AS property_name,
           k.title AS block_title, k.id IS NOT NULL AS blocked,
           (SELECT m.title FROM maintenance_issues m WHERE m.unit_id = u.id AND m.state != 'resolved' AND m.blocks_unit = 1 ORDER BY m.reported_at DESC LIMIT 1) AS repair_title,
           l.check_out_time AS leaves_at, l.out AS guest_out, l.id IS NOT NULL AS leaving,
           (SELECT t.state FROM tasks t WHERE t.unit_id = u.id AND t.kind IN ${CLEAN_KINDS_SQL} AND ${when} = ? ORDER BY t.created_at DESC LIMIT 1) AS clean_state,
           (SELECT MIN(n.check_in) FROM reservations n WHERE n.unit_id = u.id AND ${LIVE_STAY_SQL('n')} AND n.check_in > ?) AS next_check_in
    FROM units u JOIN properties p ON p.id = u.property_id
    LEFT JOIN LATERAL (
      SELECT b.id, COALESCE(m.title, b.notes) AS title FROM reservations b LEFT JOIN maintenance_issues m ON m.id = b.maintenance_issue_id
      WHERE b.unit_id = u.id AND b.channel = 'maintenance_block' AND b.state NOT IN ('cancelled','no_show') AND b.check_in <= ? AND b.check_out > ?
      LIMIT 1
    ) k ON TRUE
    LEFT JOIN LATERAL (
      SELECT r.id, r.check_out_time, (r.state = 'checked_out' OR EXISTS (SELECT 1 FROM tasks t WHERE t.reservation_id = r.id AND t.guest_left_at IS NOT NULL)) AS out
      FROM reservations r WHERE r.unit_id = u.id AND r.check_out = ? AND ${LIVE_STAY_SQL('r')} LIMIT 1
    ) l ON TRUE
    WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.unit_id = u.id AND ${LIVE_STAY_SQL('r')} AND r.state != 'checked_out'
                      AND r.check_in <= ? AND r.check_out > ?)
    ORDER BY p.name, u.unit_number`, date, date, date, date, date, date, date);
  return rows.map(u => {
    let status: 'ready' | 'needs_cleaning' | 'cleaning' | 'blocked';
    let note: string | null = null;
    if (u.blocked || u.readiness === 'maintenance' || u.readiness === 'blocked') { status = 'blocked'; note = u.block_title ?? u.repair_title ?? null; }
    else if (u.clean_state === 'resolved') status = 'ready';
    else if (u.clean_state === 'in_progress' || (date === today && u.readiness === 'cleaning')) status = 'cleaning';
    else if (u.leaving) { status = 'needs_cleaning'; note = u.guest_out ? 'Guest out' : `Guest leaves ${u.leaves_at || '11:00'}`; }
    else if (['dirty', 'inspection', 'occupied', 'cleaning'].includes(u.readiness)) status = 'needs_cleaning';
    else status = 'ready';
    return {
      unitId: u.id, unitNumber: u.unit_number, buildingId: u.property_id, propertyName: u.property_name,
      bedrooms: Number(u.bedrooms ?? 0), maxGuests: Number(u.max_guests ?? 0), status, note, nextCheckIn: u.next_check_in ?? null,
    };
  });
}
