import { type Env, one, json, fail } from '../../_lib/db';
import { readSession, readCookie } from '../../_lib/auth';
import { levelsFor } from '../../_lib/access';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const s = await readSession(env.SESSION_SECRET, readCookie(request));
  if (!s) return fail('UNAUTHENTICATED', 'Your session expired. Sign in to continue.', 401);

  const user = await one<{ id: string; full_name: string; email: string; role: string; must_change_password: number; locale: string }>(
    env, 'SELECT id, full_name, email, role, must_change_password, locale FROM users WHERE id = ? AND is_active = 1', s.userId);
  if (!user) return fail('UNAUTHENTICATED', 'Your session expired. Sign in to continue.', 401);

  return json({
    user: {
      id: user.id, fullName: user.full_name, email: user.email, role: user.role,
      mustChangePassword: !!user.must_change_password, locale: user.locale,
      access: await levelsFor(env, user.role),
    },
  });
};
