import { type Env, all, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { MYT_DATE } from '../../_lib/ops';
import { CLEAN_KINDS_SQL, chargeClean, mytToday } from '../../_lib/cleaning';
import { noOpenBlockerSql } from '../../_lib/maintenance';
import { hasJobInvoices } from '../../_lib/jobProfit';

const NOTE = 'closed in bulk';

/** POST /api/housekeeping/overdue { action: 'done' | 'cancel', taskIds, reason? } — management closes open cleaning jobs
 *  from earlier days in one go (mostly stale imported jobs whose stay ended days ago).
 *  done:   finished by the caller now, note "closed in bulk", no photo asked (this path only), charged to the unit by the
 *          same rule as a finished clean (chargeClean), dated on the job's own day. The unit turns Ready only when no other clean is still open on it.
 *  cancel: the job is removed with its reason in the audit trail and nothing is charged. A job someone started, with a
 *          photo or video, damage reported from it, or any money on it is refused, so nothing real is thrown away.
 *  Only jobs dated before today (Malaysia) and still open are touched; anything else comes back in `skipped`. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || !MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management can close overdue cleaning jobs in bulk.', 403);

  const b = await request.json<any>().catch(() => null);
  const action = b?.action;
  if (action !== 'done' && action !== 'cancel') return fail('VALIDATION', 'Say whether to mark the jobs done or cancel them.', 422);
  const ids: string[] = Array.isArray(b?.taskIds) ? [...new Set(b.taskIds.filter((x: unknown) => typeof x === 'string' && x))] as string[] : [];
  if (!ids.length) return fail('VALIDATION', 'Pick at least one cleaning job.', 422);
  if (ids.length > 100) return fail('VALIDATION', 'Close at most 100 cleaning jobs at a time.', 422);
  const reason = typeof b?.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
  if (action === 'cancel' && !reason) return fail('VALIDATION', 'Give a reason for cancelling.', 422, { reason: 'Say why these jobs are cancelled.' });

  const today = mytToday();
  const invoiced = (await hasJobInvoices(env)) ? ' OR e.invoice_task_id = t.id' : '';
  const day = MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)');
  const tasks = await all<any>(env, `
    SELECT t.id, t.state, t.kind, t.title, t.unit_id, t.reservation_id, t.started_at, t.assignee_id, t.cleaner_id, ${day} AS day,
           COALESCE(u.unit_number, t.external_address) AS unit_number,
           (SELECT COUNT(*)::int FROM documents d WHERE d.task_id = t.id) AS files,
           (SELECT COUNT(*)::int FROM maintenance_issues m WHERE m.source_task_id = t.id) AS damage,
           (SELECT COUNT(*)::int FROM expenses e WHERE e.task_id = t.id${invoiced}) AS money,
           (SELECT string_agg(COALESCE(c.full_name, x.full_name), ', ') FROM task_cleaners tc LEFT JOIN cleaners c ON c.id = tc.cleaner_id
              LEFT JOIN users x ON x.id = tc.user_id WHERE tc.task_id = t.id) AS cleaners
    FROM tasks t LEFT JOIN units u ON u.id = t.unit_id
    WHERE t.id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND t.kind IN ${CLEAN_KINDS_SQL}`, JSON.stringify(ids));
  const byId = new Map(tasks.map(t => [t.id, t]));


  const skipped: { id: string; unitNumber: string | null; reason: string }[] = [];
  const notCharged: { id: string; unitNumber: string | null; reason: string }[] = [];
  const eligible: any[] = [];
  for (const id of ids) {
    const t = byId.get(id);
    const why = !t ? 'not a cleaning job any more' : t.state === 'resolved' ? 'already done' : !(t.day < today) ? 'not overdue'
      : action === 'done' ? null
      : t.started_at || t.state === 'in_progress' ? 'a cleaner started it; mark it done instead'
      : Number(t.files) > 0 ? 'it has photos or videos; mark it done instead'
      : Number(t.damage) > 0 ? 'damage was reported from it'
      : Number(t.money) > 0 ? 'money is already recorded on it' : null;
    if (why) skipped.push({ id, unitNumber: t?.unit_number ?? null, reason: why }); else eligible.push(t);
  }
  const now = nowIso();
  const actor = { actorId: session.userId, actorLabel: session.fullName };
  type Entry = { action: string; table: string; id: string; before?: unknown; after: unknown };
  const entries = (xs: Entry[]) => JSON.stringify(xs.map(x => ({ ...x, before: x.before ? JSON.stringify(x.before) : null, after: JSON.stringify(x.after) })));
  const AUDIT_COLS = 'INSERT INTO audit_log (actor_id, actor_label, action, entity_table, entity_id, before_state, after_state, source, occurred_at)';
  const AUDIT_ROW = `?, ?, x->>'action', x->>'table', x->>'id', x->>'before', x->>'after', 'web', ?`;
  if (!eligible.length) return json({ ok: true, action, closed: 0, skipped, charged: 0, chargedAmount: 0, notCharged });

  try {
    if (action === 'done') {
      const closedRows = await all<{ id: string }>(env, `
        UPDATE tasks SET state = 'resolved', completed_at = ?, completed_by = ?, updated_at = ?
        WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND state != 'resolved' RETURNING id`, now, session.userId, now, JSON.stringify(eligible.map(t => t.id)));
      const closedIds = new Set(closedRows.map(r => r.id));
      for (const t of eligible) if (!closedIds.has(t.id)) skipped.push({ id: t.id, unitNumber: t.unit_number, reason: 'already done' });
      const closed = eligible.filter(t => closedIds.has(t.id));
      // A stale job closed today must not call the unit Ready while a newer clean on it is still open.
      const unitIds = [...new Set(closed.map(t => t.unit_id).filter(Boolean))];
      const flipped = unitIds.length ? await all<{ id: string }>(env, `
        UPDATE units SET readiness = 'ready', updated_at = ? WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
          AND readiness IS DISTINCT FROM 'ready' AND ${noOpenBlockerSql('units.id')}
          AND NOT EXISTS (SELECT 1 FROM tasks o WHERE o.unit_id = units.id AND o.kind IN ${CLEAN_KINDS_SQL} AND o.state != 'resolved')
        RETURNING id`, now, JSON.stringify(unitIds)) : [];
      const log: Entry[] = [
        ...closed.map(t => ({ action: 'task.complete', table: 'tasks', id: t.id, before: { state: t.state }, after: { state: 'resolved', note: NOTE, bulk: true, photoWaived: Number(t.files) === 0, day: t.day } })),
        ...flipped.map(u => ({ action: 'unit.readiness_change', table: 'units', id: u.id, after: { readiness: 'ready', via: NOTE } })),
      ];
      if (log.length) await all(env, `${AUDIT_COLS} SELECT ${AUDIT_ROW} FROM jsonb_array_elements(?::text::jsonb) x`, actor.actorId, actor.actorLabel, now, entries(log));
      // The finished-clean money rule, job by job (chargeClean: price on the job's day, one charge per unit and day, locked
      // months refused). Booked on the job's own day: on today it would take the unit's one clean charge of the day from
      // today's real clean.
      let charged = 0, chargedAmount = 0;
      for (const t of closed.filter(x => x.unit_id)) {
        const cost = await chargeClean(env, session, t, t.day);
        if (cost.created) { charged++; chargedAmount += cost.amount; } else notCharged.push({ id: t.id, unitNumber: t.unit_number, reason: cost.reason ?? 'not charged' });
      }
      return json({ ok: true, action, closed: closed.length, skipped, charged, chargedAmount, notCharged });
    }

    // Cancel: the delete and its audit rows are one statement, so a job never disappears without its reason on record.
    // task_cleaners and checklist ticks exist only for the job and go with it; the guards are checked again in the delete.
    const log: Entry[] = eligible.flatMap(t => [
      { action: 'task.cancel', table: 'tasks', id: t.id, after: { reason, bulk: true },
        before: { unitId: t.unit_id, unitNumber: t.unit_number, reservationId: t.reservation_id, kind: t.kind, title: t.title, day: t.day, state: t.state, cleaners: t.cleaners ?? null } },
      // On the stay too: the board reads this so a past checkout whose job was cancelled is not shown as "no cleaning job".
      ...(t.reservation_id ? [{ action: 'cleaning.cancel', table: 'reservations', id: t.reservation_id, after: { taskId: t.id, reason, day: t.day } }] : []),
    ].map(e => ({ ...e, task: t.id })));
    const invoiced = (await hasJobInvoices(env)) ? ' OR e.invoice_task_id = t.id' : '';
    const done = await all<{ action: string; entity_id: string }>(env, `
      WITH gone AS (
        DELETE FROM tasks t WHERE t.id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND t.state != 'resolved' AND t.started_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.task_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM maintenance_issues m WHERE m.source_task_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.task_id = t.id${invoiced})
        RETURNING t.id)
      ${AUDIT_COLS} SELECT ${AUDIT_ROW} FROM jsonb_array_elements(?::text::jsonb) x JOIN gone ON gone.id = x->>'task'
      RETURNING action, entity_id`, JSON.stringify(eligible.map(t => t.id)), actor.actorId, actor.actorLabel, now, entries(log as Entry[]));
    const goneIds = new Set(done.filter(r => r.action === 'task.cancel').map(r => r.entity_id));
    for (const t of eligible) if (!goneIds.has(t.id)) skipped.push({ id: t.id, unitNumber: t.unit_number, reason: 'it changed meanwhile; refresh and try again' });
    return json({ ok: true, action, closed: goneIds.size, skipped, charged: 0, chargedAmount: 0, notCharged });
  } catch (e) {
    await audit(env, { ...actor, action: 'task.bulk_close_failed', entityTable: 'tasks', entityId: eligible[0].id, after: { action, taskIds: eligible.map(t => t.id), error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
    return fail('INTERNAL', 'Not every cleaning job could be closed. Refresh the board to see which are left, then try again.', 500);
  }
};
