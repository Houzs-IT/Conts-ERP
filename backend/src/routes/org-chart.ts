import { Hono } from 'hono';
import type { Env, Vars } from '../lib/types';
import { requirePermission } from '../lib/auth';
import { signedAvatarUrl } from '../lib/supabase';

export const orgChart = new Hono<{ Bindings: Env; Variables: Vars }>();

type DeptRow = { id: string; code: string; name: string; parent_id: string | null; sort_order: number };
type PersonRow = {
  id: string; full_name: string; staff_code: string | null; email: string;
  department_id: string | null; position_name: string | null; reports_to: string | null; photo_path: string | null;
};

/**
 * The whole chart in one call: departments nested by parent, each with its
 * people, their position, manager and a temporary link to their photo.
 */
orgChart.get('/', requirePermission('orgchart.view'), async (c) => {
  const db = c.get('db');

  const departments = await db<DeptRow[]>`
    select id, code, name, parent_id, sort_order
    from app.departments where is_active order by sort_order, name
  `;
  const people = await db<PersonRow[]>`
    select p.id, p.full_name, p.staff_code, p.email, p.department_id,
           pos.name as position_name, p.reports_to, p.photo_path
    from app.profiles p
    left join app.positions pos on pos.id = p.position_id
    where p.is_active
    order by p.full_name
  `;

  const withPhotos = await Promise.all(
    people.map(async (p) => ({
      id: p.id,
      full_name: p.full_name,
      staff_code: p.staff_code,
      email: p.email,
      position: p.position_name,
      reports_to: p.reports_to,
      department_id: p.department_id,
      photo_url: p.photo_path ? await signedAvatarUrl(c.env, p.photo_path) : null,
    })),
  );

  const byDept = new Map<string | null, typeof withPhotos>();
  for (const person of withPhotos) {
    const list = byDept.get(person.department_id) ?? [];
    list.push(person);
    byDept.set(person.department_id, list);
  }

  const build = (parentId: string | null): unknown[] =>
    departments
      .filter((d) => d.parent_id === parentId)
      .map((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        people: byDept.get(d.id) ?? [],
        children: build(d.id),
      }));

  return c.json({
    departments: build(null),
    unassigned: byDept.get(null) ?? [],
  });
});
