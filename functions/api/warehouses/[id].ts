import { type Env, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { strOrNull, flag } from '../../_lib/scm-util';

/** PATCH /api/warehouses/:id — setting it default clears any other default. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit warehouses.', 403);

  const id = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM warehouses WHERE id = ?', id)) return fail('NOT_FOUND', 'That warehouse does not exist.', 404);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const sets: string[] = [];
  const args: unknown[] = [];

  if (b.code !== undefined) {
    const code = String(b.code).trim();
    if (!code) return fail('VALIDATION', 'Enter a warehouse code.', 422, { code: 'Enter a warehouse code.' });
    if (await one(env, 'SELECT 1 AS x FROM warehouses WHERE lower(code) = lower(?) AND id <> ?', code, id)) {
      return fail('CONFLICT', 'A warehouse with this code already exists.', 409, { code: 'This code is already used.' });
    }
    sets.push('code = ?'); args.push(code);
  }
  if (b.name !== undefined) { const name = String(b.name).trim(); if (!name) return fail('VALIDATION', 'Enter a name.', 422, { name: 'Enter a name.' }); sets.push('name = ?'); args.push(name); }
  if (b.location !== undefined) { sets.push('location = ?'); args.push(strOrNull(b.location)); }
  if (b.isActive !== undefined) { sets.push('is_active = ?'); args.push(flag(b.isActive) ?? 1); }
  if (b.isDefault !== undefined && flag(b.isDefault) === 1) {
    await run(env, 'UPDATE warehouses SET is_default = 0, updated_at = ? WHERE id <> ?', nowIso(), id);
    sets.push('is_default = ?'); args.push(1);
  } else if (b.isDefault !== undefined) {
    sets.push('is_default = ?'); args.push(0);
  }

  if (!sets.length) return json({ id });
  sets.push('updated_at = ?'); args.push(nowIso());
  args.push(id);
  await run(env, `UPDATE warehouses SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'warehouse.update', entityTable: 'warehouses', entityId: id, after: b });
  return json({ id });
};

/** DELETE /api/warehouses/:id */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete warehouses.', 403);

  const id = String(params.id);
  const cur = await one<{ code: string }>(env, 'SELECT code FROM warehouses WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That warehouse does not exist.', 404);
  await run(env, 'DELETE FROM warehouses WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'warehouse.delete', entityTable: 'warehouses', entityId: id, before: { code: cur.code } });
  return new Response(null, { status: 204 });
};
