import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { isAssignee, hasSupportRequest } from '../../../../_lib/maintenance';
import { repairNotice } from '../../../../_lib/notices';

interface SupportJob { id: string; state: string; job_type: string | null; started_at: string | null; ended_at: string | null; support_requested_at: string | null }

const NOT_READY = (): Response => fail('NOT_READY', 'Need support is not switched on yet. Tell the office.', 503);

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await hasSupportRequest(env))) return NOT_READY();
  const field = isFieldRole(session.role);

  const id = String(params.id);
  const body = await request.json<{ note?: unknown }>().catch(() => null);
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 1000) : '';
  if (!note) return fail('VALIDATION', 'Say what you tried first.', 422, { note: 'Say what you tried first.' });

  const job = await one<SupportJob>(env, 'SELECT id, state, job_type, started_at, ended_at, support_requested_at FROM maintenance_issues WHERE id = ?', id);
  if (!job) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (field && !(await isAssignee(env, id, session.userId))) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
  if (job.state === 'resolved' || job.ended_at) return fail('CONFLICT', 'That repair is already finished.', 409);
  if (!job.started_at && job.job_type !== 'pass_key') return fail('CONFLICT', 'Start the repair before asking for support.', 409);

  const now = nowIso();
  await run(env, 'UPDATE maintenance_issues SET support_requested_at = ?, support_note = ?, updated_at = ? WHERE id = ?', now, note, now, id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.support', entityTable: 'maintenance_issues', entityId: id, before: { supportRequestedAt: job.support_requested_at }, after: { supportRequestedAt: now, note }, source: field ? 'field_app' : 'web' });
  await repairNotice(env, id, 'support', session.userId, note);
  return json({ ok: true, supportRequestedAt: now });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'The office clears a support request.', 403);
  if (!(await hasSupportRequest(env))) return NOT_READY();

  const id = String(params.id);
  const job = await one<SupportJob>(env, 'SELECT id, state, job_type, started_at, ended_at, support_requested_at FROM maintenance_issues WHERE id = ?', id);
  if (!job) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (!job.support_requested_at) return json({ ok: true });

  await run(env, 'UPDATE maintenance_issues SET support_requested_at = NULL, support_note = NULL, updated_at = ? WHERE id = ?', nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.support_given', entityTable: 'maintenance_issues', entityId: id, before: { supportRequestedAt: job.support_requested_at }, after: { supportRequestedAt: null }, source: 'web' });
  return json({ ok: true });
};
