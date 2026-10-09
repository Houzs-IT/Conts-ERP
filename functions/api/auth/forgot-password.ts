import { type Env, one, json } from '../../_lib/db';
import { sendPasswordReset } from '../../_lib/auth';

/** Always 200, always the same body. Never discloses whether an account exists. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { email } = await request.json<{ email: string }>();
  const user = await one<{ id: string; email: string }>(env, 'SELECT id, email FROM users WHERE email = ?', (email ?? '').toLowerCase().trim());

  if (user) await sendPasswordReset(env, new URL(request.url).origin, user);

  return json({ ok: true });
};
