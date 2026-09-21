import { type Env, all, run, nowIso } from '../functions/_lib/db';

/**
 * Cron worker. Deployed separately from Pages:
 *   npx wrangler deploy --config wrangler.cron.toml
 *
 * Pages Functions route by file path, so this cannot live in functions/ — it would
 * be served as a URL instead of running on a schedule. It shares the same D1
 * binding and the same helpers.
 *
 * Three jobs, all idempotent:
 *   1. drain the quiet-hours notification queue
 *   2. mark tasks overdue once their committed time passes
 *   3. flag statements finalised but unsent for three days
 */
export default {
  async scheduled(_event: ScheduledEvent, env: Env) {
    const now = new Date();
    const myt = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
    const hour = myt.getHours();

    // 1. Quiet hours ended — release anything queued overnight.
    if (hour >= 8 && hour < 22) {
      const queued = await all<{ id: string }>(env,
        "SELECT id FROM notification_log WHERE state = 'queued' ORDER BY queued_at LIMIT 100");
      for (const q of queued) {
        // The send itself is retried by the same adapter; here we only unblock it.
        await run(env, "UPDATE notification_log SET state = 'sent', sent_at = ? WHERE id = ?", nowIso(), q.id);
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
