import { type Env, one, json, fail } from '../../_lib/db';
import { readSession, readCookie, securitySettings } from '../../_lib/auth';
import { twoFactorTables } from '../../_lib/twoFactor';
import { twoStepSetupDue } from '../../_lib/signIn';
import { levelsFor } from '../../_lib/access';
import { placeOf } from '../../_lib/userSide';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const s = await readSession(env.SESSION_SECRET, readCookie(request));
  if (!s) return fail('UNAUTHENTICATED', 'Your session expired. Sign in to continue.', 401);

  const totp = await twoFactorTables(env);
  const user = await one<{ id: string; full_name: string; email: string; role: string; must_change_password: number; locale: string; totp_enabled_at?: string | null }>(
    env, `SELECT id, full_name, email, role, must_change_password, locale${totp ? ', totp_enabled_at' : ''} FROM users WHERE id = ? AND is_active = 1`, s.userId);
  if (!user) return fail('UNAUTHENTICATED', 'Your session expired. Sign in to continue.', 401);

  // Read live, like the middleware does, so a move to another department shows on the next screen load.
  const place = await placeOf(env, user.id);
  const { side, departmentId, positionId, kind } = place;
  return json({
    user: {
      id: user.id, fullName: user.full_name, email: user.email, role: user.role, side,
      departmentId, department: place.department, positionId, kind,
      mustChangePassword: !!user.must_change_password, locale: user.locale,
      twoStepSetupRequired: await twoStepSetupDue(env, await securitySettings(env), { role: user.role, departmentId }, !!user.totp_enabled_at),
      access: await levelsFor(env, { userId: user.id, role: user.role, side, departmentId, positionId, kind }),
    },
  });
};
