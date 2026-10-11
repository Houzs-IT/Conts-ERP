import { type Env, all, json } from '../../_lib/db';

const FALLBACK_PHONE = '+60 17-465 8868';

/** GET /api/settings/public — the support phone for the sign-in page, read before anyone is signed in.
 *  Only this one value: everything else in Settings stays behind a session. */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const rows = await all<{ key: string; value: string }>(env,
    "SELECT key, value FROM settings WHERE key IN ('company.supportPhone', 'org.support_phone')").catch(() => []);
  const saved = rows.find(r => r.key === 'company.supportPhone') ?? rows.find(r => r.key === 'org.support_phone');
  return json({ supportPhone: saved?.value?.trim() || FALLBACK_PHONE }, 200, { 'cache-control': 'public, max-age=300' });
};
