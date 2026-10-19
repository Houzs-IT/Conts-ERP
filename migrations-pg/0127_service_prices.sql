-- Service prices (owner, 17 Oct 2026): one product maintenance for the services we sell, shaped like the Houzs product
-- master. Cleaning and maintenance items share one list; each item has two prices, the owner price (what the owner is
-- charged, the amount on the owner statement) and the internal cost (what it costs us: cleaner pay, contractor, parts),
-- both effective-dated with a history.
--
--   service_items             the item list. It IS the old maintenance_skus table, renamed, so every maintenance job's
--                             sku_id, the parts stock (track_stock, stock_on_hand) and maintenance_stock_moves keep
--                             pointing at the same rows. maintenance_skus stays as a view over it, so code that still
--                             reads or writes the old name works unchanged.
--     .domain                 cleaning | maintenance
--     .category               the sub-category: Standard clean, Deep clean, Light clean, Laundry (cleaning); Aircon,
--                             Plumbing, Electrical... (maintenance)
--     .clean_kind             for a cleaning item: the clean type a reservation's clean picks it for (one active item
--                             per type)
--     .by_layout              1 = priced per unit layout (Studio, 1 bedroom, ... 4+): a price grid
--   service_item_prices       dated prices: (item, layout, effective_from) -> owner_price, internal_cost. layout 'all'
--                             for an item not priced by layout. A job uses the row in force on its own day, so a change
--                             applies from its date and earlier jobs keep theirs.
--   unit_service_prices       one unit's own owner price / internal cost for an item (the old unit_cleaning_prices).
--   tasks.service_item_id     the item a cleaning job was priced from.
--   maintenance_job_items     the items a maintenance job is made of (owner, 17 Oct 2026): item, quantity and the unit
--                             owner price and internal cost at the time (an "Other" line has no item, typed figures).
--                             The job's owner price (its quote) is their sum.
--   expenses.invoice_maintenance_id / invoice_task_id / supplier_name
--                             a supplier's, contractor's or cleaner's invoice against a job: the job's actual cost. It is
--                             an ordinary expense on the unit paid by The Conts (charge_to 'the_conts', so never on an owner
--                             statement), linked through its own columns so the job's owner charge (maintenance_id /
--                             task_id) is never mistaken for it.
--
-- Carried across, nothing removed: cleaning_prices -> three cleaning items (Standard, Deep, Light clean) priced by
-- layout, unit_cleaning_prices -> unit_service_prices, each maintenance item's default_price -> its owner price. Moved
-- prices take effect from 2000-01-01 so every job, past and future, prices as it did. The old tables stay untouched as
-- the fallback the code reads while this migration is not applied. Nothing here changes an expense, a job's amount or
-- a statement.
--
-- REVERSAL: alter table expenses drop column invoice_maintenance_id, drop column invoice_task_id, drop column supplier_name;
--           drop table maintenance_job_items, unit_service_prices, service_item_prices; alter table tasks drop column service_item_id;
--           drop view maintenance_skus; alter table service_items drop column domain, drop column clean_kind,
--           drop column by_layout; delete from service_items where id like 'svc-clean-%';
--           alter table service_items rename to maintenance_skus.
set local search_path = pos;

