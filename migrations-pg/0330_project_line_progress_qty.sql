-- REVERSAL: select demo.drop_views(); alter table public.project_line_progress drop constraint if exists project_line_progress_done_qty_check, drop column if exists done_qty; select demo.sync();
-- Renovation line progress counts units (owner, 16 Nov 2026): a line of qty 3 can be 2 of 3 done. done_qty is how many
-- units are done; a row with done_qty below the line's qty is partly done, at the line's qty it is done, and no row means
-- none done (saving 0 deletes the row). The trade's site task still closes only when every line of the trade is fully
-- done. done_at is when the count last changed. Rows written by 0329 meant "done", so they take their line's qty.
--
-- APPLY: with or right after 0329 (staging first: node scripts/migrate-pg.mjs --only=0330; production through the
-- workflow "Apply migrations to production" with only=0329,0330, dry run first).
select demo.drop_views();
set local search_path = public, extensions;
set local lock_timeout = '5s';

alter table public.project_line_progress add column if not exists done_qty numeric(12, 3);
update public.project_line_progress lp set done_qty = i.qty
  from scm.mfg_sales_order_items i where i.id = lp.so_item_id and lp.done_qty is null;
alter table public.project_line_progress alter column done_qty set not null;
alter table public.project_line_progress drop constraint if exists project_line_progress_done_qty_check;
alter table public.project_line_progress add constraint project_line_progress_done_qty_check check (done_qty > 0);

select demo.sync();
