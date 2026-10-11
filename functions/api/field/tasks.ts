import { type Env, all, json, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MYT_DATE, ON_TASK_SQL } from '../../_lib/ops';
import { LIVE_STAY_SQL, mytToday, isDay, standardItems } from '../../_lib/cleaning';

/** GET /api/field/tasks?date=today — the signed-in person's own jobs for the day (plus anything left over from earlier),
 *  with the guest leaving and the guest arriving on each unit, so a cleaner on the phone sees what the office sees.
 *  Never carries revenue, fees or payout figures. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const today = mytToday();
  const asked = new URL(request.url).searchParams.get('date');
  const date = isDay(asked) ? asked : today;
  const when = MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)');

  const rows = await all<any>(env, `
    SELECT t.id, t.unit_id, t.kind, t.title, t.state, t.due_at, t.scheduled_for, t.next_guest_at, t.requires_photo, t.sync, t.updated_at,
           t.started_at, t.completed_at, t.guest_left_at, ${when} AS day,
           u.unit_number, u.readiness, p.id AS property_id, p.name AS property_name, p.address_line,
           (SELECT c.instruction FROM access_credentials c WHERE c.unit_id = u.id ORDER BY c.updated_at DESC LIMIT 1) AS access_instruction,
           (SELECT COUNT(*) FROM documents d WHERE d.task_id = t.id AND d.kind IN ('photo','video')) AS photo_count,
           (SELECT COUNT(*)::int FROM task_checklist_items c WHERE c.task_id = t.id AND c.done_at IS NOT NULL) AS ticks,
           (SELECT COUNT(*)::int FROM task_checklist_items c WHERE c.task_id = t.id AND c.item_key LIKE 'c-%') AS custom_items,
           prev.state AS prev_state, prev.check_out_time AS prev_time, COALESCE(NULLIF(pg.full_name, ''), CASE WHEN prev.id IS NOT NULL THEN 'Guest' END) AS prev_guest,
           nxt.check_in_time AS next_time, COALESCE(NULLIF(ng.full_name, ''), CASE WHEN nxt.id IS NOT NULL THEN 'Guest' END) AS next_guest
    FROM tasks t JOIN units u ON u.id = t.unit_id JOIN properties p ON p.id = u.property_id
    LEFT JOIN LATERAL (
      SELECT r.* FROM reservations r
      WHERE (r.id = t.reservation_id) OR (t.reservation_id IS NULL AND r.unit_id = t.unit_id AND r.check_out = ${when} AND ${LIVE_STAY_SQL('r')})
      ORDER BY (r.id = t.reservation_id) DESC LIMIT 1
    ) prev ON TRUE
    LEFT JOIN guests pg ON pg.id = prev.guest_id
    LEFT JOIN LATERAL (
      SELECT r.* FROM reservations r WHERE r.unit_id = t.unit_id AND r.check_in = ${when} AND ${LIVE_STAY_SQL('r')} AND r.state != 'checked_out' AND r.id IS DISTINCT FROM prev.id
      ORDER BY r.check_in_time LIMIT 1
    ) nxt ON TRUE
    LEFT JOIN guests ng ON ng.id = nxt.guest_id
    WHERE ${ON_TASK_SQL('t')}
      AND (${when} = ? OR (t.state != 'resolved' AND ${when} < ?))
    ORDER BY p.name, u.unit_number`, session.userId, session.userId, date, date);

  return json({
    generatedAt: nowIso(), date,
    rows: rows.map(r => {
      const sameDay = r.next_guest_at && r.due_at && r.next_guest_at.slice(0, 10) === r.due_at.slice(0, 10);
      const guestOut = !!r.guest_left_at || r.prev_state === 'checked_out';
      return {
        id: r.id, unitId: r.unit_id, kind: r.kind, state: r.state,
        unit: { unitNumber: r.unit_number, propertyName: r.property_name }, buildingId: r.property_id,
        addressLine: String(r.address_line ?? '').replace(/[\s,]+$/, ''), accessInstruction: r.access_instruction ?? null,
        work: r.title, dueAt: r.due_at, nextGuestAt: r.next_guest_at, startedAt: r.started_at ?? null, completedAt: r.completed_at ?? null,
        readiness: r.readiness, done: r.state === 'resolved', flag: sameDay ? 'Same-day turnaround' : null,
        requiresPhoto: !!r.requires_photo, photoCount: Number(r.photo_count),
        checklist: { done: Number(r.ticks), total: standardItems(r.kind).length + Number(r.custom_items) },
        guestOut, previous: r.prev_guest ? { guestName: r.prev_guest, checkOutTime: r.prev_time || '11:00', state: r.prev_state } : null,
        next: r.next_guest ? { guestName: r.next_guest, checkInTime: r.next_time || '15:00', checkInAt: `${r.day}T${r.next_time || '15:00'}:00+08:00` } : null,
        sync: r.state === 'resolved' ? 'synced' : r.sync === 'synced' ? null : r.sync,
        syncedAt: r.state === 'resolved' ? r.updated_at : null,
      };
    }),
  });
};
