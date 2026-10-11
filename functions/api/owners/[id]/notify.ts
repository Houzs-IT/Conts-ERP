import { mayWork } from '../../../_lib/access';
import { type Env, one, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { notify } from '../../../_lib/notify';

/** POST /api/owners/:id/notify { unitLabel, reason, datesBlocked, revenueAtRisk, expectedReturn } — tells an owner their unit is off sale. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, ['management', 'operations_manager', 'operations_staff'])) return fail('FORBIDDEN', 'Only operations can notify owners.', 403);

  const id = String(params.id);
  const owner = await one<{ display_name: string; email: string }>(env, 'SELECT display_name, email FROM owners WHERE id = ?', id);
  if (!owner) return fail('NOT_FOUND', 'That owner no longer exists.', 404);
  if (!owner.email) return fail('VALIDATION', 'This owner has no email address on file.', 422);

  const b = await request.json<any>().catch(() => ({}));
  const lines = [
    `Dear ${owner.display_name},`, '',
    `${b.unitLabel ?? 'Your unit'} is blocked${b.reason ? ` for ${String(b.reason).toLowerCase()}` : ''}.`,
    b.datesBlocked ? `Dates held: ${b.datesBlocked}.` : '',
    b.expectedReturn ? `Expected to be available again: ${b.expectedReturn}.` : '',
    Number.isInteger(b.revenueAtRisk) && b.revenueAtRisk > 0 ? `Estimated earnings affected: RM ${(b.revenueAtRisk / 100).toLocaleString('en-MY')}.` : '',
    '', 'We will update you as soon as it is back.',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '');

  const res = await notify(env, {
    template: 'owner.unit_blocked', recipient: owner.email, channel: 'email', subject: 'Your unit is blocked', body: lines.join('\n'),
    entityTable: 'owners', entityId: id, urgent: false,
  });
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner.notify', entityTable: 'owners', entityId: id, after: { unit: b.unitLabel ?? null, delivery: res.state } });
  return json({ ok: true, delivery: res.state });
};
