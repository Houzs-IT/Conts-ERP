import { type Env, all, json, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MYT_DATE } from '../../_lib/ops';
import { unitLayoutSql, unitLayout } from '../../_lib/unitLayout';
import { taskCleanersReady, mineSql, mineArgs, cleanerListSql, parseCleaners } from '../../_lib/taskCleaners';
import { LIVE_STAY_SQL, mytToday, isDay, standardItems, autoGuestLeft } from '../../_lib/cleaning';
import { hasCleanPrices } from '../../_lib/cleaningPrices';

/** GET /api/field/tasks?date=today — the signed-in person's own jobs for the day (plus, for today, anything left over from earlier),
 *  with the guest leaving and the guest arriving on each unit, so a cleaner on the phone sees what the office sees.
 *  Never carries revenue, fees or payout figures. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const today = mytToday();
  const asked = new URL(request.url).searchParams.get('date');
  const date = isDay(asked) ? asked : today;
  // Unfinished jobs from earlier days show on today only, so Tomorrow lists tomorrow's own jobs.
  const carry = date === today;
  const when = MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)');
  const ready = await taskCleanersReady(env);
  const layoutSql = await unitLayoutSql(env);
  const ext = (await hasCleanPrices(env)) ? 't.external_address, t.external_client, t.external_phone' : 'NULL::text AS external_address, NULL::text AS external_client, NULL::text AS external_phone';

  const rows = await all<any>(env, `
    SELECT t.id, t.unit_id, t.kind, t.title, t.instructions, t.state, t.due_at, t.scheduled_for, t.next_guest_at, t.requires_photo, t.sync, t.updated_at,
           t.started_at, t.completed_at, t.guest_left_at, ${ext}, ${when} AS day, ${cleanerListSql(ready)} AS cleaner_list,
           u.unit_number, u.readiness, u.bedrooms, u.bathrooms, ${layoutSql} AS layout_type, p.id AS property_id, p.name AS property_name, p.address_line,
           (SELECT c.instruction FROM access_credentials c WHERE c.unit_id = u.id ORDER BY c.updated_at DESC LIMIT 1) AS access_instruction,
           (SELECT COUNT(*) FROM documents d WHERE d.task_id = t.id AND d.kind IN ('photo','video')) AS photo_count,
           (SELECT COUNT(*)::int FROM task_checklist_items c WHERE c.task_id = t.id AND c.done_at IS NOT NULL) AS ticks,
           (SELECT COUNT(*)::int FROM task_checklist_items c WHERE c.task_id = t.id AND c.item_key LIKE 'c-%') AS custom_items,
           prev.id AS prev_id, prev.state AS prev_state, prev.check_out_time AS prev_time, COALESCE(NULLIF(pg.full_name, ''), CASE WHEN prev.id IS NOT NULL THEN 'Guest' END) AS prev_guest,
           nxt.check_in_time AS next_time, COALESCE(NULLIF(ng.full_name, ''), CASE WHEN nxt.id IS NOT NULL THEN 'Guest' END) AS next_guest
    FROM tasks t LEFT JOIN units u ON u.id = t.unit_id LEFT JOIN properties p ON p.id = u.property_id
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
    WHERE ${mineSql(ready)}
      AND (${when} = ?${carry ? ` OR (t.state != 'resolved' AND ${when} < ?)` : ''})
    ORDER BY p.name NULLS LAST, u.unit_number`, ...mineArgs(ready, session.userId), date, ...(carry ? [date] : []));
  const defaultOut = (await all<{ value: string }>(env, `SELECT value FROM settings WHERE key IN ('operations.checkOut','ops.check_out') ORDER BY key = 'operations.checkOut' DESC LIMIT 1`))[0]?.value ?? '11:00';
  await autoGuestLeft(env, rows, defaultOut);

  return json({
    generatedAt: nowIso(), date,
    rows: rows.map(r => {
      const sameDay = r.next_guest_at && r.due_at && r.next_guest_at.slice(0, 10) === r.due_at.slice(0, 10);
      const guestOut = !!r.guest_left_at || r.prev_state === 'checked_out';
      return {
        id: r.id, unitId: r.unit_id, kind: r.kind, state: r.state,
        // An external clean has an address and maybe a client instead of a unit (owner, 17 Oct 2026).
        unit: r.unit_id ? { unitNumber: r.unit_number, propertyName: r.property_name, size: unitLayout(r).size, layout: unitLayout(r).layout }
          : { unitNumber: r.external_address, propertyName: 'External', size: null, layout: null },
        buildingId: r.property_id ?? 'external',
        external: r.unit_id ? null : { address: r.external_address, clientName: r.external_client ?? null, clientPhone: r.external_phone ?? null },
        addressLine: String(r.unit_id ? r.address_line ?? '' : r.external_address ?? '').replace(/[\s,]+$/, ''), accessInstruction: r.access_instruction ?? null,
        work: r.title, instructions: r.instructions ?? null, day: r.day, dueAt: r.due_at, nextGuestAt: r.next_guest_at, startedAt: r.started_at ?? null, completedAt: r.completed_at ?? null,
        // Who else is on the job with this cleaner (owner, 11 Oct 2026: several cleaners per clean).
        team: parseCleaners(r.cleaner_list).filter(c => c.userId !== session.userId).map(c => c.name),
        readiness: r.readiness, done: r.state === 'resolved', flag: sameDay ? 'Same-day turnaround' : null,
        requiresPhoto: !!r.requires_photo, photoCount: Number(r.photo_count),
        checklist: { done: Number(r.ticks), total: standardItems(r.kind).length + Number(r.custom_items) },
        guestOut, guestLeftAuto: !!r.guest_left_auto || (!!r.guest_left_at && r.guest_left_at === `${r.day}T${r.prev_time || defaultOut}:00+08:00`), previous: r.prev_guest ? { guestName: r.prev_guest, checkOutTime: r.prev_time || '11:00', state: r.prev_state } : null,
        next: r.next_guest ? { guestName: r.next_guest, checkInTime: r.next_time || '15:00', checkInAt: `${r.day}T${r.next_time || '15:00'}:00+08:00` } : null,
        sync: r.state === 'resolved' ? 'synced' : r.sync === 'synced' ? null : r.sync,
        syncedAt: r.state === 'resolved' ? r.updated_at : null,
      };
    }),
  });
};
