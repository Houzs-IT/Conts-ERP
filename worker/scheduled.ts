import { type Env, all, run, nowIso } from '../functions/_lib/db';
import { deliver } from '../functions/_lib/notify';
import { flushWhenQuiet } from '../functions/_lib/channexQueue';

/**
 * Cron worker. Deployed separately from Pages:
 *   npx wrangler deploy --config wrangler.cron.toml
 *
 * Pages Functions route by file path, so this cannot live in functions/ — it would
 * be served as a URL instead of running on a schedule. It shares the same D1
 * binding and the same helpers.
 *
 * The every-minute trigger only sends the Channex outbox (retries and anything the request-time
 * flush missed); it returns before the jobs below, which run on the other two triggers.
 *
 * Three jobs, all idempotent:
 *   1. drain the quiet-hours notification queue
 *   2. mark tasks overdue once their committed time passes
 *   3. flag statements finalised but unsent for three days
 */
const CHANNEX_CRON = '* * * * *';

export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    if (event.cron === CHANNEX_CRON) { await flushWhenQuiet(env); return; }

    const now = new Date();
    const myt = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
    const hour = myt.getHours();

    // 1. Quiet hours ended — actually send anything queued overnight. (This used to just flip
    //    the row to 'sent' without calling the provider, so nothing queued was ever really
    //    delivered — see the IT handoff checklist and TODO.md.)
    if (hour >= 8 && hour < 22) {
      const queued = await all<{ id: string; template: string; recipient: string; channel: string; entity_table: string | null; entity_id: string | null; subject: string | null; body: string | null }>(env,
        "SELECT id, template, recipient, channel, entity_table, entity_id, subject, body FROM notification_log WHERE state = 'queued' ORDER BY queued_at LIMIT 100");
      for (const q of queued) {
        try {
          const providerId = await deliver(env, {
            template: q.template, recipient: q.recipient, channel: q.channel as any,
            subject: q.subject ?? undefined, body: q.body ?? '',
            entityTable: q.entity_table ?? undefined, entityId: q.entity_id ?? undefined,
          });
          await run(env, "UPDATE notification_log SET state = 'sent', sent_at = ?, provider_message_id = ? WHERE id = ?", nowIso(), providerId, q.id);
        } catch (e) {
          const reason = e instanceof Error ? e.message : 'Unknown delivery error';
          await run(env, "UPDATE notification_log SET state = 'failed', error = ? WHERE id = ?", reason, q.id);
        }
      }
    }

    // 2. A task past its committed time is Overdue, not still Assigned.
    await run(env, `
      UPDATE tasks SET state = 'overdue', updated_at = ?
      WHERE state IN ('open','assigned','in_progress')
        AND due_at IS NOT NULL AND due_at < ?`, nowIso(), nowIso());

    // 3. Finalised but unsent for 3 days is an operational failure worth surfacing.
    const stale = await all<{ id: string; owner_id: string }>(env, `
      SELECT id, owner_id FROM owner_statements
      WHERE state = 'finalised' AND finalised_at < to_char((now() at time zone 'utc') - interval '3 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);
    for (const s of stale) {
      await run(env, `
        INSERT INTO notification_log (id, template, recipient, channel, entity_table, entity_id, idempotency_key, state, queued_at)
        VALUES (?, 'finance.statements_unsent', 'finance@theconts.com', 'in_app', 'owner_statements', ?, ?, 'queued', ?)
        ON CONFLICT (idempotency_key) DO NOTHING`,
        crypto.randomUUID(), s.id, `unsent-${s.id}`, nowIso());
    }
  },
};
