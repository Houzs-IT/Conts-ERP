import { type Env, all, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { parkingFor } from '../../../_lib/unitPurpose';
import { isOnTask, currentCleaners } from '../../../_lib/taskCleaners';
import { unitLayoutSql, unitLayout } from '../../../_lib/unitLayout';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { cleanPrice } from '../../../_lib/cleaning';
import { hasCleanPrices, cleanAmounts } from '../../../_lib/cleaningPrices';
import { mayEditCredentials } from '../../../_lib/credentials';

/** GET /api/housekeeping/tasks/:id — what the clean's detail panel needs in one answer: the proof
 *  photos and videos, the unit's access (masked; the code itself is a separate audited reveal, for the roles that
 *  may see it), what the clean costs the unit and whether it has been charged, and the damage reported from it. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const layoutSql = await unitLayoutSql(env);
  const priced = await hasCleanPrices(env);
  const t = await one<any>(env, `
    SELECT ${priced ? 't.amount, t.cleaner_pay, t.external_address, t.external_client, t.external_phone,' : ''} t.id, t.kind, t.state, t.unit_id, t.assignee_id, u.bedrooms, u.bathrooms, ${layoutSql} AS layout_type, t.instructions, t.started_at, t.completed_at, t.guest_left_at,
           t.created_at, t.reservation_id, cb.full_name AS completed_by_name,
           COALESCE(t.scheduled_for, t.due_at, t.created_at) AS day_at, u.unit_number, p.name AS property_name
    FROM tasks t LEFT JOIN units u ON u.id = t.unit_id LEFT JOIN properties p ON p.id = u.property_id
    LEFT JOIN users cb ON cb.id = t.completed_by WHERE t.id = ?`, id);
  if (!t) return fail('NOT_FOUND', 'That cleaning job no longer exists. Refresh the list.', 404);
  const field = isFieldRole(session.role);
  if (field && !(await isOnTask(env, t.id, session.userId))) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);

  const media = await all<any>(env, `
    SELECT d.id, d.kind, d.file_name, d.mime_type, d.byte_size, d.created_at, u.full_name AS uploader
    FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
    WHERE d.task_id = ? AND d.kind IN ('photo','video') ORDER BY d.created_at`, id);
  const creds = await all<any>(env, `SELECT id, kind, label, instruction, secret FROM access_credentials WHERE unit_id = ? ORDER BY label`, t.unit_id);
  const charged = await one<{ amount: number }>(env, `SELECT amount FROM expenses WHERE task_id = ? LIMIT 1`, id);
  // The job's own amount, else the price table's, else (price not set) the old pricing. An external job has only its own.
  const table = t.unit_id && priced ? await cleanAmounts(env, t.unit_id, t.kind, t.day_at) : null;
  const own = t.amount ?? table?.external ?? null;
  const price = own != null ? { amount: Number(own), source: t.amount != null ? 'job' : table?.source ?? 'table' }
    : t.unit_id ? await cleanPrice(env, t.unit_id, t.kind) : { amount: 0, source: 'job' };
  const damage = await all<any>(env, `SELECT id, title, state, reported_at FROM maintenance_issues WHERE source_task_id = ? ORDER BY reported_at`, id);
  const mask = (s: string | null) => (s ? '•'.repeat(Math.max(2, s.length - 2)) + s.slice(-2) : '');

  return json({
    id, kind: t.kind, state: t.state, unitId: t.unit_id, unitNumber: t.unit_number ?? t.external_address, propertyName: t.property_name ?? 'External',
    instructions: t.instructions ?? null, startedAt: t.started_at ?? null, completedAt: t.completed_at ?? null, guestLeftAt: t.guest_left_at ?? null,
    completedBy: t.completed_by_name ?? null, createdAt: t.created_at ?? null, reservationId: t.reservation_id ?? null,
    media: media.map(m => ({ id: m.id, kind: m.kind, url: `/api/documents/${m.id}/download`, fileName: m.file_name, mimeType: m.mime_type, byteSize: Number(m.byte_size), uploadedAt: m.created_at, uploader: m.uploader ?? null })),
    // Field staff get the instruction only, not even the masked tail (same rule as /api/access-credentials).
    access: creds.map(c => ({ id: c.id, kind: c.kind, label: c.label, instruction: c.instruction, masked: field ? '' : mask(c.secret), hasCode: !!c.secret })),
    mayReveal: mayEditCredentials(session),
    // The unit's car park bays (staff sheet UNIT, 17 Oct 2026), with the access details.
    parking: await parkingFor(env, t.unit_id),
    // Amounts are for the office only.
    cost: field ? null : { amount: charged ? Number(charged.amount) : price.amount, source: price.source, charged: !!charged,
      cleanerPay: t.cleaner_pay ?? table?.internal ?? null, priceSet: own != null },
    external: t.unit_id ? null : { address: t.external_address, clientName: t.external_client ?? null, clientPhone: field ? null : t.external_phone ?? null },
    damage: damage.map(d => ({ id: d.id, title: d.title, state: d.state, reportedAt: d.reported_at })),
    cleaners: await currentCleaners(env, id),
    unit: unitLayout(t),
    // The Malaysian day the clean is on, so a link to it (a notification) can open the right day of the board.
    day: t.day_at ? new Date(Date.parse(t.day_at) + 8 * 3600e3).toISOString().slice(0, 10) : null,
  });
};

const CLEAN_KINDS = ['turnover', 'deep_clean', 'light_clean'];

/** PATCH /api/housekeeping/tasks/:id — reschedule OR edit the task's own details.
 *  Reschedule: { scheduledFor, dueAt } (HH:MM, Malaysia, on the task's own day).
 *  Edit:       { title, instructions, kind, amount } — any subset (amount in sen, the office's own figure for this clean,
 *              until it is charged); blanks the instructions
 *              when an empty string is sent. The two shapes may be combined. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaners and technicians cannot change cleaning jobs.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const ok = (v: unknown) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

  const t = await one<{ day: string; scheduled_for: string | null; due_at: string | null; state: string; title: string; instructions: string | null; kind: string }>(env, `
    SELECT to_char((COALESCE(scheduled_for, due_at, created_at))::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS day, scheduled_for, due_at, state, title, instructions, kind
    FROM tasks WHERE id = ?`, id);
  if (!t) return fail('NOT_FOUND', 'That cleaning job no longer exists. Refresh the list.', 404);

  // Collect the column changes so a reschedule and an edit can land in one write.
  const sets: string[] = [];
  const args: unknown[] = [];
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  const wantsReschedule = b?.scheduledFor != null || b?.dueAt != null;
  if (wantsReschedule) {
    if (t.state === 'resolved') return fail('CONFLICT', 'A finished cleaning job cannot be moved.', 409);
    if (!ok(b?.scheduledFor) || !ok(b?.dueAt)) return fail('VALIDATION', 'Enter times as HH:MM.', 422);
    if (b.dueAt <= b.scheduledFor) return fail('VALIDATION', 'The end must be after the start.', 422, { dueAt: 'Pick a later end time.' });
    const at = (hm: string) => `${t.day}T${hm}:00+08:00`;
    sets.push('scheduled_for = ?', 'due_at = ?');
    args.push(at(b.scheduledFor), at(b.dueAt));
    before.scheduledFor = t.scheduled_for; before.dueAt = t.due_at;
    after.scheduledFor = at(b.scheduledFor); after.dueAt = at(b.dueAt);
  }

  if (typeof b?.title === 'string') {
    const title = b.title.trim();
    if (!title) return fail('VALIDATION', 'The title cannot be empty.', 422, { title: 'Give the cleaning job a title.' });
    sets.push('title = ?'); args.push(title.slice(0, 120));
    before.title = t.title; after.title = title.slice(0, 120);
  }
  if (typeof b?.instructions === 'string') {
    const instructions = b.instructions.trim() ? b.instructions.trim().slice(0, 1000) : null;
    sets.push('instructions = ?'); args.push(instructions);
    before.instructions = t.instructions; after.instructions = instructions;
  }
  if (typeof b?.kind === 'string') {
    if (!CLEAN_KINDS.includes(b.kind)) return fail('VALIDATION', 'Pick a cleaning kind.', 422, { kind: 'Standard, deep or light clean.' });
    sets.push('kind = ?'); args.push(b.kind);
    before.kind = t.kind; after.kind = b.kind;
  }

  if (b?.amount !== undefined) {
    if (!(await hasCleanPrices(env))) return fail('NOT_CONFIGURED', 'Cleaning amounts need a database update (migration 0126) that is not applied yet.', 501);
    if (b.amount !== null && (!Number.isInteger(b.amount) || b.amount < 0)) return fail('VALIDATION', 'Enter the amount, RM 0.00 or more.', 422, { amount: 'Enter the amount.' });
    const cur = await one<{ amount: number | null; unit_id: string | null }>(env, 'SELECT amount, unit_id FROM tasks WHERE id = ?', id);
    if (b.amount === null && !cur?.unit_id) return fail('VALIDATION', 'An external job needs its amount.', 422, { amount: 'Enter the amount.' });
    if (await one(env, 'SELECT 1 AS x FROM expenses WHERE task_id = ?', id)) return fail('CONFLICT', 'This clean is already charged to the unit. Change the cost on the unit instead.', 409);
    sets.push('amount = ?'); args.push(b.amount);
    before.amount = cur?.amount ?? null; after.amount = b.amount;
  }

  if (!sets.length) return fail('VALIDATION', 'Nothing to change.', 422);

  await run(env, `UPDATE tasks SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...args, nowIso(), id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName,
    action: wantsReschedule && Object.keys(after).length > 2 ? 'task.edit' : wantsReschedule ? 'task.reschedule' : 'task.edit',
    entityTable: 'tasks', entityId: id, before, after,
  });
  return json({ ok: true });
};
