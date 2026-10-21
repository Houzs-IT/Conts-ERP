import { type Env, all, json } from '../../_lib/db';
import { phone } from '../../../src/lib/phone';

const FALLBACK_PHONE = '+60 11-6133 3289';

/** GET /api/settings/public — the support phone for the sign-in page, read before anyone is signed in.
 *  Only this one value: everything else in Settings stays behind a session. */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const rows = await all<{ key: string; value: string }>(env,
    "SELECT key, value FROM settings WHERE key IN ('company.supportPhone', 'org.support_phone')").catch(() => []);
  const saved = rows.find(r => r.key === 'company.supportPhone') ?? rows.find(r => r.key === 'org.support_phone');
  // Staff save the number as dialled at home (011-...). It goes out formatted as guests abroad dial it, so the
  // sign-in page shows it as is and does not have to load the phone library.
  const raw = saved?.value?.trim() || FALLBACK_PHONE;
  return json({ supportPhone: phone(raw) || raw }, 200, { 'cache-control': 'public, max-age=300' });
};
