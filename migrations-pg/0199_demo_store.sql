-- Demo mode's store (Owner Hub plan, owner, 2 Nov 2026; docs/mockups/owner-hub-plan.html, section 4):
--   schema demo           demo.reservations, demo.reviews, demo.units, demo.owners, demo.guests: shaped like the pos
--                         tables they copy (same columns), plus shadow_of (the real row a demo copy stands in for),
--                         demo_by and demo_at. Every id starts with demo-.
--   demo.v_<table>        what Demo mode reads: every real row, live (never copied), with a demo shadow in place of
--                         the real row it overrides, plus the demo rows. demo_source says real, shadow or demo;
--                         demo_id is the demo row's own id (null on real rows). A shadow keeps the real row's id.
--   demo.shadow(t, id, by)  copies a real row into demo as its shadow (once) and returns the demo id: editing a real
--                         record in Demo mode edits that copy, never the real row.
--   demo.clear()          Clear demo: removes every demo row and shadow.
--   pos.refuse_demo_ids   the database rule that keeps demo ids out of pos: a trigger on the five tables and on the
--                         money and channel tables refuses a new or changed demo- id in their id and reference columns.
--                         Rows that already carry one (staging's three old seed reviews) are left as they are.
--
-- MAINTENANCE: the views read pos.reservations, pos.reviews, pos.units, pos.owners and pos.guests, so a later migration
-- that drops a column of one of them or changes its type must run `select demo.drop_views();` first and
-- `select demo.sync();` after. A migration that only adds a column should run `select demo.sync();` at its end, so the
-- demo table gets the column and the view shows it.
-- REVERSAL: drop schema demo cascade; then drop the refuse_demo_ids triggers and drop function pos.refuse_demo_ids().
-- APPLY: by hand, in one transaction with its public.pos_migrations row; staging first, then production.

set local search_path = pos, public;
set local lock_timeout = '5s';

create schema if not exists demo;
revoke all on schema demo from public;
grant usage on schema demo to pos_app, service_role;

create or replace function demo.drop_views() returns void language plpgsql as $$
declare t text;
begin
  foreach t in array array['reservations', 'reviews', 'units', 'owners', 'guests'] loop
    execute format('drop view if exists demo.%I', 'v_' || t);
  end loop;
end $$;

create or replace function demo.sync() returns void language plpgsql as $$
declare
  t text; c record; real_cols text; demo_cols text;
begin
  perform demo.drop_views();
  foreach t in array array['reservations', 'reviews', 'units', 'owners', 'guests'] loop
    execute format('create table if not exists demo.%I (like pos.%I including defaults)', t, t);
    -- Columns the pos table gained since the demo table was made.
    for c in
      select a.attname, format_type(a.atttypid, a.atttypmod) as typ
      from pg_attribute a
      where a.attrelid = format('pos.%I', t)::regclass and a.attnum > 0 and not a.attisdropped
        and not exists (select 1 from pg_attribute b where b.attrelid = format('demo.%I', t)::regclass
                        and b.attname = a.attname and b.attnum > 0 and not b.attisdropped)
    loop
      execute format('alter table demo.%I add column %I %s', t, c.attname, c.typ);
    end loop;
    execute format('alter table demo.%I add column if not exists shadow_of text, add column if not exists demo_by text, add column if not exists demo_at text', t);
    if not exists (select 1 from pg_constraint where conrelid = format('demo.%I', t)::regclass and conname = t || '_demo_pk') then
      execute format('alter table demo.%I add constraint %I primary key (id)', t, t || '_demo_pk');
      execute format('alter table demo.%I add constraint %I check (id like ''demo-%%'')', t, t || '_demo_id');
      execute format('alter table demo.%I add constraint %I check (shadow_of is null or shadow_of not like ''demo-%%'')', t, t || '_demo_shadow_real');
      execute format('create unique index %I on demo.%I (shadow_of) where shadow_of is not null', t || '_demo_shadow', t);
    end if;
    execute format('revoke all on demo.%I from public', t);
    execute format('grant select, insert, update, delete on demo.%I to pos_app', t);
    execute format('grant all on demo.%I to service_role', t);

    select string_agg(format('p.%I', attname), ', ' order by attnum),
           string_agg(case when attname = 'id' then 'coalesce(d.shadow_of, d.id) as id' else format('d.%I', attname) end, ', ' order by attnum)
      into real_cols, demo_cols
      from pg_attribute where attrelid = format('pos.%I', t)::regclass and attnum > 0 and not attisdropped;
    execute format($v$
      create view demo.%1$I with (security_invoker = true) as
      select %2$s, 'real'::text as demo_source, null::text as demo_id
        from pos.%3$I p where not exists (select 1 from demo.%3$I s where s.shadow_of = p.id)
      union all
      select %4$s, case when d.shadow_of is null then 'demo' else 'shadow' end, d.id
        from demo.%3$I d
    $v$, 'v_' || t, real_cols, t, demo_cols);
    execute format('revoke all on demo.%I from public', 'v_' || t);
    execute format('grant select on demo.%I to pos_app, service_role', 'v_' || t);
  end loop;
end $$;

select demo.sync();

create or replace function demo.shadow(t text, real_id text, actor text) returns text language plpgsql as $$
declare
  did text; cols text; real_cols text; n int;
begin
  if t not in ('reservations', 'reviews', 'units', 'owners', 'guests') then
    raise exception 'demo.shadow: % has no demo table', t using errcode = 'invalid_parameter_value';
  end if;
  execute format('select id from demo.%I where id = $1 or shadow_of = $1', t) into did using real_id;
  if did is not null then return did; end if;
  select string_agg(format('%I', attname), ', ' order by attnum), string_agg(format('p.%I', attname), ', ' order by attnum)
    into cols, real_cols
    from pg_attribute where attrelid = format('pos.%I', t)::regclass and attnum > 0 and not attisdropped and attname <> 'id';
  did := 'demo-s-' || real_id;
  execute format('insert into demo.%I (id, shadow_of, demo_by, demo_at, %s) select $1, p.id, $3, $4, %s from pos.%I p where p.id = $2', t, cols, real_cols, t)
    using did, real_id, actor, to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'demo.shadow: no % with id %', t, real_id using errcode = 'no_data_found'; end if;
  return did;
end $$;

create or replace function demo.clear() returns jsonb language plpgsql as $$
declare t text; n int; out jsonb := '{}'::jsonb;
begin
  -- Reviews and reservations before the units and owners they may point at.
  foreach t in array array['reviews', 'reservations', 'guests', 'units', 'owners'] loop
    execute format('delete from demo.%I', t);
    get diagnostics n = row_count;
    out := out || jsonb_build_object(t, n);
  end loop;
  return out;
end $$;

revoke all on function demo.drop_views(), demo.sync() from public;
revoke all on function demo.shadow(text, text, text), demo.clear() from public;
grant execute on function demo.shadow(text, text, text), demo.clear() to pos_app, service_role;

-- The rule that keeps sample data out of the real tables: refuses a new or changed demo- value in the columns named
-- as the trigger's arguments. An unchanged value (an old row that already had one) passes, so updating it still works.
create or replace function pos.refuse_demo_ids() returns trigger language plpgsql as $$
declare
  c text; v text;
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
begin
  foreach c in array tg_argv loop
    v := n ->> c;
    if v like 'demo-%' and (o is null or (o ->> c) is distinct from v) then
      raise exception 'Sample data cannot be saved in pos.%: % is %', tg_table_name, c, v using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end $$;

do $$
declare
  r record; cols text;
begin
  for r in
    select * from (values
      ('reservations', array['id', 'unit_id', 'guest_id']),
      ('reviews', array['id', 'unit_id', 'reservation_id']),
      ('units', array['id', 'owner_id', 'parent_unit_id']),
      ('owners', array['id']),
      ('guests', array['id', 'merged_into']),
      ('channex_outbox', array['unit_id']),
      ('statement_lines', array['unit_id', 'reservation_id']),
      ('statement_units', array['unit_id']),
      ('owner_statements', array['owner_id']),
      ('payouts', array['owner_id']),
      ('owner_adjustments', array['owner_id', 'unit_id']),
      ('booking_payments', array['reservation_id']),
      ('issued_documents', array['reservation_id']),
      ('tasks', array['unit_id', 'reservation_id']),
      ('message_threads', array['reservation_id', 'guest_id', 'owner_id'])
    ) as x(tbl, wanted)
  loop
    -- Only the columns this database has (staging can be a few migrations behind).
    select string_agg(quote_literal(column_name), ', ' order by array_position(r.wanted, column_name::text)) into cols
      from information_schema.columns
      where table_schema = 'pos' and table_name = r.tbl and column_name = any (r.wanted);
    if cols is null then continue; end if;
    execute format('drop trigger if exists refuse_demo_ids on pos.%I', r.tbl);
    execute format('create trigger refuse_demo_ids before insert or update on pos.%I for each row execute function pos.refuse_demo_ids(%s)', r.tbl, cols);
  end loop;
end $$;
