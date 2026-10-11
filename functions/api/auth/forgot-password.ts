import { type Env, one, json, fail } from '../../_lib/db';
import { sendPasswordReset } from '../../_lib/auth';

/** Tells the person what happened: no account, account switched off, too many requests, the email could not be
 *  sent, or sent. The owner chose this over a silent "always sent" reply (10 Oct 2026): an internal staff tool
 *  where a reset that silently did nothing cost more than revealing which emails have accounts. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { email } = await request.json<{ email: string }>();
  const address = (email ?? '').toLowerCase().trim();
  if (!address) return fail('VALIDATION', 'Enter the email you sign in with.', 422);
  const user = await one<{ id: string; email: string; is_active: number }>(env, 'SELECT id, email, is_active FROM users WHERE lower(email) = ?', address);
  if (!user) return fail('NO_ACCOUNT', 'No account uses this email. Check the spelling, or ask a manager to add you in Users and roles.', 404);
  if (!user.is_active) return fail('INACTIVE', 'This account is switched off. Ask a manager to turn it back on in Users and roles.', 403);
  const recent = await one<{ n: number }>(env,
    'SELECT COUNT(*) AS n FROM password_reset_tokens WHERE user_id = ? AND created_at > ?', user.id, new Date(Date.now() - 15 * 60000).toISOString());
  if (Number(recent?.n ?? 0) >= 3) return fail('TOO_MANY', 'Three reset links were sent in the last 15 minutes. Use the newest one, or try again later.', 429);

  const sent = await sendPasswordReset(env, new URL(request.url).origin, { id: user.id, email: address });
  if (sent.state === 'failed') {
    return fail('EMAIL_NOT_SENT', `The account exists, but the reset email could not be sent (${(sent.reason ?? 'unknown error').replace(/\.$/, '')}). Ask a manager to reset your password in Users and roles.`, 502);
  }
  return json({ ok: true, sent: true });
};
