import { type Env, all, run, json, fail, audit } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';
import { notify } from '../../_lib/notify';
import { one } from '../../_lib/db';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role)) {
    return fail('FORBIDDEN', 'You can view statements but cannot send them. Ask a Finance Admin for access.', 403);
  }

  const { statementIds } = await request.json<{ statementIds: string[] }>();
  if (!statementIds?.length) return fail('VALIDATION', 'Select at least one statement.', 422);

  const placeholders = statementIds.map(() => '?').join(',');
  const rows = await all<{ id: string; state: string; owner_id: string }>(env,
    `SELECT id, state, owner_id FROM owner_statements WHERE id IN (${placeholders})`, ...statementIds);

  // Only finalised statements may be sent — provisional figures must never reach owners.
  const notFinal = rows.filter(r => r.state !== 'finalised');
  const sendable = rows.filter(r => r.state === 'finalised');

  for (const r of sendable) {
    await run(env, "UPDATE owner_statements SET state = 'sent', sent_at = ? WHERE id = ?", new Date().toISOString(), r.id);
    await audit(env, {
      actorId: session.userId, actorLabel: session.fullName, action: 'statement.send',
      entityTable: 'owner_statements', entityId: r.id,
      before: { state: 'finalised' }, after: { state: 'sent' },
    });
    const owner = await one<{ display_name: string; email: string; net_payout: number }>(env, `
      SELECT o.display_name, o.email, s.net_payout
      FROM owners o JOIN owner_statements s ON s.owner_id = o.id
      WHERE s.id = ?`, r.id);

    if (owner) {
      await notify(env, {
        template: 'owner.statement_ready',
        recipient: owner.email,
        channel: 'email',
        subject: 'Your statement is ready',
        body: `Your statement is ready. Net payout RM ${(owner.net_payout / 100).toLocaleString('en-MY', { minimumFractionDigits: 2 })}. Sign in to the owner portal to see every line.`,
        entityTable: 'owner_statements', entityId: r.id,
      });
    }
  }

  // Partial failure returns what succeeded and names only what did not.
  return json({
    sent: sendable.length,
    failed: notFinal.map(r => ({ id: r.id, reason: 'Cannot send. This statement is still provisional.' })),
  });
};
