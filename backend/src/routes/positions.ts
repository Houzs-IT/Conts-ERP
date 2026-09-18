import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Vars } from '../lib/types';
import { requirePermission } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { badRequest, conflict, notFound, requestMeta } from '../lib/http';

export const positions = new Hono<{ Bindings: Env; Variables: Vars }>();

const bodySchema = z.object({
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(120),
  department_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
  is_active: z.boolean().optional(),
});

positions.get('/', requirePermission('settings.positions.view'), async (c) => {
  const rows = await c.get('db')`
    select pos.*, d.name as department_name
    from app.positions pos left join app.departments d on d.id = pos.department_id
    order by pos.sort_order, pos.name
  `;
  return c.json({ positions: rows });
});

positions.post('/', requirePermission('settings.positions.manage'), async (c) => {
  const db = c.get('db');
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw badRequest('Check the fields', parsed.error.flatten());
  const b = parsed.data;

  const [existing] = await db`select id from app.positions where code = ${b.code}`;
  if (existing) throw conflict(`A position with code ${b.code} already exists`);

  const [row] = await db`
    insert into app.positions (code, name, department_id, sort_order, is_active)
    values (${b.code}, ${b.name}, ${b.department_id ?? null}, ${b.sort_order ?? 0}, ${b.is_active ?? true})
    returning *
  `;
  await writeAudit(db, { actorId: c.get('auth').id, action: 'position.create', entity: 'position', entityId: row!.id as string, after: row, ...requestMeta(c) });
  return c.json({ position: row }, 201);
});

positions.patch('/:id', requirePermission('settings.positions.manage'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const parsed = bodySchema.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw badRequest('Check the fields', parsed.error.flatten());
  const b = parsed.data;

  const [before] = await db`select * from app.positions where id = ${id}`;
  if (!before) throw notFound('Position not found');

  const [after] = await db`
    update app.positions set
      code = ${b.code ?? before.code},
      name = ${b.name ?? before.name},
      department_id = ${b.department_id === undefined ? before.department_id : b.department_id},
      sort_order = ${b.sort_order ?? before.sort_order},
      is_active = ${b.is_active ?? before.is_active}
    where id = ${id} returning *
  `;
  await writeAudit(db, { actorId: c.get('auth').id, action: 'position.update', entity: 'position', entityId: id, before, after, ...requestMeta(c) });
  return c.json({ position: after });
});
