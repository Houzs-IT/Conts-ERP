import type { Env } from '../functions/_lib/db';
import { SCHEDULE, runJobs } from '../functions/_lib/cronJobs';

/**
 * Cron worker (theconts-cron). Deployed separately from Pages: `node scripts/cron-deploy.mjs` (steps in its header).
 * Pages Functions route by file path, so this cannot live in functions/; it shares the same database (Hyperdrive)
 * and the same job code as the local dry run (scripts/cron-dry-run.mjs), functions/_lib/cronJobs.ts.
 *
 *   * * * * *      Channex outbox: retries and anything the request-time flush missed
 *   *\/5 * * * *   HostPlatform: pull the reservations it changed since the last run
 *   *\/15 * * * *  email / WhatsApp outbox (quiet hours, retries); calendar blocks of finished repair jobs
 *   0 * * * *      overdue cleans and repairs, statements finalised but unsent
 *   0 0 * * *      the 08:00 "today" digest for operations
 *
 * Each trigger's jobs are idempotent: a run that is repeated or overlaps another does no harm.
 */
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const jobs = SCHEDULE[event.cron];
    if (!jobs) return;
    ctx.waitUntil(runJobs(env, jobs).then(r => { for (const j of r) if (j.error) console.error(`${j.job}: ${j.error}`); }));
  },
};
