-- Projects by company (owner, 23 Nov 2026): a person sees the projects of their own company's brand. The Conts people
-- see The Conts brand projects, Dream Crafter people see Dream Crafter's, people on both companies see both
-- (PLAN-project-brand-access.md).
--
--   public.project_brands.side   which company the brand belongs to: 'conts', 'dream_crafter', or null for both.
--   public.conts_staff.side      the person's company: the department's, or the person's own "Works on" choice in a
--                                department on both companies (functions/_lib/access.ts sideSql). Management is 'both'.
--                                Appended last; the view's other columns and grants are unchanged.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0363, dry run first.
-- REVERSAL:
--   create or replace view public.conts_staff as <0299's definition>;  (drops the side column: recreate, not replace)
--   ALTER TABLE public.project_brands DROP COLUMN side;
--   select demo.sync();

ALTER TABLE public.project_brands ADD COLUMN IF NOT EXISTS side text
  CHECK (side IS NULL OR side IN ('conts', 'dream_crafter'));

UPDATE public.project_brands SET side = 'conts' WHERE side IS NULL AND lower(trim(name)) = 'the conts';
UPDATE public.project_brands SET side = 'dream_crafter' WHERE side IS NULL AND lower(trim(name)) = 'dream crafter';

create or replace view public.conts_staff as
  select u.id, u.full_name, u.email, nullif(trim(u.department), '') as department, nullif(trim(u.position), '') as position,
         (u.is_active = 1) as active, u.department_id, d.side as department_side, u.role, u.manager_id,
         case when d.kind = 'management' then 'both'
              when d.side in ('conts', 'dream_crafter') then d.side
              else coalesce(u.side, 'both') end as side
    from pos.users u
    left join pos.departments d on d.id = u.department_id
   where u.role <> 'owner';

select demo.sync();
