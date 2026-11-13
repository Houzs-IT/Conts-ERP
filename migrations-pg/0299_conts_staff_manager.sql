-- The reporting line (System > Users > Reports to) for the engine, so a Dream Crafter manager sees the projects of the
-- people who report to them (feedback list, 11 Nov 2026). Only appends manager_id: 0178's columns and grants are unchanged.
create or replace view public.conts_staff as
  select u.id, u.full_name, u.email, nullif(trim(u.department), '') as department, nullif(trim(u.position), '') as position,
         (u.is_active = 1) as active, u.department_id, d.side as department_side, u.role, u.manager_id
    from pos.users u
    left join pos.departments d on d.id = u.department_id
   where u.role <> 'owner';
