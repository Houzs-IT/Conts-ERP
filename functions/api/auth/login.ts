import { type Env, one, run, json, fail, nowIso } from '../../_lib/db';
import { signSession, cookie, verifyPassword } from '../../_lib/auth';
import { doorFor, doorRefusal, HOME } from '../../_lib/door';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { email, password } = await request.json<{ email: string; password: string }>();
  if (!email || !password) return fail('VALIDATION', 'Enter your email and password.', 422);

  const user = await one<{
    id: string; email: string; full_name: string; password_hash: string; role: string;
    must_change_password: number; failed_attempts: number; locked_until: string | null; is_active: number;
  }>(env, 'SELECT * FROM users WHERE email = ? LIMIT 1', email.toLowerCase().trim());

  // Same response shape and timing whether or not the account exists.
  const ok = user ? await verifyPassword(password, user.password_hash) : false;

  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    return fail('ACCOUNT_LOCKED',
      `Account locked for ${LOCK_MINUTES} minutes after five failed attempts. Try again at ${new Date(user.locked_until).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' })} or ask an administrator to reset it.`,
      423);
  }

  if (!user || !ok) {
    if (user) {
      const attempts = user.failed_attempts + 1;
      const lock = attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
      await run(env, 'UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', attempts, lock, user.id);
    }
    return fail('INVALID_CREDENTIALS', 'Invalid email or password. Five failed attempts lock the account for 15 minutes.', 401);
  }

  if (!user.is_active) return fail('ACCOUNT_INACTIVE', 'This account is inactive. Ask an administrator to reactivate it.', 403);

  // Checked after the password, so a wrong door never reveals which accounts exist.
  const refusal = doorRefusal(doorFor(request), user.role);
  if (refusal) return fail('WRONG_DOOR', refusal, 403);

  await run(env, 'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', nowIso(), user.id);

  const token = await signSession(env.SESSION_SECRET, {
    userId: user.id, email: user.email, role: user.role, fullName: user.full_name,
  });

  return json({
    user: {
      id: user.id, fullName: user.full_name, email: user.email, role: user.role,
      mustChangePassword: !!user.must_change_password, locale: 'en-MY',
    },
    home: user.must_change_password ? '/change-password' : (HOME[user.role] ?? '/'),
  }, 200, { 'set-cookie': cookie(request, token) });
};
