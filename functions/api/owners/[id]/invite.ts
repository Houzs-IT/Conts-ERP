import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, hashPassword } from '../../../_lib/auth';
import { notify } from '../../../_lib/notify';

/** POST /api/owners/:id/invite — creates the owner's portal login with a temporary password, emailed to them and never returned. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!['management', 'operations_manager'].includes(session.role)) return fail('FORBIDDEN', 'Only management and operations managers can invite owners.', 403);

  const id = String(params.id);
  const owner = await one<any>(env, 'SELECT id, display_name, email, phone, user_id FROM owners WHERE id = ?', id);
  if (!owner) return fail('NOT_FOUND', 'That owner no longer exists.', 404);
  if (owner.user_id) return fail('ALREADY_INVITED', 'This owner already has a portal login.', 409);
  if (!owner.email || !String(owner.email).includes('@')) return fail('VALIDATION', 'Add the owner\'s email address first.', 422, { email: 'This owner has no email on file.' });
  if (await one(env, 'SELECT 1 AS x FROM users WHERE lower(email) = lower(?)', owner.email)) return fail('DUPLICATE', 'A login already uses that email address.', 409);

  const temp = crypto.randomUUID().slice(0, 12) + 'A1';
  const userId = crypto.randomUUID(), now = nowIso();
  await run(env, `
    INSERT INTO users (id, email, full_name, phone, password_hash, role, must_change_password, locale, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'owner', 1, 'en-MY', 1, ?, ?)`, userId, owner.email.toLowerCase().trim(), owner.display_name, owner.phone, await hashPassword(temp), now, now);
  await run(env, 'UPDATE owners SET user_id = ?, updated_at = ? WHERE id = ?', userId, now, id);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner.invite', entityTable: 'owners', entityId: id, after: { userId } });
  await notify(env, {
    template: 'account.invited', recipient: owner.email, channel: 'email', subject: 'Your Conts owner portal',
    body: `${session.fullName} created your owner portal account.\n\nEmail: ${owner.email}\nTemporary password: ${temp}\n\nYou will be asked to choose a new password when you first sign in.`,
    entityTable: 'users', entityId: userId,
  });
  return json({ ok: true, userId }, 201);
};
