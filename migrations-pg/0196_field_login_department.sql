-- REVERSAL: none needed; it only fills department_id where it was empty (set it back by hand on Users and roles).
-- Field logins take their roster's department (finance, chew 2 Nov 2026): a technician's login goes in Maintenance and a
-- cleaner's in Cleaning, so their petty cash receipts come off that department's float (engine conts/petty-cash.ts
-- resolveFloatId reads users.department_id). functions/_lib/fieldAccess.ts now does this on "Give app access"; this
-- fills the logins made before it. Only a login with no department is touched; a person on both rosters goes in
-- Maintenance (technicians first), and an office login linked to a roster keeps its own department.
-- Numbered 0196: 0195 (receipt_line_tags) is the last on production; 0193 is on main, not yet applied.
-- APPLY: by hand, in one transaction with its public.pos_migrations row.

set local search_path = pos, public;
set local lock_timeout = '5s';

update pos.users u
   set department_id = (select id from pos.departments where kind = 'maintenance' order by sort, name limit 1)
 where u.department_id is null
   and (u.role = 'technician' or exists (select 1 from pos.technicians t where t.user_id = u.id));

update pos.users u
   set department_id = (select id from pos.departments where kind = 'cleaning' order by sort, name limit 1)
 where u.department_id is null
   and (u.role = 'housekeeper' or exists (select 1 from pos.cleaners c where c.user_id = u.id));
