import { type Env, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession, hashPassword } from '../../_lib/auth';
import { notify } from '../../_lib/notify';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const { password } = await request.json<{ password: string }>();

  // Enforced server-side as well as in the UI — the client checklist is convenience.
  const problems: Record<string, string> = {};
  if (!password || password.length < 8) problems.password = 'At least 8 characters';
  else if (!/[A-Z]/.test(password)) problems.password = 'At least 1 uppercase letter';
  else if (!/[0-9]/.test(password)) problems.password = 'At least 1 digit';
  if (Object.keys(problems).length) return fail('VALIDATION', 'Password does not meet the requirements.', 422, problems);

  const hash = await hashPassword(password);
  await run(env, 'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', hash, nowIso(), session.userId);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'account.password_changed',
    entityTable: 'users', entityId: session.userId,
  });
  await notify(env, {
    template: 'account.password_changed',
    recipient: session.email,
    channel: 'email',
    subject: 'Your password was changed',
    body: `Your Property OS password was changed just now. If this was not you, contact your administrator immediately.`,
    entityTable: 'users', entityId: session.userId,
    urgent: true,
  });
  return json({ ok: true });
};
