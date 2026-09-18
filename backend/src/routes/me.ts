import { Hono } from 'hono';
import type { Env, Vars } from '../lib/types';
import { signedAvatarUrl } from '../lib/supabase';

export const me = new Hono<{ Bindings: Env; Variables: Vars }>();

/** Who am I, what may I do, which pages may I open. The UI calls this on load. */
me.get('/', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');

  const [profile] = await db<{
    id: string; staff_code: string | null; full_name: string; email: string; phone: string | null;
    department_id: string | null; department_name: string | null;
    position_id: string | null; position_name: string | null;
    reports_to: string | null; photo_path: string | null;
  }[]>`
    select p.id, p.staff_code, p.full_name, p.email, p.phone,
           p.department_id, d.name as department_name,
           p.position_id, pos.name as position_name,
           p.reports_to, p.photo_path
    from app.profiles p
    left join app.departments d on d.id = p.department_id
    left join app.positions pos on pos.id = p.position_id
    where p.id = ${auth.id}
  `;

  const pages = await db<{ key: string; label: string; path: string; module: string; sort_order: number }[]>`
    select distinct pg.key, pg.label, pg.path, pg.module, pg.sort_order
    from app.role_pages rp
    join app.pages pg on pg.key = rp.page_key
    join app.user_roles ur on ur.role_id = rp.role_id
    where ur.user_id = ${auth.id}
    order by pg.sort_order
  `;

  return c.json({
    user: {
      ...profile,
      photo_url: profile?.photo_path ? await signedAvatarUrl(c.env, profile.photo_path) : null,
    },
    roles: auth.roles,
    permissions: [...auth.permissions].sort(),
    pages,
  });
});
