-- REVERSAL: none kept (the department was empty before; set it back by hand on the person if needed).
-- Renovation employees' logins had no department (chew, 18 Nov 2026: CK 1's claim fell to Company, The Conts): the
-- field login took its roster's department for cleaners and technicians only. Each Renovation employee's login with no
-- department now takes their brand's: The Conts -> In-house Renovation, Dream Crafter -> Renovation (no brand yet:
-- In-house Renovation). New logins get it from functions/_lib/fieldAccess.ts.
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0337, dry run first.

set local search_path = pos, public;
set local lock_timeout = '5s';

update pos.users u
   set department_id = d.id, updated_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  from pos.renovators r
  left join public.project_brands b on b.id = r.brand_id
  join pos.departments d on d.name = case when b.name ilike '%dream%' then 'Renovation' else 'In-house Renovation' end
 where r.user_id = u.id and u.department_id is null;
