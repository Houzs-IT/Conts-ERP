-- REVERSAL: revert the code first. update scm.inventory_lot_consumptions c set source_doc_id = null, source_doc_no = null from scm.stock_adjustments h where c.movement_id = h.id and c.source_doc_id = h.id; update scm.inventory_lots l set source_doc_id = null, source_doc_no = null from scm.stock_adjustments h where l.movement_id = h.id and l.source_doc_id = h.id; update scm.inventory_movements m set source_doc_id = null, source_doc_no = null from scm.stock_adjustments h where m.id = h.id and m.source_doc_id = h.id; drop index if exists scm.idx_inventory_movements_adjustment_doc; drop table scm.stock_adjustment_lines; drop table scm.stock_adjustments; alter table scm.stock_take_lines drop column rack_id, drop column added_on_count; alter table scm.stock_takes drop column nonzero_only, drop column assignee_staff_ids. The SA counter rows in scm.doc_number_counters may stay (a counter only moves up).
-- Stock take rounds and the stock adjustment document (TODO item 18; Houzs 20261006T1500, 20261006T1700, 20261007T1100,
-- 20261007T1110, merged into one file).
--
--   stock_takes.assignee_staff_ids  every counter (two or three count together); assignee_staff_id stays the first one so
--                                   older readers keep a name. Backfilled from assignee_staff_id.
--   stock_takes.nonzero_only        the take was built from SKUs with stock only (a tick box beside Category / Prefix).
--   stock_take_lines.added_on_count a line added while counting (stock found that the sheet did not list).
--   stock_take_lines.rack_id        the rack the goods were counted on; at post the goods move to it.
--   stock_adjustments / _lines      a manual stock adjustment becomes a numbered document (TC-SA-YYMM-NNN) holding its
--                                   current lines; every movement it writes points back at it (source_doc_type
--                                   'ADJUSTMENT', source_doc_id = header id). An edit writes one signed ADJUSTMENT per
--                                   changed (item, variant, batch) bucket.
--   backfill                        every manual adjustment written before this gets its own document (one per movement,
--                                   header id = movement id), and the SA counter is raised past the numbers used.
--
-- APPLY: by hand, in one transaction with its public.pos_migrations row, staging first, then production, BEFORE the
-- code that needs it merges. Re-runnable.
select demo.drop_views();
set local lock_timeout = '5s';

/* ── Stock take, round 1 ─────────────────────────────────────────────────── */
alter table scm.stock_takes add column if not exists assignee_staff_ids uuid[] not null default '{}';
update scm.stock_takes set assignee_staff_ids = array[assignee_staff_id]
 where assignee_staff_id is not null and cardinality(assignee_staff_ids) = 0;
alter table scm.stock_takes add column if not exists nonzero_only boolean not null default false;
alter table scm.stock_take_lines add column if not exists added_on_count boolean not null default false;

/* ── Stock take, round 2: the rack each line was counted on ──────────────── */
alter table scm.stock_take_lines add column if not exists rack_id uuid references scm.warehouse_racks(id) on delete set null;

