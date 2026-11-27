import { type Env, fail, json } from '../../../_lib/db';
import { timingSafeEqualStr } from '../../../_lib/auth';
import { mcpReady } from '../../../_lib/mcpStore';
import { proactiveReady } from '../../../_lib/mcpProactiveStore';
import { runTick } from '../../../_lib/mcpProactiveRun';

/**
 * POST /api/mcp/proactive/tick[?dryRun=1]: the AI Connector's morning briefs and urgent alerts (round 4d), every 15
 * minutes from the cron worker (functions/_lib/cronJobs.ts aiBriefTick), never by a person. The caller proves itself
 * with Conts's IT Hub key, which the website and the cron worker both hold (as POST /api/system/health/hub-report).
 * Runs here, on the website, because a brief is the daily_brief tool run AS each person through the API's own routes
 * in-process (functions/_lib/mcpProactiveRun.ts). Bounded and idempotent: a repeated or overlapping call sends nothing
 * twice. dryRun answers the counts only.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  // The key is checked before anything about this site is said.
  const key = (env.IT_HUB_API_KEY ?? '').trim();
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!key || !given || !timingSafeEqualStr(given, key)) return fail('UNAUTHENTICATED', 'Not allowed.', 401);
  if (!(await mcpReady(env)) || !(await proactiveReady(env))) {
    return json({ ok: true, ran: false, reason: 'Not set up here yet (migration 0378 or 0397 not applied): nothing sent.' });
  }
  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';
  return json({ ok: true, ran: true, ...await runTick({ request, env, waitUntil }, { dryRun }) });
};
