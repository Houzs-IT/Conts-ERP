import { type Env, json, fail } from '../../../_lib/db';
import { timingSafeEqualStr } from '../../../_lib/auth';
import { measureHealth } from '../../../_lib/systemHealth';

/** POST /api/system/health/hub-report — measure the live health here, on the website, and send it to the Houzs
 *  IT Hub. Called every 5 minutes by the cron worker (hubHealthReport), never by a person: the caller proves
 *  itself with Conts's IT Hub key, which both hold. Measured here rather than in the worker because the
 *  website is the one holding the mail key and the Channex secret the checks look for, and the address the
 *  Channex callback is registered against. Answers what happened; never throws. */
/** When the running version was published: the build time vite writes to /version.json (vite.config.ts), the same
 *  date the System health page shows as "this version published". Null when it cannot be read. */
async function publishedAt(env: Env, request: Request): Promise<string | null> {
  try {
    const res = await env.ASSETS?.fetch(new URL('/version.json', request.url));
    const v = res?.ok ? ((await res.json()) as { version?: unknown }).version : null;
    return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null;
  } catch {
    return null;
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // The key is checked before anything about this site is said, so a caller without it learns nothing.
  const key = (env.IT_HUB_API_KEY ?? '').trim();
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!key || !given || !timingSafeEqualStr(given, key)) return fail('UNAUTHENTICATED', 'Not allowed.', 401);
  const base = (env.IT_HUB_URL ?? '').trim().replace(/\/+$/, '');
  if (!base) return fail('NOT_CONFIGURED', 'IT Support is not connected on this system.', 501);

  try {
    const report = { ...await measureHealth(env, new URL(request.url).origin), published_at: await publishedAt(env, request) };
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
