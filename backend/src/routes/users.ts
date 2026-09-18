import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Vars } from '../lib/types';
import { requirePermission } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound, requestMeta } from '../lib/http';
import { inviteUser, setAuthUserBanned, signedAvatarUrl, uploadAvatar } from '../lib/supabase';

export const users = new Hono<{ Bindings: Env; Variables: Vars }>();

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  full_name: z.string().trim().min(1).max(120),
  role_ids: z.array(z.string().uuid()).min(1, 'Give the user at least one role'),
  staff_code: z.string().trim().max(32).optional(),
  phone: z.string().trim().max(32).optional(),
  department_id: z.string().uuid().nullable().optional(),
  position_id: z.string().uuid().nullable().optional(),
  reports_to: z.string().uuid().nullable().optional(),
});

const updateSchema = z.object({
  full_name: z.string().trim().min(1).max(120).optional(),
  staff_code: z.string().trim().max(32).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  position_id: z.string().uuid().nullable().optional(),
  reports_to: z.string().uuid().nullable().optional(),
});

users.get('/', requirePermission('settings.users.view'), async (c) => {
  const db = c.get('db');
  const search = c.req.query('q')?.trim();
  const includeInactive = c.req.query('include_inactive') === 'true';

  const rows = await db`
    select p.id, p.staff_code, p.full_name, p.email, p.phone, p.is_active,
           p.department_id, d.name as department_name,
           p.position_id, pos.name as position_name,
           p.reports_to, m.full_name as manager_name,
           coalesce(json_agg(json_build_object('id', r.id, 'code', r.code, 'name', r.name))
                    filter (where r.id is not null), '[]') as roles
    from app.profiles p
    left join app.departments d on d.id = p.department_id
    left join app.positions pos on pos.id = p.position_id
    left join app.profiles m on m.id = p.reports_to
    left join app.user_roles ur on ur.user_id = p.id
    left join app.roles r on r.id = ur.role_id
    where (${includeInactive} or p.is_active)
      and (${search ?? null}::text is null
           or p.full_name ilike ${'%' + (search ?? '') + '%'}
           or p.email ilike ${'%' + (search ?? '') + '%'}
           or coalesce(p.staff_code, '') ilike ${'%' + (search ?? '') + '%'})
    group by p.id, d.name, pos.name, m.full_name
    order by p.full_name
  `;
  return c.json({ users: rows });
});

users.get('/:id', requirePermission('settings.users.view'), async (c) => {
  const db = c.get('db');
  const [row] = await db`
    select p.*, d.name as department_name, pos.name as position_name, m.full_name as manager_name
    from app.profiles p
    left join app.departments d on d.id = p.department_id
    left join app.positions pos on pos.id = p.position_id
    left join app.profiles m on m.id = p.reports_to
    where p.id = ${c.req.param('id')}
  `;
  if (!row) throw notFound('User not found');
  const roles = await db`select r.id, r.code, r.name from app.user_roles ur join app.roles r on r.id = ur.role_id where ur.user_id = ${row.id}`;
  return c.json({
    user: { ...row, photo_url: row.photo_path ? await signedAvatarUrl(c.env, row.photo_path as string) : null },
    roles,
  });
});

/**
 * Invite a new user: Supabase emails them a set-password link, and we create
 * the profile and roles now so their access is ready when they first sign in.
 */
users.post('/invite', requirePermission('settings.users.create'), async (c) => {
  const db = c.get('db');
  const auth = c.get('auth');
  const parsed = inviteSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw badRequest('Check the fields', parsed.error.flatten());
  const b = parsed.data;

  const [dupe] = await db`select id from app.profiles where lower(email) = ${b.email}`;
  if (dupe) throw conflict('Someone already uses that email');

  const validRoles = await db<{ id: string }[]>`select id from app.roles where id = any(${b.role_ids}::uuid[])`;
  if (validRoles.length !== b.role_ids.length) throw badRequest('One of the roles does not exist');

  const authUser = await inviteUser(c.env, b.email, b.full_name, `${c.env.PUBLIC_APP_URL ?? ''}/set-password`);

  const [profile] = await db`
    insert into app.profiles (id, email, full_name, staff_code, phone, department_id, position_id, reports_to)
    values (${authUser.id}, ${b.email}, ${b.full_name}, ${b.staff_code ?? null}, ${b.phone ?? null},
            ${b.department_id ?? null}, ${b.position_id ?? null}, ${b.reports_to ?? null})
    returning *
  `;
  for (const roleId of b.role_ids) {
    await db`insert into app.user_roles (user_id, role_id, granted_by) values (${authUser.id}, ${roleId}, ${auth.id}) on conflict do nothing`;
  }
  await db`
    insert into app.invitations (email, full_name, role_id, department_id, position_id, invited_by, auth_user_id)
    values (${b.email}, ${b.full_name}, ${b.role_ids[0]!}, ${b.department_id ?? null}, ${b.position_id ?? null}, ${auth.id}, ${authUser.id})
  `;
  await writeAudit(db, { actorId: auth.id, action: 'user.invite', entity: 'profile', entityId: authUser.id, after: profile, ...requestMeta(c) });
  return c.json({ user: profile }, 201);
});

