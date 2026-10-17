import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { MYT_DATE, SHEET_CLEANER, hhmm, linenSet, resolveUnit, rosterByIds, pickedCleanerIds } from '../../_lib/ops';
import { checkDate, invalid, type Fields } from '../../_lib/validate';
import { cleaningNotice } from '../../_lib/notices';
import { hasCleanPrices, cleanAmounts } from '../../_lib/cleaningPrices';
import { taskCleanersReady, mineSql, mineArgs, cleanerListSql, parseCleaners, writeTaskCleaners, rosterIdSql } from '../../_lib/taskCleaners';

/** The three cleaning kinds a manual task may be. Inspection/maintenance/delivery
 *  are their own screens; this endpoint only creates cleaning work. */
const CLEAN_KINDS = ['turnover', 'deep_clean', 'light_clean'] as const;
type CleanKind = (typeof CLEAN_KINDS)[number];
const KIND_TITLE: Record<CleanKind, string> = {
  turnover: 'Standard clean', deep_clean: 'Deep clean', light_clean: 'Light clean',
};
const isHhmm = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** GET /api/housekeeping/tasks?date=YYYY-MM-DD | from..to (at most 7 days) — the cleaning roster.
 *  When the range starts today, cleaning left over from earlier days is included until it is done.
 *  `checkouts` lists the stays leaving in the range that have no cleaning task yet. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const today = (await one<{ d: string }>(env, `SELECT to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS d`))!.d;
  const raw = new URL(request.url).searchParams.get('date') ?? today;
  let [from, to = from] = raw.split('..');
  if (!isDate(from)) from = today;
  if (!isDate(to) || to < from) to = from;
  const maxTo = new Date(Date.parse(`${from}T00:00:00Z`) + 6 * 864e5).toISOString().slice(0, 10);
  if (to > maxTo) to = maxTo;

  const mine = isFieldRole(session.role);
  const ready = await taskCleanersReady(env);
  const when = MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)');
  const rows = await all<any>(env, `
    SELECT t.id, t.kind, t.state, t.title, t.instructions, t.scheduled_for, t.due_at, t.next_guest_at, t.requires_photo, t.assignee_id, t.cleaner_id,
           t.started_at, t.completed_at, ${when} AS day,
           u.unit_number, u.readiness, u.bedrooms, p.id AS property_id, p.name AS property_name,
           COALESCE(cl.full_name, a.full_name, '') AS assignee_name, ${SHEET_CLEANER('t')} AS sheet_cleaner,
           cl.employment_type AS employment_type, ${cleanerListSql(ready)} AS cleaner_list, ${rosterIdSql()} AS roster_id,
           COALESCE(r.external_ref, 'Manual') AS source_ref,
           r.check_out AS checkout_date, r.check_out_time AS checkout_time,
           (SELECT COUNT(*) FROM documents d WHERE d.task_id = t.id AND d.kind = 'photo') AS photo_count
    FROM tasks t
    JOIN units u ON u.id = t.unit_id
    JOIN properties p ON p.id = u.property_id
    LEFT JOIN users a ON a.id = t.assignee_id
    LEFT JOIN cleaners cl ON cl.id = t.cleaner_id
    LEFT JOIN reservations r ON r.id = t.reservation_id
    WHERE t.kind IN ('turnover','deep_clean','light_clean')
      AND ((${when} BETWEEN ? AND ?) OR (? = ? AND ${when} < ? AND t.state != 'resolved'))
      ${mine ? `AND ${mineSql(ready)}` : ''}
    ORDER BY COALESCE(t.scheduled_for, t.due_at, t.created_at)`,
    ...[from, to, from, today, from, ...(mine ? mineArgs(ready, session.userId) : [])]);

  // Stays leaving in the range with no clean on that unit that day. Cancelled stays and
  // maintenance blocks leave no guest mess behind.
  const lo = new Date(Date.parse(`${from}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
  const hi = new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 864e5).toISOString().slice(0, 10);
  const checkouts = mine ? [] : await all<any>(env, `
    WITH cleans AS (
      SELECT t.unit_id, ${when} AS day FROM tasks t
      WHERE t.kind IN ('turnover','deep_clean','light_clean') AND COALESCE(t.scheduled_for, t.due_at, t.created_at) >= ? AND COALESCE(t.scheduled_for, t.due_at, t.created_at) < ?
    )
    SELECT r.id, r.external_ref, r.channel, r.check_out, r.check_out_time, u.id AS unit_id, u.unit_number, u.bedrooms,
           p.id AS property_id, p.name AS property_name, COALESCE(NULLIF(g.full_name, ''), 'Guest') AS guest_name,
           (SELECT n.check_in_time FROM reservations n WHERE n.unit_id = r.unit_id AND n.check_in = r.check_out AND n.id != r.id
              AND n.state NOT IN ('cancelled','no_show','inquiry') AND n.channel != 'maintenance_block' LIMIT 1) AS next_in
    FROM reservations r
    JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id
    LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.check_out BETWEEN ? AND ? AND r.state NOT IN ('cancelled','no_show','inquiry') AND r.channel != 'maintenance_block'
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.reservation_id = r.id AND t.kind IN ('turnover','deep_clean','light_clean'))
      AND NOT EXISTS (SELECT 1 FROM cleans c WHERE c.unit_id = r.unit_id AND c.day = r.check_out)
    ORDER BY r.check_out, p.name, u.unit_number`, lo, hi, from, to);

  return json({
    generatedAt: nowIso(), date: from, from, to, today,
    rows: rows.map((r, i) => ({
      id: r.id, kind: r.kind, unitNumber: r.unit_number, propertyName: r.property_name, buildingId: r.property_id, sourceRef: r.source_ref,
      title: r.title, linenSet: linenSet(Number(r.bedrooms)), instructions: r.instructions,
      day: r.day, carriedOver: r.day < from,
      scheduledFor: hhmm(r.scheduled_for), dueAt: hhmm(r.due_at), nextGuestAt: hhmm(r.next_guest_at),
      // This stay's checkout (source reservation) and the incoming guest's check-in bracket the SLA.
      checkoutTime: r.checkout_time ?? null, checkoutDate: r.checkout_date ?? null,
      // Full ISO start/end so the client can show how long the clean took.
      startedAt: r.started_at ?? null, completedAt: r.completed_at ?? null,
      assigneeId: r.assignee_id, cleanerId: r.cleaner_id ?? null,
      cleaners: parseCleaners(r.cleaner_list, { cleanerId: r.roster_id ?? null, userId: r.assignee_id ?? null, name: r.assignee_name || null }),
      assigneeName: parseCleaners(r.cleaner_list).map(c => c.name).join(', ') || r.assignee_name || null,
      sheetCleaner: r.sheet_cleaner ?? null,
      employmentType: r.employment_type ?? null,
      sequence: i + 1, state: r.state, readiness: r.readiness,
      requiresPhoto: !!r.requires_photo, photoCount: Number(r.photo_count),
    })),
    checkouts: checkouts.map(c => ({
      reservationId: c.id, ref: c.external_ref ?? null, channel: c.channel, date: c.check_out, checkoutTime: c.check_out_time ?? null,
      unitId: c.unit_id, unitNumber: c.unit_number, propertyName: c.property_name, buildingId: c.property_id,
      guestName: c.guest_name, nextGuestAt: c.next_in ?? null, linenSet: linenSet(Number(c.bedrooms)),
    })),
  });
};

/** POST /api/housekeeping/tasks — create a cleaning task by hand, on one of our units ({ unitId }) or at an outside
 *  address ({ external: { address, clientName?, clientPhone? }, amount } — amount in sen, required). On a unit the
 *  amount defaults to the price table's and may be typed.
 *  The auto path (one clean per checkout) is the cron worker; this is the manual
 *  equivalent for ad-hoc turnovers, deep cleans and post-works refreshes. The
 *  task carries no reservation, so the roster shows its source as "Manual". */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaners and technicians cannot add cleaning jobs.', 403);

  const b = await request.json<any>().catch(() => null);

  const kind: CleanKind = CLEAN_KINDS.includes(b?.kind) ? b.kind : 'turnover';
  // External: a clean at an address that is not one of our units (owner, 17 Oct 2026). It needs an address and an amount,
  // has no unit, and so never reaches a unit's costs or an owner statement.
  const priced = await hasCleanPrices(env);
  const external = b?.external && typeof b.external === 'object' ? b.external : null;
  if (external && !priced) return fail('NOT_CONFIGURED', 'External cleaning jobs need a database update (migration 0126) that is not applied yet.', 501);
  const ext = external ? {
    address: typeof external.address === 'string' ? external.address.trim().slice(0, 300) : '',
    client: typeof external.clientName === 'string' && external.clientName.trim() ? external.clientName.trim().slice(0, 120) : null,
    phone: typeof external.clientPhone === 'string' && external.clientPhone.trim() ? external.clientPhone.trim().slice(0, 40) : null,
  } : null;
  if (ext && !ext.address) return fail('VALIDATION', 'Enter the address of the external job.', 422, { address: 'Enter the address.' });
  if (b?.amount != null && (!Number.isInteger(b.amount) || b.amount < 0)) return fail('VALIDATION', 'Enter the amount, RM 0.00 or more.', 422, { amount: 'Enter the amount.' });
  if (ext && b?.amount == null) return fail('VALIDATION', 'An external job needs its amount.', 422, { amount: 'Enter the amount.' });
  if (b?.amount != null && !priced) return fail('NOT_CONFIGURED', 'Cleaning amounts need a database update (migration 0126) that is not applied yet.', 501);
  const unit = ext ? null : await resolveUnit(env, b?.unitId ?? b?.unitNumber, b?.propertyName);
  if (unit === 'ambiguous') return fail('VALIDATION', 'More than one unit has that number. Say which building.', 422, { unitNumber: 'Pick the building too.' });
  if (!ext && !unit) return fail('NOT_FOUND', 'That unit does not exist.', 404, { unitNumber: 'Pick a unit that exists.' });
  // A unit's clean takes the price table's figures unless the office typed its own amount.
  const prices = unit && priced ? await cleanAmounts(env, unit.id, kind) : null;
  const amount: number | null = b?.amount ?? prices?.external ?? null;
  const cleanerPay: number | null = ext ? null : prices?.internal ?? null;
  const fields: Fields = {};
  checkDate(fields, 'date', b?.date, { label: 'Day' });
  const bad = invalid(fields); if (bad) return bad;

  // A manual task lands on a day (default today, Malaysia) with an optional window.
  const today = (await one<{ d: string }>(env, `SELECT to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS d`))!.d;
  const day = isDate(b?.date) ? b.date : today;
  const at = (hm: string) => `${day}T${hm}:00+08:00`;

  if (b?.scheduledFor != null && !isHhmm(b.scheduledFor)) return fail('VALIDATION', 'Enter the window start as HH:MM.', 422, { scheduledFor: 'Use HH:MM.' });
  if (b?.dueAt != null && !isHhmm(b.dueAt)) return fail('VALIDATION', 'Enter the window end as HH:MM.', 422, { dueAt: 'Use HH:MM.' });
  if (isHhmm(b?.scheduledFor) && isHhmm(b?.dueAt) && b.dueAt <= b.scheduledFor) return fail('VALIDATION', 'The end must be after the start.', 422, { dueAt: 'Pick a later end time.' });
  if (b?.nextGuestAt != null && !isHhmm(b.nextGuestAt)) return fail('VALIDATION', 'Enter the next-guest time as HH:MM.', 422, { nextGuestAt: 'Use HH:MM.' });

  // Assignment: prefer a roster cleanerId; assignee_id is set to the cleaner's login
  // (internal staff) and left null for an outsourced crew. assigneeId stays accepted
  // as the legacy users-based path.
  // Several cleaners: cleanerIds (in order; the first is the job's main cleaner). cleanerId alone still works.
  let assigneeId: string | null = null;
  let cleanerId: string | null = null;
  const pickedIds = pickedCleanerIds(b);
  const roster = await rosterByIds(env, pickedIds);
  if (!roster) return fail('NOT_FOUND', 'That cleaner is not on the active roster.', 404, { cleanerId: 'Pick a cleaner from the roster.' });
  const team: { cleanerId: string | null; userId: string | null }[] = roster.map(c => ({ cleanerId: c.id, userId: c.user_id }));
  if (team.length) { cleanerId = team[0].cleanerId; assigneeId = team[0].userId; }
  else if (typeof b?.assigneeId === 'string' && b.assigneeId.trim()) {
    const person = await one<{ id: string }>(env, 'SELECT id FROM users WHERE id = ? AND is_active = 1', b.assigneeId.trim());
    if (!person) return fail('NOT_FOUND', 'That person is no longer active.', 404, { assigneeId: 'Pick an active cleaner.' });
    assigneeId = person.id;
    team.push({ cleanerId: null, userId: person.id });
  }

  const title = (typeof b?.title === 'string' && b.title.trim()) ? b.title.trim().slice(0, 120) : KIND_TITLE[kind];
  const instructions = (typeof b?.instructions === 'string' && b.instructions.trim()) ? b.instructions.trim().slice(0, 1000) : null;
  const requiresPhoto = b?.requiresPhoto === false ? 0 : 1;
  const id = crypto.randomUUID(), now = nowIso();

  await run(env, `
    INSERT INTO tasks
      (id, unit_id, reservation_id, kind, state, title, instructions, assignee_id, cleaner_id,
       scheduled_for, due_at, next_guest_at, requires_photo, created_at, updated_at${priced ? ', amount, cleaner_pay, external_address, external_client, external_phone' : ''})
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${priced ? ', ?, ?, ?, ?, ?' : ''})`,
    id, unit ? unit.id : null, kind, cleanerId ? 'assigned' : 'open', title, instructions, assigneeId, cleanerId,
    isHhmm(b?.scheduledFor) ? at(b.scheduledFor) : null,
    isHhmm(b?.dueAt) ? at(b.dueAt) : null,
    isHhmm(b?.nextGuestAt) ? at(b.nextGuestAt) : null,
    requiresPhoto, now, now, ...(priced ? [amount, cleanerPay, ext?.address ?? null, ext?.client ?? null, ext?.phone ?? null] : []));
  if (team.length) await writeTaskCleaners(env, id, team, session.userId);

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'housekeeping.create',
    entityTable: 'tasks', entityId: id, after: { unitId: unit ? unit.id : null, external: ext, amount, kind, title, assigneeId, cleanerId, ...(team.length > 1 ? { cleanerIds: team.map(t => t.cleanerId) } : {}) }, source: b?.source ?? 'web',
  });
  if (team.some(t => t.userId)) await cleaningNotice(env, id, 'assigned', session.userId);
  return json({ id }, 201);
};
