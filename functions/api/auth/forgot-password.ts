import { type Env, one, run, json } from '../../_lib/db';
import { notify } from '../../_lib/notify';

/** Always 200, always the same body. Never discloses whether an account exists. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { email } = await request.json<{ email: string }>();
  const user = await one<{ id: string }>(env, 'SELECT id FROM users WHERE email = ?', (email ?? '').toLowerCase().trim());

  if (user) {
    const token = crypto.randomUUID();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
      .map(b => b.toString(16).padStart(2, '0')).join('');
    await run(env,
      'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
      hash, user.id, new Date(Date.now() + 60 * 60000).toISOString(), new Date().toISOString());
    // The token leaves the server only inside the email body. It is never logged,
    // never returned, and only its hash is stored.
    const origin = new URL(request.url).origin;
    await notify(env, {
      template: 'account.password_reset',
      recipient: email.toLowerCase().trim(),
      channel: 'email',
      subject: 'Reset your Property OS password',
      body: `Use this link to choose a new password:\n\n${origin}/#/reset-password?token=${token}\n\nThe link expires in 60 minutes. If you did not ask for this, you can ignore this email.`,
      // Keyed by the token, not the user: notify()'s dedup collapses same-hour
      // calls sharing a template+entity, and a fresh "resend" makes a genuinely
      // new token each time — keying on user.id would silently drop every resend
      // within the same clock hour as the first request.
      entityTable: 'password_reset_tokens', entityId: hash,
      urgent: true,
    });
  }

  return json({ ok: true });
};
