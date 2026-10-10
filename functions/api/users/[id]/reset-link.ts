import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';

const MANAGE = ['management'];
const MINUTES = 60;

/**
 * POST /api/users/:id/reset-link — a one-time password reset link that management hands to the person
 * themselves (WhatsApp, in person), for when the reset email cannot reach them: no mail provider set up,
 * or an inbox they cannot open. Same token, expiry and single use as the emailed link (forgot-password.ts,
 * reset-password.ts). The link is returned once and never stored or logged; only its hash is kept.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MANAGE.includes(session.role)) return fail('FORBIDDEN', 'Only management can make a reset link.', 403);

  const id = String(params.id);
  const user = await one<{ id: string; email: string; is_active: number }>(env, 'SELECT id, email, is_active FROM users WHERE id = ?', id);
  if (!user) return fail('NOT_FOUND', 'That account no longer exists.', 404);
  if (!user.is_active) return fail('VALIDATION', 'Turn the account back on before making a reset link.', 422);

  const token = crypto.randomUUID();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const expiresAt = new Date(Date.now() + MINUTES * 60000).toISOString();
  await run(env, 'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    hash, id, expiresAt, nowIso());
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'user.reset_link', entityTable: 'users', entityId: id, after: { expiresAt } });

  const link = `${new URL(request.url).origin}/#/reset-password?token=${token}`;
  return json({ link, expiresAt, email: user.email });
};