alter table maintenance_skus rename to service_items;
alter table service_items add column if not exists domain text not null default 'maintenance';
alter table service_items add column if not exists clean_kind text;
alter table service_items add column if not exists by_layout integer not null default 0;
alter table service_items drop constraint if exists maintenance_skus_category_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'service_items_domain_check') then
    alter table service_items add constraint service_items_domain_check check (domain in ('cleaning','maintenance'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'service_items_category_check') then
    alter table service_items add constraint service_items_category_check check (category in (
      'turnover','deep_clean','light_clean','laundry',
      'plumbing','electrical','aircon','furniture','appliance','cleaning','general','other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'service_items_clean_kind_check') then
    alter table service_items add constraint service_items_clean_kind_check check (clean_kind is null or (domain = 'cleaning' and clean_kind in ('turnover','deep_clean','light_clean')));
  end if;
end $$;
create unique index if not exists service_items_clean_kind_key on service_items(clean_kind) where clean_kind is not null and active = 1;

-- The old name, for code that still uses it. A plain view over one table is updatable, so inserts and updates pass through.
create view maintenance_skus as select * from service_items;

create table if not exists service_item_prices (
  id             text primary key,
  item_id        text not null references service_items(id) on delete cascade,
  layout         text not null default 'all',
  effective_from text not null check (effective_from ~ '^\d{4}-\d{2}-\d{2}$'),
  owner_price    integer check (owner_price is null or owner_price >= 0),
  internal_cost  integer check (internal_cost is null or internal_cost >= 0),
  note           text,
  created_at     text not null,
  created_by     text references users(id) on delete set null,
  unique (item_id, layout, effective_from)
);
create table if not exists unit_service_prices (
  unit_id        text not null references units(id) on delete cascade,
  item_id        text not null references service_items(id) on delete cascade,
  owner_price    integer check (owner_price is null or owner_price >= 0),
  internal_cost  integer check (internal_cost is null or internal_cost >= 0),
  updated_at     text not null,
  updated_by     text references users(id) on delete set null,
  primary key (unit_id, item_id)
);
alter table tasks add column if not exists service_item_id text references service_items(id) on delete set null;

create table if not exists maintenance_job_items (
  id             text primary key,
  issue_id       text not null references maintenance_issues(id) on delete cascade,
  item_id        text references service_items(id) on delete set null,
  name           text not null,
  qty            numeric(10,2) not null check (qty > 0),
  owner_price    integer not null check (owner_price >= 0),
  internal_cost  integer check (internal_cost is null or internal_cost >= 0),
  sort_order     integer not null default 0,
  created_at     text not null,
  created_by     text references users(id) on delete set null
);
create index if not exists maintenance_job_items_issue_idx on maintenance_job_items(issue_id);

alter table expenses add column if not exists invoice_maintenance_id text references maintenance_issues(id) on delete set null;
alter table expenses add column if not exists invoice_task_id text references tasks(id) on delete set null;
alter table expenses add column if not exists supplier_name text;
create index if not exists expenses_invoice_maintenance_idx on expenses(invoice_maintenance_id) where invoice_maintenance_id is not null;
create index if not exists expenses_invoice_task_idx on expenses(invoice_task_id) where invoice_task_id is not null;

-- The three cleaning items the old price table was, priced by layout.
insert into service_items (id, code, name, category, unit_label, default_price, active, notes, created_at, updated_at, domain, clean_kind, by_layout)
select x.id, x.code, x.name, x.kind, 'job', 0, 1, null, to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'cleaning', x.kind, 1
from (values ('svc-clean-standard', 'CLN-STANDARD', 'Standard clean', 'turnover'),
             ('svc-clean-deep', 'CLN-DEEP', 'Deep clean', 'deep_clean'),
             ('svc-clean-light', 'CLN-LIGHT', 'Light clean', 'light_clean')) as x(id, code, name, kind)
where not exists (select 1 from service_items s where s.id = x.id or lower(s.code) = lower(x.code));

insert into service_item_prices (id, item_id, layout, effective_from, owner_price, internal_cost, note, created_at, created_by)
select 'svc-moved-' || c.kind || '-' || c.layout, s.id, c.layout, '2000-01-01', c.external_charge, c.internal_cost,
       'Moved from the cleaning price table', c.updated_at, c.updated_by
from cleaning_prices c join service_items s on s.clean_kind = c.kind and s.domain = 'cleaning'
where c.internal_cost is not null or c.external_charge is not null
on conflict (item_id, layout, effective_from) do nothing;

insert into unit_service_prices (unit_id, item_id, owner_price, internal_cost, updated_at, updated_by)
select u.unit_id, s.id, u.external_charge, u.internal_cost, u.updated_at, u.updated_by
from unit_cleaning_prices u join service_items s on s.clean_kind = u.kind and s.domain = 'cleaning'
on conflict (unit_id, item_id) do nothing;

-- Each maintenance item's preset price becomes its owner price; its internal cost is not known yet.
insert into service_item_prices (id, item_id, layout, effective_from, owner_price, internal_cost, note, created_at, created_by)
select 'svc-moved-' || s.id, s.id, 'all', '2000-01-01', s.default_price, null, 'Moved from the maintenance item catalog', s.updated_at, null
from service_items s where s.domain = 'maintenance'
on conflict (item_id, layout, effective_from) do nothing;

do $$ declare t text; begin
  foreach t in array array['service_items', 'service_item_prices', 'unit_service_prices', 'maintenance_job_items'] loop
    execute format('alter table %I owner to pos_app', t);
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to pos_app', t);
  end loop;
  alter view maintenance_skus owner to pos_app;
  grant select, insert, update, delete on maintenance_skus to pos_app;
end $$;
