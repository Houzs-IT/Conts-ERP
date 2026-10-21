import { type Env, json, fail } from '../../../_lib/db';
import { timingSafeEqualStr } from '../../../_lib/auth';
import { measureHealth } from '../../../_lib/systemHealth';

/** POST /api/system/health/hub-report — measure the live health here, on the website, and send it to the Houzs
 *  IT Hub. Called every 5 minutes by the cron worker (hubHealthReport), never by a person: the caller proves
 *  itself with Conts's IT Hub key, which both hold. Measured here rather than in the worker because the
 *  website is the one holding the mail key and the Channex secret the checks look for, and the address the
 *  Channex callback is registered against. Answers what happened; never throws. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const key = (env.IT_HUB_API_KEY ?? '').trim();
  const base = (env.IT_HUB_URL ?? '').trim().replace(/\/+$/, '');
  if (!key || !base) return fail('NOT_CONFIGURED', 'IT Support is not connected on this system.', 501);
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!given || !timingSafeEqualStr(given, key)) return fail('UNAUTHENTICATED', 'Not allowed.', 401);

  try {
    const report = await measureHealth(env, new URL(request.url).origin);
    const res = await fetch(`${base}/api/v1/sys/health`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error('IT Hub refused the health report', res.status);
      return json({ sent: false, status: res.status, ok: report.ok }, 502);
    }
    return json({ sent: true, ok: report.ok, checks: report.checks.map(c => `${c.label} ${c.status}`) });
  } catch (e) {
    console.error('Health report not sent', e instanceof Error ? e.message : e);
    return json({ sent: false, error: 'The health report could not be measured or sent.' }, 502);
  }
};
