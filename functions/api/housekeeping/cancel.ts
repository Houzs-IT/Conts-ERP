import { type Env, json, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { cancelCleaningJobs } from '../../_lib/cleanCancel';

const MOST_JOBS_AT_ONCE = 100;

function taskIdsFrom(body: { taskIds?: unknown } | null): string[] {
  if (!Array.isArray(body?.taskIds)) return [];
  return [...new Set(body.taskIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || !session.manage) return fail('FORBIDDEN', 'Only people with Full Operations access can delete cleaning jobs.', 403);

  const body = await request.json<{ taskIds?: unknown; reason?: unknown }>().catch(() => null);
  const taskIds = taskIdsFrom(body);
  if (!taskIds.length) return fail('VALIDATION', 'Pick at least one cleaning job.', 422);
  if (taskIds.length > MOST_JOBS_AT_ONCE) return fail('VALIDATION', `Delete at most ${MOST_JOBS_AT_ONCE} cleaning jobs at a time.`, 422);
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (!reason) return fail('VALIDATION', 'Give a reason for deleting.', 422, { reason: 'Say why these jobs are deleted.' });

  const { cancelled, skipped } = await cancelCleaningJobs(env, session, taskIds, reason, session);
  return json({ ok: true, deleted: cancelled, skipped });
};
