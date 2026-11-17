-- Category access reads the product categories the engine keeps (scm.product_category_groups, scm.product_sub_categories)
-- instead of a copy in code. The copy fell behind: the Raw material group (migration 0190) and every group added under
-- Item Groups could not be ticked, so people limited by category never saw those lines.
-- The two tables have row level security with no policy for pos_app, so Property OS reads no rows from them. This
-- function, run as its owner, gives pos_app the codes, labels, order and whether each sub-category is shown: nothing
-- else, and nothing can be changed through it. Same shape as pos.utility_payment_requests (migration 0220).
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0317, dry run first.
-- Until it is applied the Category access page says it needs a database update (503 NOT_MIGRATED).
-- REVERSAL: drop function pos.product_category_catalog();
create or replace function pos.product_category_catalog()
returns table (group_code text, group_label text, sub_code text, sub_label text, sub_active boolean)
language sql stable security definer
set search_path = ''
as $$
  select g.code, g.label, s.code, s.label, s.active
  from scm.product_category_groups g
  left join scm.product_sub_categories s on s.group_code = g.code
  order by g.sort_order, g.code, s.sort_order, s.code
$$;

revoke all on function pos.product_category_catalog() from public;
grant execute on function pos.product_category_catalog() to pos_app;