/* ── Stock adjustment as a document ──────────────────────────────────────── */
create table if not exists scm.stock_adjustments (
  id             uuid primary key default gen_random_uuid(),
  company_id     bigint not null references public.companies(id),
  adjustment_no  text not null,
  warehouse_id   uuid not null references scm.warehouses(id),
  notes          text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists uq_stock_adjustments_no on scm.stock_adjustments (adjustment_no);
create index if not exists idx_stock_adjustments_company_created on scm.stock_adjustments (company_id, created_at desc);

-- qty is signed (+ found / recount up, - write-off), as the movement. reason_code is nullable only for rows backfilled
-- from movements written before the reason became mandatory; the route still requires one.
create table if not exists scm.stock_adjustment_lines (
  id                   uuid primary key default gen_random_uuid(),
  stock_adjustment_id  uuid not null references scm.stock_adjustments(id) on delete cascade,
  company_id           bigint not null references public.companies(id),
  line_no              integer not null,
  item_code            text not null,
  product_name         text,
  item_group           text,
  variants             jsonb,
  description2         text,
  variant_key          text not null default '',
  batch_no             text,
  qty                  integer not null check (qty <> 0),
  unit_cost_sen        integer,
  reason_code          text,
  notes                text,
  created_at           timestamptz not null default now()
);
create index if not exists idx_stock_adjustment_lines_doc on scm.stock_adjustment_lines (stock_adjustment_id, line_no);
create index if not exists idx_inventory_movements_adjustment_doc on scm.inventory_movements (source_doc_id)
  where source_doc_type = 'ADJUSTMENT';

alter table scm.stock_adjustments owner to scm_engine;
alter table scm.stock_adjustment_lines owner to scm_engine;
alter table scm.stock_adjustments enable row level security;
alter table scm.stock_adjustment_lines enable row level security;
grant all on scm.stock_adjustments, scm.stock_adjustment_lines to service_role, pos_app;

/* ── Backfill: one document per old manual adjustment ────────────────────────
   Only movement_type = 'ADJUSTMENT' with source_doc_type = 'ADJUSTMENT' and no source_doc_id: DO-cancel and DR-resync
   rows use the same source_doc_type but always carry their DO / DR id. Numbers: <prefix>SA-<YYMM in Malaysia>-NNN in
   created_at order, prefix TC- for the engine's one company (code HOUZS, migration 0046; lib/companyScope.ts). */
insert into scm.stock_adjustments (id, company_id, adjustment_no, warehouse_id, notes, created_by, created_at, updated_at)
select n.id, n.company_id, n.series || '-' || lpad((n.base + n.rn)::text, 3, '0'), n.warehouse_id, null, n.performed_by, n.created_at, n.created_at
  from (
    select s.*,
           row_number() over (partition by s.series order by s.created_at, s.id) as rn,
           coalesce((select max((substring(h.adjustment_no from '-([0-9]+)$'))::int)
                       from scm.stock_adjustments h where h.adjustment_no like s.series || '-%'), 0) as base
      from (
        select m.id, m.company_id, m.warehouse_id, m.performed_by, m.created_at,
               (case when upper(co.code) = 'HOUZS' then 'TC-' else upper(co.code) || '-' end)
                 || 'SA-' || to_char(m.created_at at time zone 'Asia/Kuala_Lumpur', 'YYMM') as series
          from scm.inventory_movements m
          join public.companies co on co.id = m.company_id
         where m.movement_type = 'ADJUSTMENT' and m.source_doc_type = 'ADJUSTMENT' and m.source_doc_id is null
           and m.warehouse_id is not null
           and not exists (select 1 from scm.stock_adjustments x where x.id = m.id)
      ) s
  ) n
on conflict (id) do nothing;

insert into scm.stock_adjustment_lines
  (stock_adjustment_id, company_id, line_no, item_code, product_name, item_group,
   variants, description2, variant_key, batch_no, qty, unit_cost_sen, reason_code, notes, created_at)
select h.id, h.company_id, 1, m.item_code, m.product_name, null,
       m.variants, m.description2, coalesce(m.variant_key, ''), m.batch_no, m.qty,
       m.unit_cost_sen, m.reason_code, m.notes, m.created_at
  from scm.stock_adjustments h
  join scm.inventory_movements m on m.id = h.id
 where m.qty <> 0
   and not exists (select 1 from scm.stock_adjustment_lines l where l.stock_adjustment_id = h.id);

update scm.inventory_movements m set source_doc_id = h.id, source_doc_no = h.adjustment_no
  from scm.stock_adjustments h
 where m.id = h.id and m.source_doc_type = 'ADJUSTMENT' and m.source_doc_id is null;
update scm.inventory_lots l set source_doc_id = h.id, source_doc_no = h.adjustment_no
  from scm.stock_adjustments h
 where l.movement_id = h.id and l.source_doc_type = 'ADJUSTMENT' and l.source_doc_id is null;
update scm.inventory_lot_consumptions c set source_doc_id = h.id, source_doc_no = h.adjustment_no
  from scm.stock_adjustments h
 where c.movement_id = h.id and c.source_doc_type = 'ADJUSTMENT' and c.source_doc_id is null;

insert into scm.doc_number_counters as c (series, next_n, seed_source)
select head, mx + 1, '0290 backfill: max scm.stock_adjustments.adjustment_no (SA)'
  from (select substring(adjustment_no from '^(.*)-[0-9]+$') as head,
               max((substring(adjustment_no from '-([0-9]+)$'))::int) as mx
          from scm.stock_adjustments group by 1) s
 where head is not null
on conflict (series) do update set next_n = greatest(c.next_n, excluded.next_n), updated_at = now();

notify pgrst, 'reload schema';
select demo.sync();
