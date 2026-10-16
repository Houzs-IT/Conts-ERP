import { type Env, all, one, json, fail, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { MYT_DATE, SHEET_CLEANER } from '../../_lib/ops';
import { taskCleanersReady, cleanerListSql, parseCleaners } from '../../_lib/taskCleaners';
import { unitLayoutSql, unitLayout } from '../../_lib/unitLayout';
import { CLEAN_KINDS_SQL, LIVE_STAY_SQL, standardItems, windowsOnDay, mytToday, isDay } from '../../_lib/cleaning';

/** GET /api/housekeeping/board?date=YYYY-MM-DD — the Cleaning screen for one day, one row per clean.
 *  Each row carries the guest leaving (check-out time, name, whether they have left) and the guest arriving
 *  (check-in time, name), from the bookings: a late check-out or early check-in on the booking replaces the
 *  default times. Today also shows cleans left over from earlier days. `departures` are guests leaving that
 *  day with no clean planned yet; `repairs` are repair windows on that day. Grouping by building is the
 *  screen's job: every row carries its building. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Use your own job list.', 403);

  const today = mytToday();
  const asked = new URL(request.url).searchParams.get('date');
  const date = isDay(asked) ? asked : today;
  const when = MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)');

  const defaults = await all<{ key: string; value: string }>(env, `SELECT key, value FROM settings WHERE key IN ('operations.checkIn','operations.checkOut','ops.check_in','ops.check_out')`);
  const pick = (a: string, b: string, d: string) => defaults.find(x => x.key === a)?.value ?? defaults.find(x => x.key === b)?.value ?? d;
  const stdIn = pick('operations.checkIn', 'ops.check_in', '15:00');
  const stdOut = pick('operations.checkOut', 'ops.check_out', '11:00');

  const ready = await taskCleanersReady(env);
  const layoutSql = await unitLayoutSql(env);
  const rows = await all<any>(env, `
    SELECT t.id, t.kind, t.state, t.title, t.instructions, t.scheduled_for, t.due_at, t.started_at, t.completed_at, t.guest_left_at,
           t.assignee_id, t.cleaner_id, t.unit_id, t.reservation_id, ${when} AS day,
           u.unit_number, u.readiness, u.bedrooms, u.bathrooms, ${layoutSql} AS layout_type, p.id AS property_id, p.name AS property_name,
           COALESCE(cl.full_name, a.full_name) AS assignee_name, ${SHEET_CLEANER('t')} AS sheet_cleaner, ${cleanerListSql(ready)} AS cleaner_list,
           prev.id AS prev_id, prev.state AS prev_state, prev.check_out_time AS prev_time, prev.channel AS prev_channel,
           COALESCE(NULLIF(pg.full_name, ''), CASE WHEN prev.id IS NOT NULL THEN 'Guest' END) AS prev_guest,
           (SELECT l.occurred_at FROM audit_log l WHERE prev.state = 'checked_out' AND l.entity_table = 'reservations' AND l.entity_id = prev.id
              AND l.action = 'reservation.status' AND l.after_state LIKE '%"checked_out"%' ORDER BY l.occurred_at DESC LIMIT 1) AS prev_out_at,
           nxt.id AS next_id, nxt.check_in_time AS next_time, nxt.guests_count AS next_guests, nxt.channel AS next_channel,
           COALESCE(NULLIF(ng.full_name, ''), CASE WHEN nxt.id IS NOT NULL THEN 'Guest' END) AS next_guest,
           (SELECT COUNT(*)::int FROM documents d WHERE d.task_id = t.id AND d.kind = 'photo') AS photos,
           (SELECT COUNT(*)::int FROM documents d WHERE d.task_id = t.id AND d.kind = 'video') AS videos,
           (SELECT COUNT(*)::int FROM task_checklist_items c WHERE c.task_id = t.id AND c.done_at IS NOT NULL) AS ticks,
           (SELECT COUNT(*)::int FROM task_checklist_items c WHERE c.task_id = t.id AND c.item_key LIKE 'c-%') AS custom_items
    FROM tasks t
    JOIN units u ON u.id = t.unit_id
    JOIN properties p ON p.id = u.property_id
    LEFT JOIN users a ON a.id = t.assignee_id
    LEFT JOIN cleaners cl ON cl.id = t.cleaner_id
    LEFT JOIN LATERAL (
      SELECT r.* FROM reservations r
      WHERE (r.id = t.reservation_id) OR (t.reservation_id IS NULL AND r.unit_id = t.unit_id AND r.check_out = ${when} AND ${LIVE_STAY_SQL('r')})
      ORDER BY (r.id = t.reservation_id) DESC LIMIT 1
    ) prev ON TRUE
    LEFT JOIN guests pg ON pg.id = prev.guest_id
    LEFT JOIN LATERAL (
      SELECT r.* FROM reservations r
      WHERE r.unit_id = t.unit_id AND r.check_in = ${when} AND ${LIVE_STAY_SQL('r')} AND r.state != 'checked_out' AND r.id IS DISTINCT FROM prev.id
      ORDER BY r.check_in_time LIMIT 1
    ) nxt ON TRUE
    LEFT JOIN guests ng ON ng.id = nxt.guest_id
    WHERE t.kind IN ${CLEAN_KINDS_SQL}
      AND (${when} = ? OR (? = ? AND ${when} < ? AND t.state != 'resolved'))
    ORDER BY p.name, u.unit_number`, date, date, today, date);

  // Guests leaving that day with no clean on the unit: the gap the board must not hide.
  const departures = await all<any>(env, `
    SELECT r.id, r.state, r.check_out_time, r.channel, u.id AS unit_id, u.unit_number, u.bedrooms, u.bathrooms, ${layoutSql} AS layout_type, p.id AS property_id, p.name AS property_name,
           COALESCE(NULLIF(g.full_name, ''), 'Guest') AS guest_name,
           (SELECT n.check_in_time FROM reservations n WHERE n.unit_id = r.unit_id AND n.check_in = r.check_out AND n.id != r.id AND ${LIVE_STAY_SQL('n')} LIMIT 1) AS next_time,
           (SELECT COALESCE(NULLIF(ng.full_name, ''), 'Guest') FROM reservations n LEFT JOIN guests ng ON ng.id = n.guest_id
              WHERE n.unit_id = r.unit_id AND n.check_in = r.check_out AND n.id != r.id AND ${LIVE_STAY_SQL('n')} LIMIT 1) AS next_guest
    FROM reservations r JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.check_out = ? AND ${LIVE_STAY_SQL('r')} AND r.channel != 'owner_stay'
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.kind IN ${CLEAN_KINDS_SQL} AND (t.reservation_id = r.id OR (t.unit_id = r.unit_id AND ${when} = r.check_out)))
    ORDER BY p.name, u.unit_number`, date);

  const repairs = await windowsOnDay(env, date);
  const prices = await one<{ std: string | null; deep: string | null }>(env, `
    SELECT (SELECT value FROM settings WHERE key = 'operations.cleaningPriceStandard') AS std, (SELECT value FROM settings WHERE key = 'operations.cleaningPriceDeep') AS deep`);

  const at = (day: string, hm: string | null, d: string) => `${day}T${hm && /^\d{2}:\d{2}$/.test(hm) ? hm : d}:00+08:00`;
  return json({
    generatedAt: nowIso(), date, today, defaults: { checkIn: stdIn, checkOut: stdOut },
    defaultPrices: { standard: Number(prices?.std ?? 8000), deep: Number(prices?.deep ?? 13800) },
    rows: rows.map(r => {
      // The guest is out when the booking is Checked out or someone pressed "Guest left" on the clean.
      const leftAt: string | null = r.guest_left_at ?? r.prev_out_at ?? (r.prev_state === 'checked_out' ? r.day + 'T' + (r.prev_time || stdOut) + ':00+08:00' : null);
      const guestOut = !!r.guest_left_at || r.prev_state === 'checked_out';
      const status = r.state === 'resolved' ? 'done'
        : r.state === 'in_progress' ? 'cleaning'
        : guestOut ? 'ready'
        : r.prev_id && r.prev_state === 'checked_in' ? 'guest_in'
        : !r.cleaner_id && !r.assignee_id && !r.sheet_cleaner ? 'unassigned'
        : 'waiting';
      return {
        id: r.id, kind: r.kind, state: r.state, status, title: r.title, instructions: r.instructions ?? null,
        day: r.day, carriedOver: r.day < date,
        unitId: r.unit_id, unitNumber: r.unit_number, readiness: r.readiness, buildingId: r.property_id, propertyName: r.property_name,
        assigneeId: r.assignee_id, cleanerId: r.cleaner_id ?? null,
        cleaners: parseCleaners(r.cleaner_list, { cleanerId: r.cleaner_id ?? null, userId: r.assignee_id ?? null, name: r.assignee_name ?? null }),
        assigneeName: parseCleaners(r.cleaner_list).map(c => c.name).join(', ') || r.assignee_name || r.sheet_cleaner || null,
        unit: unitLayout(r),
        previous: r.prev_id ? {
          reservationId: r.prev_id, guestName: r.prev_guest, state: r.prev_state, channel: r.prev_channel,
          checkOutTime: r.prev_time || stdOut, lateCheckOut: !!r.prev_time && r.prev_time > stdOut,
        } : null,
        next: r.next_id ? {
          reservationId: r.next_id, guestName: r.next_guest, guests: Number(r.next_guests ?? 0), channel: r.next_channel,
          checkInTime: r.next_time || stdIn, earlyCheckIn: !!r.next_time && r.next_time < stdIn,
          checkInAt: at(r.day, r.next_time, stdIn),
        } : null,
        guestOut, guestLeftAt: leftAt,
        startedAt: r.started_at ?? null, completedAt: r.completed_at ?? null,
        photoCount: Number(r.photos), videoCount: Number(r.videos),
        checklist: { done: Number(r.ticks), total: standardItems(r.kind).length + Number(r.custom_items) },
      };
    }),
    departures: departures.map(d => ({
      reservationId: d.id, state: d.state, channel: d.channel, guestName: d.guest_name,
      checkOutTime: d.check_out_time || stdOut, lateCheckOut: !!d.check_out_time && d.check_out_time > stdOut,
      unitId: d.unit_id, unitNumber: d.unit_number, buildingId: d.property_id, propertyName: d.property_name, unit: unitLayout(d),
      next: d.next_time ? { guestName: d.next_guest, checkInTime: d.next_time, checkInAt: at(date, d.next_time, stdIn), earlyCheckIn: d.next_time < stdIn } : null,
    })),
    repairs,
  });
};