users.patch('/:id', requirePermission('settings.users.edit'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw badRequest('Check the fields', parsed.error.flatten());
  const b = parsed.data;

  const [before] = await db`select * from app.profiles where id = ${id}`;
  if (!before) throw notFound('User not found');
  if (b.reports_to === id) throw badRequest('Someone cannot report to themselves');

  const [after] = await db`
    update app.profiles set
      full_name = ${b.full_name ?? before.full_name},
      staff_code = ${b.staff_code === undefined ? before.staff_code : b.staff_code},
      phone = ${b.phone === undefined ? before.phone : b.phone},
      department_id = ${b.department_id === undefined ? before.department_id : b.department_id},
      position_id = ${b.position_id === undefined ? before.position_id : b.position_id},
      reports_to = ${b.reports_to === undefined ? before.reports_to : b.reports_to}
    where id = ${id} returning *
  `;
  await writeAudit(db, { actorId: c.get('auth').id, action: 'user.update', entity: 'profile', entityId: id, before, after, ...requestMeta(c) });
  return c.json({ user: after });
});

/** Replace someone's roles in one call. Needs the role-management permission. */
users.put('/:id/roles', requirePermission('settings.roles.manage'), async (c) => {
  const db = c.get('db');
  const auth = c.get('auth');
  const id = c.req.param('id');
  const parsed = z.object({ role_ids: z.array(z.string().uuid()) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw badRequest('Send role_ids as a list', parsed.error.flatten());

  const [target] = await db`select id from app.profiles where id = ${id}`;
  if (!target) throw notFound('User not found');

  const before = await db`select role_id from app.user_roles where user_id = ${id}`;
  const removesOwnOwner =
    id === auth.id &&
    auth.roles.some((r) => r.code === 'owner') &&
    !(await db<{ id: string }[]>`select id from app.roles where code = 'owner' and id = any(${parsed.data.role_ids}::uuid[])`).length;
  if (removesOwnOwner) throw forbidden('You cannot remove your own Owner role');

  await db.begin(async (tx) => {
    await tx`delete from app.user_roles where user_id = ${id}`;
    for (const roleId of parsed.data.role_ids) {
      await tx`insert into app.user_roles (user_id, role_id, granted_by) values (${id}, ${roleId}, ${auth.id})`;
    }
  });
  const after = await db`select role_id from app.user_roles where user_id = ${id}`;
  await writeAudit(db, { actorId: auth.id, action: 'user.roles.set', entity: 'profile', entityId: id, before, after, ...requestMeta(c) });
  return c.json({ roles: after });
});

users.post('/:id/deactivate', requirePermission('settings.users.deactivate'), async (c) => {
  const db = c.get('db');
  const auth = c.get('auth');
  const id = c.req.param('id');
  if (id === auth.id) throw forbidden('You cannot deactivate yourself');

  const [before] = await db`select * from app.profiles where id = ${id}`;
  if (!before) throw notFound('User not found');

  const [after] = await db`update app.profiles set is_active = false where id = ${id} returning *`;
  await setAuthUserBanned(c.env, id, true);
  await writeAudit(db, { actorId: auth.id, action: 'user.deactivate', entity: 'profile', entityId: id, before, after, ...requestMeta(c) });
  return c.json({ user: after });
});

users.post('/:id/reactivate', requirePermission('settings.users.deactivate'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const [before] = await db`select * from app.profiles where id = ${id}`;
  if (!before) throw notFound('User not found');

  const [after] = await db`update app.profiles set is_active = true where id = ${id} returning *`;
  await setAuthUserBanned(c.env, id, false);
  await writeAudit(db, { actorId: c.get('auth').id, action: 'user.reactivate', entity: 'profile', entityId: id, before, after, ...requestMeta(c) });
  return c.json({ user: after });
});

/**
 * Photo upload. Anyone may change their own; changing someone else's needs the
 * user-edit permission. Send the raw image bytes with a matching content-type.
 */
users.post('/:id/photo', async (c) => {
  const db = c.get('db');
  const auth = c.get('auth');
  const id = c.req.param('id');
  if (id !== auth.id && !auth.permissions.has('settings.users.edit')) throw forbidden('You may only change your own photo');

  const contentType = c.req.header('content-type') ?? '';
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(contentType)) throw badRequest('Photo must be JPEG, PNG or WebP');

  const body = await c.req.arrayBuffer();
  if (body.byteLength > 2_000_000) throw badRequest('Photo must be under 2 MB');

  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const storedPath = await uploadAvatar(c.env, `${id}/profile-${Date.now()}.${ext}`, contentType, body);

  const [before] = await db`select photo_path from app.profiles where id = ${id}`;
  if (!before) throw notFound('User not found');
  const [after] = await db`update app.profiles set photo_path = ${storedPath} where id = ${id} returning id, photo_path`;
  await writeAudit(db, { actorId: auth.id, action: 'user.photo.set', entity: 'profile', entityId: id, before, after, ...requestMeta(c) });

  return c.json({ photo_url: await signedAvatarUrl(c.env, storedPath) });
});
