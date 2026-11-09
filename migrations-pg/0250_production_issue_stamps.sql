-- REVERSAL: drop function scm.production_stamp_issued(uuid, jsonb); drop function scm.fn_reconcile_uncosted_outs(jsonb, timestamptz, uuid); drop function scm.do_restamp_item_costs(uuid, jsonb);
-- Start on a production order stamped each material's issued count with one REST call per material, and the engine's free
-- Workers plan allows 50 outside calls a request: a 60-material order stopped part-way. One call now stamps them all.
-- The engine falls back to the old per-material updates until this is applied, so the code can ship before it.
set local lock_timeout = '5s';

create function scm.production_stamp_issued(p_order uuid, p_rows jsonb) returns integer
language sql set search_path = scm, pg_temp as $$
  with x as (
    select (r->>'id')::uuid as id, (r->>'issued')::integer as issued, (r->>'short')::integer as short
      from jsonb_array_elements(p_rows) r
  ), done as (
    update scm.production_order_materials m
       set qty_issued = x.issued, qty_issued_short = x.short, updated_at = now()
      from x
     where m.id = x.id and m.production_order_id = p_order
    returning m.id
  )
  select count(*)::integer from done
$$;
alter function scm.production_stamp_issued(uuid, jsonb) owner to scm_engine;
revoke all on function scm.production_stamp_issued(uuid, jsonb) from public, anon, authenticated;
grant execute on function scm.production_stamp_issued(uuid, jsonb) to service_role, pos_app;

-- The oversell retro-cost after stock comes back (reconcileUncostedOuts) made one call per warehouse and SKU: releasing a
-- 60-material order made 60. One call now runs the same per-bucket function for all of them, in the same order.
create function scm.fn_reconcile_uncosted_outs(p_buckets jsonb, p_before_ts timestamptz, p_created_by uuid) returns integer
language plpgsql set search_path = scm, pg_temp as $$
declare b jsonb; total integer := 0;
begin
  for b in select * from jsonb_array_elements(p_buckets) loop
    total := total + coalesce(scm.fn_reconcile_uncosted_out((b->>'warehouse_id')::uuid, b->>'item_code', coalesce(b->>'variant_key', ''), p_before_ts, p_created_by), 0);
  end loop;
  return total;
end $$;
alter function scm.fn_reconcile_uncosted_outs(jsonb, timestamptz, uuid) owner to scm_engine;
revoke all on function scm.fn_reconcile_uncosted_outs(jsonb, timestamptz, uuid) from public, anon, authenticated;
grant execute on function scm.fn_reconcile_uncosted_outs(jsonb, timestamptz, uuid) to service_role, pos_app;

-- Shipping a DO re-costed its lines with one call per line (restampDoActualCost): a 60-line DO made 60. One call stamps
-- them all. ship_cost_sen is written only for the rows that carry it (freezeShipCost decides, as before).
create function scm.do_restamp_item_costs(p_do uuid, p_rows jsonb) returns integer
language sql set search_path = scm, pg_temp as $$
  with x as (
    select (r->>'id')::uuid as id, (r->>'unit_cost_sen')::integer as unit_cost_sen, (r->>'line_cost_sen')::integer as line_cost_sen,
           (r->>'line_margin_sen')::integer as line_margin_sen, r ? 'ship_cost_sen' as has_ship, (r->>'ship_cost_sen')::bigint as ship_cost_sen
      from jsonb_array_elements(p_rows) r
  ), done as (
    update scm.delivery_order_items i
       set unit_cost_sen = x.unit_cost_sen, line_cost_sen = x.line_cost_sen, line_margin_sen = x.line_margin_sen,
           ship_cost_sen = case when x.has_ship then x.ship_cost_sen else i.ship_cost_sen end
      from x
     where i.id = x.id and i.delivery_order_id = p_do
    returning i.id
  )
  select count(*)::integer from done
$$;
alter function scm.do_restamp_item_costs(uuid, jsonb) owner to scm_engine;
revoke all on function scm.do_restamp_item_costs(uuid, jsonb) from public, anon, authenticated;
grant execute on function scm.do_restamp_item_costs(uuid, jsonb) to service_role, pos_app;
