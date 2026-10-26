import { z } from 'zod';
import { mayWork } from '../../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { notifyUsers } from '../../../_lib/notify';
import { day } from '../../../_lib/notices';
import { hasLeaves, NOT_MIGRATED, leaveById, overlapping } from '../../../_lib/leave';
import { LEAVE_TYPE_LABEL } from '../../../_lib/leaveRules';

const MANAGE = ['management']; // everyone else follows their level in HR (functions/_lib/access.ts)
const decision = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(300).transform(v => v || null).nullable().default(null),
}).refine(d => d.decision === 'approve' || !!d.note, { path: ['note'], message: 'Say why, so they know what to do next.' });

/**
 * POST /api/leaves/:id/decide { decision: approve | reject, note? } — the office decides a pending request. A rejection
 * needs a reason. An approved request can be rejected later (plans change); it then stops counting. The person is told
 * on their phone either way.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Your access does not include deciding leave.', 403);
  if (!(await hasLeaves(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);

  const leave = await leaveById(env, String(params.id));
  if (!leave) return fail('NOT_FOUND', 'That request no longer exists.', 404);
  const parsed = decision.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail('VALIDATION', 'Some fields need a fix.', 422, Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0] ?? 'form'), i.message])));
  }
  const { decision: d, note } = parsed.data;
  const ok = d === 'approve' ? leave.status === 'pending' : leave.status === 'pending' || leave.status === 'approved';
  if (!ok) return fail('CONFLICT', `That request is already ${leave.status}.`, 409);
  if (d === 'approve' && await overlapping(env, leave.employee_id, leave.start_date, leave.end_date, leave.id)) {
    return fail('CONFLICT', 'They have another request on some of these days. Decide that one first.', 409);
  }

  const status = d === 'approve' ? 'approved' : 'rejected';
  const now = nowIso();
  await run(env, `UPDATE leaves SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ? WHERE id = ? AND status = ?`,
    status, session.userId, now, note, now, leave.id, leave.status);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: `leave.${status === 'approved' ? 'approve' : 'reject'}`, entityTable: 'leaves', entityId: leave.id,
    before: { status: leave.status }, after: { status, note },
  });

  const who = await one<{ user_id: string | null }>(env, `
    SELECT COALESCE(c.user_id, t.user_id) AS user_id FROM employees e
    LEFT JOIN cleaners c ON c.id = e.cleaner_id LEFT JOIN technicians t ON t.id = e.technician_id WHERE e.id = ?`, leave.employee_id);
  const span = leave.start_date === leave.end_date ? day(leave.start_date) : `${day(leave.start_date)} to ${day(leave.end_date)}`;
  if (who?.user_id) {
    await notifyUsers(env, [who.user_id], {
      kind: `leave.${status}`, title: `Your ${LEAVE_TYPE_LABEL[leave.type].toLowerCase()} leave was ${status}`,
      body: `${span}.${note ? ` ${note}` : ''}`, link: '/portal/me', entityTable: 'leaves', entityId: leave.id, dedupeKey: `leave-${leave.id}-${status}`,
    });
  }
  return json({ status });
};
