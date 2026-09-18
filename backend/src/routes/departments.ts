import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Vars } from '../lib/types';
import { requirePermission } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { badRequest, conflict, notFound, requestMeta } from '../lib/http';

export const departments = new Hono<{ Bindings: Env; Variables: Vars }>();

const bodySchema = z.object({
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, - and _ only'),
  name: z.string().trim().min(1).max(120),
  parent_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
  is_active: z.boolean().optional(),
});

departments.get('/', requirePermission('settings.departments.view'), async (c) => {
  const db = c.get('db');
  const rows = await db`
    select d.*, (select count(*) from app.profiles p where p.department_id = d.id and p.is_active) as staff_count
    from app.departments d order by d.sort_order, d.name
  `;
  return c.json({ departments: rows });
});

departments.post('/', requirePermission('settings.departments.manage'), async (c) => {
  const db = c.get('db');
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw badRequest('Check the fields', parsed.error.flatten());
  const b = parsed.data;

  const [existing] = await db`select id from app.departments where code = ${b.code}`;
  if (existing) throw conflict(`A department with code ${b.code} already exists`);

  const [row] = await db`
    insert into app.departments (code, name, parent_id, sort_order, is_active)
    values (${b.code}, ${b.name}, ${b.parent_id ?? null}, ${b.sort_order ?? 0}, ${b.is_active ?? true})
    returning *
  `;
  await writeAudit(db, { actorId: c.get('auth').id, action: 'department.create', entity: 'department', entityId: row!.id as string, after: row, ...requestMeta(c) });
  return c.json({ department: row }, 201);
});

departments.patch('/:id', requirePermission('settings.departments.manage'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const parsed = bodySchema.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw badRequest('Check the fields', parsed.error.flatten());
  const b = parsed.data;

  const [before] = await db`select * from app.departments where id = ${id}`;
  if (!before) throw notFound('Department not found');
  if (b.parent_id === id) throw badRequest('A department cannot be its own parent');

  const [after] = await db`
    update app.departments set
      code = ${b.code ?? before.code},
      name = ${b.name ?? before.name},
      parent_id = ${b.parent_id === undefined ? before.parent_id : b.parent_id},
      sort_order = ${b.sort_order ?? before.sort_order},
      is_active = ${b.is_active ?? before.is_active}
    where id = ${id} returning *
  `;
  await writeAudit(db, { actorId: c.get('auth').id, action: 'department.update', entity: 'department', entityId: id, before, after, ...requestMeta(c) });
  return c.json({ department: after });
});

/** Deactivate rather than delete, so history and the audit trail stay readable. */
departments.delete('/:id', requirePermission('settings.departments.manage'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const [before] = await db`select * from app.departments where id = ${id}`;
  if (!before) throw notFound('Department not found');

  const [{ count } = { count: '0' }] = await db<{ count: string }[]>`
    select count(*)::text as count from app.profiles where department_id = ${id} and is_active
  `;
  if (Number(count) > 0) throw conflict(`Move the ${count} people in this department first`);

  const [after] = await db`update app.departments set is_active = false where id = ${id} returning *`;
  await writeAudit(db, { actorId: c.get('auth').id, action: 'department.deactivate', entity: 'department', entityId: id, before, after, ...requestMeta(c) });
  return c.json({ department: after });
});
