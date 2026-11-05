-- REVERSAL: drop function scm.purge_test_data(boolean, text);
-- The owner's one-off clear of testing data (5 Nov 2026): TESTING projects go whole, and every PO on them, on DEMO
-- Residence, on CURVO 1234 or on no project goes with its full flow (GRN, stock, production, DO, invoices, journals).
-- One function, one transaction: the Workers free plan allows 50 outside calls a request, and a half-finished clear
-- would leave stock and books disagreeing. p_commit false runs the same deletes and rolls them back, so the preview
-- the owner reads is the exact result. It only ever runs from the owner's button; removed once used.
set local search_path = scm, public, extensions;

create or replace function scm.purge_test_data(p_commit boolean, p_actor text default null)
returns jsonb
language plpgsql
security definer
set search_path = scm, public
as $fn$
declare
  v_cut constant timestamptz := timestamptz '2026-11-06 00:00:00+08';
  v_tables constant text[] := array[
    'scm.purchase_orders', 'scm.purchase_order_items', 'scm.po_amendments', 'scm.grns', 'scm.grn_items',
    'scm.production_orders', 'scm.delivery_orders', 'scm.inventory_lots', 'scm.inventory_movements',
    'scm.sales_invoices', 'scm.journal_entries', 'scm.mfg_sales_orders', 'scm.mfg_sales_order_payments',
    'scm.reno_so_contracts', 'scm.reno_quotations', 'scm.reno_variation_orders', 'public.project_design_files',
    'public.projects'];
  v_t text;
  v_proj int[];
  v_keep int[];
  v_all int[];
  v_so text[];
  v_keep_so text[];
  v_po text[];
  v_grn text[];
  v_pro text[];
  v_do text[];
  v_docs text[];
  v_po_numbers text[];
  v_names text[];
  v_before jsonb := '{}';
  v_counts jsonb := '{}';
  v_n bigint;
  v_m bigint;
  v_result jsonb;
  r record;
