import { type Env, all, run, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { notify } from '../../_lib/notify';
import { auditMany } from '../../_lib/history';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) {
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

  if (sendable.length) {
    // The database side in a handful of writes for the whole selection (a month is about 100 owners); it was
    // eleven queries per statement, one after another, before the first email went out.
    const ids = JSON.stringify(sendable.map(r => r.id));
    await run(env, "UPDATE owner_statements SET state = 'sent', sent_at = ? WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))", new Date().toISOString(), ids);
    await auditMany(env, sendable.map(r => ({
      actorId: session.userId, actorLabel: session.fullName, action: 'statement.send',
      entityTable: 'owner_statements', entityId: r.id, before: { state: 'finalised' }, after: { state: 'sent' },
    })));
    const info = await all<{ id: string; net_payout: number; owner_id: string; bank_account_last4: string | null; display_name: string; email: string; has_payout: boolean }>(env, `
      SELECT s.id, s.net_payout, s.owner_id, o.bank_account_last4, o.display_name, o.email,
             EXISTS (SELECT 1 FROM payouts p WHERE p.statement_id = s.id) AS has_payout
      FROM owner_statements s JOIN owners o ON o.id = s.owner_id
      WHERE s.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, ids);
    const byId = new Map(info.map(x => [x.id, x]));
    // A sent statement gets its payout row straight away. With no bank details on file it starts as failed, so finance sees it.
    const payouts = sendable.map(r => byId.get(r.id)).filter((p): p is NonNullable<typeof p> => !!p && !p.has_payout).map(p => ({
      id: crypto.randomUUID(), statement_id: p.id, owner_id: p.owner_id, amount: p.net_payout, state: p.bank_account_last4 ? 'pending' : 'failed',
      bank_last4: p.bank_account_last4, failure_reason: p.bank_account_last4 ? null : 'No bank details on file for this owner.',
    }));
    if (payouts.length) {
      await run(env, `
        INSERT INTO payouts (id, statement_id, owner_id, amount, currency, state, method, bank_last4, failure_reason, created_at)
        SELECT x.id, x.statement_id, x.owner_id, x.amount, 'MYR', x.state, 'bank_transfer', x.bank_last4, x.failure_reason, ?
        FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, statement_id text, owner_id text, amount int, state text, bank_last4 text, failure_reason text)`,
        nowIso(), JSON.stringify(payouts));
      await auditMany(env, payouts.map(p => ({ actorId: session.userId, actorLabel: session.fullName, action: 'payout.create', entityTable: 'payouts', entityId: p.id, after: { statementId: p.statement_id, amount: p.amount } })));
    }
    for (const r of sendable) {
      const owner = byId.get(r.id);
      if (!owner) continue;
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
    failed: notFinal.map(r => ({ id: r.id, reason: 'Not sent. This statement is still a draft. Mark it final first.' })),
  });
};
