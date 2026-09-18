import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Vars } from '../lib/types';
import { requirePermission } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound, requestMeta } from '../lib/http';

export const roles = new Hono<{ Bindings: Env; Variables: Vars }>();

roles.get('/', requirePermission('settings.roles.view'), async (c) => {
  const db = c.get('db');
  const rows = await db`
    select r.*,
           (select count(*) from app.user_roles ur where ur.role_id = r.id) as user_count,
           coalesce((select json_agg(rp.permission_code order by rp.permission_code)
                     from app.role_permissions rp where rp.role_id = r.id), '[]') as permissions,
           coalesce((select json_agg(rpg.page_key order by rpg.page_key)
                     from app.role_pages rpg where rpg.role_id = r.id), '[]') as pages
    from app.roles r order by r.is_system desc, r.name
  `;
  return c.json({ roles: rows });
});

/** The full catalogue, so the UI can draw the permission checkboxes. */
roles.get('/catalogue', requirePermission('settings.roles.view'), async (c) => {
  const db = c.get('db');
  const permissions = await db`select code, module, description from app.permissions order by module, code`;
  const pages = await db`select key, label, path, module, sort_order from app.pages order by sort_order`;
  return c.json({ permissions, pages });
});

roles.post('/', requirePermission('settings.roles.manage'), async (c) => {
  const db = c.get('db');
  const parsed = z.object({
    code: z.string().trim().min(1).max(32).regex(/^[a-z0-9_-]+$/, 'Lowercase letters, numbers, - and _'),
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(200).optional(),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw badRequest('Check the fields', parsed.error.flatten());

  const [existing] = await db`select id from app.roles where code = ${parsed.data.code}`;
  if (existing) throw conflict('A role with that code already exists');

  const [row] = await db`
    insert into app.roles (code, name, description) values (${parsed.data.code}, ${parsed.data.name}, ${parsed.data.description ?? null})
    returning *
  `;
  await writeAudit(db, { actorId: c.get('auth').id, action: 'role.create', entity: 'role', entityId: row!.id as string, after: row, ...requestMeta(c) });
  return c.json({ role: row }, 201);
});

roles.put('/:id/permissions', requirePermission('settings.roles.manage'), async (c) => {
  const db = c.get('db');
  const auth = c.get('auth');
  const id = c.req.param('id');
  const parsed = z.object({ permissions: z.array(z.string()) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw badRequest('Send permissions as a list', parsed.error.flatten());

  const [role] = await db<{ id: string; code: string }[]>`select id, code from app.roles where id = ${id}`;
  if (!role) throw notFound('Role not found');
  // The Owner role is the last way back in if a permission set goes wrong.
  if (role.code === 'owner') throw forbidden('The Owner role always keeps every permission');

  const known = await db<{ code: string }[]>`select code from app.permissions where code = any(${parsed.data.permissions}::text[])`;
  if (known.length !== parsed.data.permissions.length) throw badRequest('One of those permissions does not exist');

  const before = await db`select permission_code from app.role_permissions where role_id = ${id}`;
  await db.begin(async (tx) => {
    await tx`delete from app.role_permissions where role_id = ${id}`;
    for (const code of parsed.data.permissions) {
      await tx`insert into app.role_permissions (role_id, permission_code) values (${id}, ${code})`;
    }
  });
  const after = await db`select permission_code from app.role_permissions where role_id = ${id}`;
  await writeAudit(db, { actorId: auth.id, action: 'role.permissions.set', entity: 'role', entityId: id, before, after, ...requestMeta(c) });
  return c.json({ permissions: after });
});

roles.put('/:id/pages', requirePermission('settings.roles.manage'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const parsed = z.object({ pages: z.array(z.string()) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw badRequest('Send pages as a list', parsed.error.flatten());

  const [role] = await db`select id from app.roles where id = ${id}`;
  if (!role) throw notFound('Role not found');

  const before = await db`select page_key from app.role_pages where role_id = ${id}`;
  await db.begin(async (tx) => {
    await tx`delete from app.role_pages where role_id = ${id}`;
    for (const key of parsed.data.pages) {
      await tx`insert into app.role_pages (role_id, page_key) values (${id}, ${key})`;
    }
  });
  const after = await db`select page_key from app.role_pages where role_id = ${id}`;
  await writeAudit(db, { actorId: c.get('auth').id, action: 'role.pages.set', entity: 'role', entityId: id, before, after, ...requestMeta(c) });
  return c.json({ pages: after });
});

roles.delete('/:id', requirePermission('settings.roles.manage'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const [role] = await db<{ id: string; code: string; is_system: boolean }[]>`select id, code, is_system from app.roles where id = ${id}`;
  if (!role) throw notFound('Role not found');
  if (role.is_system) throw forbidden('Built-in roles cannot be deleted');

  const [{ count } = { count: '0' }] = await db<{ count: string }[]>`select count(*)::text as count from app.user_roles where role_id = ${id}`;
  if (Number(count) > 0) throw conflict(`${count} users still have this role`);

  await db`delete from app.roles where id = ${id}`;
  await writeAudit(db, { actorId: c.get('auth').id, action: 'role.delete', entity: 'role', entityId: id, before: role, ...requestMeta(c) });
  return c.json({ deleted: true });
});