begin
  select coalesce(array_agg(id), '{}'), coalesce(array_agg(name order by name), '{}') into v_proj, v_names
    from public.projects where name ilike 'TESTING %';
  select coalesce(array_agg(id), '{}') into v_keep from public.projects
   where (id = 97 and name = 'DEMO Residence DEMO-12-3') or (id = 264 and name = 'CURVO 1234');
  v_all := v_proj || v_keep;
  select coalesce(array_agg(doc_no), '{}') into v_so from scm.mfg_sales_orders where project_id = any(v_proj);
  select coalesce(array_agg(doc_no), '{}') into v_keep_so from scm.mfg_sales_orders where project_id = any(v_keep);
  select coalesce(array_agg(id::text), '{}'), coalesce(array_agg(po_number order by po_number), '{}') into v_po, v_po_numbers
    from scm.purchase_orders where project_id = any(v_all) or (project_id is null and created_at < v_cut);
  select coalesce(array_agg(id::text), '{}') into v_grn from scm.grns
   where purchase_order_id::text = any(v_po) or project_id = any(v_all);
  select coalesce(array_agg(id::text), '{}') into v_pro from scm.production_orders
   where source_po_id::text = any(v_po) or project_id = any(v_all)
      or (project_id is null and source_po_id is null and created_at < v_cut);
  select coalesce(array_agg(id::text), '{}') into v_do from scm.delivery_orders
   where so_doc_no = any(v_so || v_keep_so) or project_id = any(v_all);
  v_docs := v_po_numbers
    || (select coalesce(array_agg(grn_number), '{}') from scm.grns where id::text = any(v_grn))
    || (select coalesce(array_agg(po_number), '{}') from scm.production_orders where id::text = any(v_pro))
    || (select coalesce(array_agg(do_number), '{}') from scm.delivery_orders where id::text = any(v_do));

  foreach v_t in array v_tables loop
    execute format('select count(*) from %s', v_t) into v_n;
    v_before := v_before || jsonb_build_object(v_t, v_n);
  end loop;

  begin
    -- Stock first: a delivery order with movements refuses to be deleted.
    delete from scm.inventory_lot_consumptions where source_doc_no = any(v_docs);
    delete from scm.inventory_movements where source_doc_no = any(v_docs);
    delete from scm.inventory_lots where source_doc_no = any(v_docs);

    delete from scm.delivery_returns where delivery_order_id::text = any(v_do);
    delete from scm.sales_invoices where so_doc_no = any(v_so) or project_id = any(v_proj);
    delete from scm.journal_entries
     where source_doc_no = any(v_so) or regexp_replace(source_doc_no, '-\d+$', '') = any(v_so);
    delete from scm.delivery_orders where id::text = any(v_do);
    delete from scm.grns where id::text = any(v_grn);
    -- A PO line can point at a production material and a production order at its PO, so one link is broken first.
    update scm.production_orders set source_po_id = null where id::text = any(v_pro);
    delete from scm.po_revisions where po_id::text = any(v_po);
    delete from scm.purchase_orders where id::text = any(v_po);
    delete from scm.production_orders where id::text = any(v_pro);

    -- DEMO Residence and CURVO 1234 stay; their lines go back to nothing ordered.
    update scm.mfg_sales_order_items
       set po_qty_picked = 0, stock_qty_ready = 0, stock_status = 'PENDING', allocated_batch_no = null
     where doc_no = any(v_keep_so) and (coalesce(po_qty_picked, 0) <> 0 or coalesce(stock_qty_ready, 0) <> 0 or stock_status <> 'PENDING');

    -- An OMIT line must keep its target, so it goes before the line it omits.
    delete from scm.reno_doc_lines o using scm.reno_doc_lines t, scm.reno_doc_sections s
     where o.omit_target_line_id = t.id and t.section_id = s.id and s.so_doc_no = any(v_so);
    delete from scm.reno_cost_alerts where so_doc_no = any(v_so);
    delete from scm.reno_revenue_allocations where so_doc_no = any(v_so);
    delete from scm.reno_contract_credits where so_doc_no = any(v_so);
    delete from scm.reno_instalment_bills where so_doc_no = any(v_so);
    delete from scm.acc_deposit_invoices where so_doc_no = any(v_so);
    for r in
      select c.table_schema s, c.table_name t from information_schema.columns c
        join information_schema.tables b on b.table_schema = c.table_schema and b.table_name = c.table_name
       where b.table_type = 'BASE TABLE' and c.table_schema in ('scm', 'public') and c.column_name = 'so_doc_no'
    loop
      execute format('delete from %I.%I where so_doc_no = any($1)', r.s, r.t) using v_so;
    end loop;
    delete from scm.mfg_sales_orders where doc_no = any(v_so);
    delete from scm.reno_quotations where project_id = any(v_proj);

    for r in
      select c.table_schema s, c.table_name t from information_schema.columns c
        join information_schema.tables b on b.table_schema = c.table_schema and b.table_name = c.table_name
       where b.table_type = 'BASE TABLE' and c.table_schema in ('scm', 'public') and c.column_name = 'project_id'
    loop
      execute format('delete from %I.%I where project_id = any($1)', r.s, r.t) using v_proj;
    end loop;
    delete from public.projects where id = any(v_proj);

    foreach v_t in array v_tables loop
      execute format('select count(*) from %s', v_t) into v_n;
      v_m := (v_before ->> v_t)::bigint;
      v_counts := v_counts || jsonb_build_object(v_t, jsonb_build_object('before', v_m, 'cleared', v_m - v_n, 'left', v_n));
    end loop;
    v_result := jsonb_build_object('committed', p_commit, 'counts', v_counts, 'projects', to_jsonb(v_names), 'pos', to_jsonb(v_po_numbers));

    if not p_commit then
      raise exception 'preview' using errcode = 'PT001';
    end if;
    insert into pos.audit_log (actor_id, actor_label, action, entity_table, entity_id, before_state, after_state, source, occurred_at)
    values (p_actor, coalesce(p_actor, 'owner'), 'purge_test_data', 'scm.purchase_orders', 'testing', v_before::text, v_counts::text, 'engine', now()::text);
  exception when sqlstate 'PT001' then
    null;
  end;
  return v_result;
end
$fn$;

revoke all on function scm.purge_test_data(boolean, text) from public, anon, authenticated;
grant execute on function scm.purge_test_data(boolean, text) to scm_engine;
