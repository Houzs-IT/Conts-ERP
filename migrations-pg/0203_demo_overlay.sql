-- Demo mode for the whole system (owner, 3 Nov 2026): every screen shows real plus demo data, and every action works in
-- Demo mode, writing into the demo store instead of pos. Builds on 0199 (schema demo, demo.v_*, shadows):
--   demo.<table>          a store for EVERY pos table with a primary key (0199 had five): same columns, plus shadow_of
--                         (set on a copy of a real row), demo_by, demo_at and demo_gone (a real row removed in Demo).
--                         A demo row has the same key as the row it shows, so a shadow keeps the real row's id.
--   demo.v_<table>        every real row, read live (never copied), unless the store has a row with its key; plus the
--                         store's rows that are not removed. demo_source says real, shadow or demo.
--   demo_pos.<table>      what a Demo mode request reads and writes (functions/_lib/db.ts puts demo_pos ahead of pos on
--                         its search_path, so the app's unqualified table names land here). Each is demo.v_<table> with
--                         the pos table's defaults, and an INSTEAD OF trigger: insert = a new demo row, update = the
--                         demo row or a new shadow of the real row, delete = drop the demo row or mark the real one gone.
--                         Nothing a Demo mode request writes can reach pos.
--   live-only tables      demo.live_only() and tables without a primary key: demo_pos shows the pos rows as they are and
--                         refuses every change ("Demo: ..."). Owner payouts and sign-in records.
--   demo.sync()           builds all of the above from pos as it stands, so it runs after every migration (see below).
--   demo.clear()          Clear demo: empties every store.
--
-- MAINTENANCE: the views read every pos table's columns. scripts/migrate-pg.mjs runs `select demo.drop_views();`
-- before each migration and `select demo.sync();` after it, in the same transaction. A migration applied by hand
-- (production through the Supabase connector) must do the same: drop_views first, sync last.
-- REVERSAL: select demo.drop_views(); drop schema demo_pos; drop the demo.<table> stores 0199 did not make; then
-- re-run 0199's demo.sync body. 0199's rule pos.refuse_demo_ids (fifteen tables) is unchanged.
-- APPLY: by hand, in one transaction with its public.pos_migrations row; staging first, then production.

set local search_path = pos, public;
set local lock_timeout = '5s';

create schema if not exists demo_pos;
revoke all on schema demo_pos from public;
grant usage on schema demo_pos to pos_app, service_role;

-- 0199's shadows had ids demo-s-<real id>; from here a shadow keeps the real id, and new rows need not start demo-
-- (a composite-key row such as a channel rate has no id at all). Demo mode's own ids still start demo- (db.ts).
do $$
declare t text;
begin
  foreach t in array array['reservations', 'reviews', 'units', 'owners', 'guests'] loop
    execute format('drop view if exists demo.%I', 'v_' || t);
    execute format('alter table demo.%I drop constraint if exists %I', t, t || '_demo_id');
    execute format('update demo.%I set id = shadow_of where shadow_of is not null and id <> shadow_of', t);
  end loop;
end $$;

-- Tables Demo mode reads live and never changes.
create or replace function demo.live_only() returns text[] language sql immutable as $$
  select array['payouts', 'user_sessions', 'password_reset_tokens', 'user_backup_codes', 'login_events']
$$;

create or replace function demo.refuse_write() returns trigger language plpgsql as $$
begin
  raise exception 'Demo: % is real data only and cannot be changed in Demo mode. Turn Demo mode off to change it.', tg_table_name
    using errcode = 'check_violation', hint = 'demo_mode';
end $$;

create or replace function demo.drop_views() returns void language plpgsql as $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'demo_pos' and c.relkind = 'v' loop
    execute format('drop view if exists demo_pos.%I cascade', r.relname);
  end loop;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'demo' and c.relkind = 'v' and c.relname like 'v\_%' loop
    execute format('drop view if exists demo.%I cascade', r.relname);
  end loop;
end $$;

create or replace function demo.sync() returns void language plpgsql as $$
declare
  t text; pk text[]; c record; ix record; tg record;
  cols text; real_cols text; demo_cols text; new_vals text; old_vals text; sets text;
  pk_dp text; pk_new text; pk_old text; old_key text; demo_id text; fn text; seq text; stamp text;
begin
  perform demo.drop_views();
  stamp := $s$to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')$s$;
  for t in select tablename::text from pg_tables where schemaname = 'pos' order by 1 loop
    select array_agg(a.attname::text order by array_position(k.conkey, a.attnum)) into pk
      from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
      where k.conrelid = format('pos.%I', t)::regclass and k.contype = 'p';
    select string_agg(format('%I', attname), ', ' order by attnum) into cols
      from pg_attribute where attrelid = format('pos.%I', t)::regclass and attnum > 0 and not attisdropped;

    if pk is null or t = any (demo.live_only()) then
      execute format($v$create view demo_pos.%I with (security_invoker = true) as
        select %s, 'real'::text as demo_source, null::text as demo_id from pos.%I$v$, t, cols, t);
      execute format('create trigger demo_refuse instead of insert or update or delete on demo_pos.%I for each row execute function demo.refuse_write()', t);
      execute format('revoke all on demo_pos.%I from public', t);
      execute format('grant select, insert, update, delete on demo_pos.%I to pos_app, service_role', t);
      continue;
    end if;

    -- The store: the pos columns (new ones added as pos gains them), the demo columns, the key and unique indexes.
    execute format('create table if not exists demo.%I (like pos.%I including defaults)', t, t);
    for c in
      select a.attname, format_type(a.atttypid, a.atttypmod) as typ from pg_attribute a
      where a.attrelid = format('pos.%I', t)::regclass and a.attnum > 0 and not a.attisdropped
        and not exists (select 1 from pg_attribute b where b.attrelid = format('demo.%I', t)::regclass
                        and b.attname = a.attname and b.attnum > 0 and not b.attisdropped)
    loop
      execute format('alter table demo.%I add column %I %s', t, c.attname, c.typ);
    end loop;
    execute format('alter table demo.%I add column if not exists shadow_of text, add column if not exists demo_by text, '
                   'add column if not exists demo_at text, add column if not exists demo_gone boolean not null default false', t);
    if not exists (select 1 from pg_constraint where conrelid = format('demo.%I', t)::regclass and contype = 'p') then
      execute format('alter table demo.%I add primary key (%s)', t, (select string_agg(format('%I', x), ', ') from unnest(pk) x));
    end if;
    for ix in
      select ci.relname as name, pg_get_indexdef(i.indexrelid) as def from pg_index i join pg_class ci on ci.oid = i.indexrelid
      where i.indrelid = format('pos.%I', t)::regclass and i.indisunique and not i.indisprimary
    loop
      if to_regclass(format('demo.%I', ix.name)) is null then
        execute regexp_replace(ix.def, '^CREATE UNIQUE INDEX \S+ ON \S+', format('CREATE UNIQUE INDEX %I ON demo.%I', ix.name, t));
      end if;
    end loop;
    -- The pos table's own row triggers (a cancelled stay's cancelled_at, an expense's deduction month) act the same here.
    for tg in
      select tgname, pg_get_triggerdef(oid) as def from pg_trigger
      where tgrelid = format('pos.%I', t)::regclass and not tgisinternal and tgname not in ('refuse_demo_ids', 'refuse_demo_id')
    loop
      if not exists (select 1 from pg_trigger where tgrelid = format('demo.%I', t)::regclass and tgname = tg.tgname) then
        execute regexp_replace(tg.def, ' ON \S+ ', format(' ON demo.%I ', t));
      end if;
    end loop;
    execute format('revoke all on demo.%I from public', t);
    execute format('grant select, insert, update, delete on demo.%I to pos_app', t);
    execute format('grant all on demo.%I to service_role', t);

    select string_agg(format('p.%I', attname), ', ' order by attnum), string_agg(format('d.%I', attname), ', ' order by attnum),
           string_agg(format('new.%I', attname), ', ' order by attnum), string_agg(format('old.%I', attname), ', ' order by attnum),
           string_agg(format('%1$I = new.%1$I', attname), ', ' order by attnum)
      into real_cols, demo_cols, new_vals, old_vals, sets
      from pg_attribute where attrelid = format('pos.%I', t)::regclass and attnum > 0 and not attisdropped;
    select string_agg(format('d.%1$I = p.%1$I', x), ' and '), string_agg(format('d.%1$I = new.%1$I', x), ' and '),
           string_agg(format('d.%1$I = old.%1$I', x), ' and '), 'concat_ws(''|'', ' || string_agg(format('old.%I', x), ', ') || ')'
      into pk_dp, pk_new, pk_old, old_key from unnest(pk) x;
    demo_id := case when 'id' = any (pk) then 'd.id::text' else 'null::text' end;

    execute format($v$create view demo.%I with (security_invoker = true) as
      select %s, 'real'::text as demo_source, null::text as demo_id from pos.%I p where not exists (select 1 from demo.%I d where %s)
      union all
      select %s, case when d.shadow_of is null then 'demo' else 'shadow' end, %s from demo.%I d where not d.demo_gone$v$,
      'v_' || t, real_cols, t, t, pk_dp, demo_cols, demo_id, t);
    execute format('revoke all on demo.%I from public', 'v_' || t);
    execute format('grant select on demo.%I to pos_app, service_role', 'v_' || t);

    execute format('create view demo_pos.%I with (security_invoker = true) as select * from demo.%I', t, 'v_' || t);
    for c in
      select a.attname, a.attidentity, pg_get_expr(d.adbin, d.adrelid) as def from pg_attribute a
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = format('pos.%I', t)::regclass and a.attnum > 0 and not a.attisdropped and (d.adbin is not null or a.attidentity <> '')
    loop
      if c.attidentity <> '' then
        -- The real table's own sequence, so a demo row never takes an id a real row has.
        seq := pg_get_serial_sequence(format('pos.%I', t), c.attname);
        execute format('alter table demo.%I alter column %I set default nextval(%L::regclass)', t, c.attname, seq);
        execute format('alter view demo_pos.%I alter column %I set default nextval(%L::regclass)', t, c.attname, seq);
      else
        execute format('alter view demo_pos.%I alter column %I set default %s', t, c.attname, c.def);
      end if;
    end loop;

    fn := 'w_' || t;
    execute format($f$create or replace function demo.%1$I() returns trigger language plpgsql as $b$
      begin
        if tg_op = 'INSERT' then
          delete from demo.%2$I d where %3$s and d.demo_gone;
          insert into demo.%2$I (%4$s, demo_at) values (%5$s, %10$s);
          new.demo_source := 'demo';
          return new;
        elsif tg_op = 'UPDATE' then
          update demo.%2$I d set %6$s, demo_at = %10$s where %7$s;
          if not found then
            insert into demo.%2$I (%4$s, shadow_of, demo_at) values (%5$s, %8$s, %10$s);
            new.demo_source := 'shadow';
          end if;
          return new;
        end if;
        if old.demo_source = 'demo' then
          delete from demo.%2$I d where %7$s;
        else
          update demo.%2$I d set demo_gone = true, demo_at = %10$s where %7$s;
          if not found then
            insert into demo.%2$I (%4$s, shadow_of, demo_gone, demo_at) values (%9$s, %8$s, true, %10$s);
          end if;
        end if;
        return old;
      end $b$ $f$, fn, t, pk_new, cols, new_vals, sets, pk_old, old_key, old_vals, stamp);
    execute format('revoke all on function demo.%I() from public', fn);
    execute format('create trigger demo_write instead of insert or update or delete on demo_pos.%I for each row execute function demo.%I()', t, fn);
    execute format('revoke all on demo_pos.%I from public', t);
    execute format('grant select, insert, update, delete on demo_pos.%I to pos_app, service_role', t);
  end loop;
end $$;

-- A shadow of any pos table with a text id: copies the real row into its store once and returns the id (the real id).
create or replace function demo.shadow(t text, real_id text, actor text) returns text language plpgsql as $$
declare did text; cols text; real_cols text; n int;
begin
  if to_regclass(format('demo.%I', t)) is null or to_regclass(format('pos.%I', t)) is null then
    raise exception 'demo.shadow: % has no demo store', t using errcode = 'invalid_parameter_value';
  end if;
  execute format('select id from demo.%I where id = $1', t) into did using real_id;
  if did is not null then return did; end if;
  select string_agg(format('%I', attname), ', ' order by attnum), string_agg(format('p.%I', attname), ', ' order by attnum)
    into cols, real_cols
    from pg_attribute where attrelid = format('pos.%I', t)::regclass and attnum > 0 and not attisdropped;
  execute format('insert into demo.%I (%s, shadow_of, demo_by, demo_at) select %s, p.id, $2, $3 from pos.%I p where p.id = $1', t, cols, real_cols, t)
    using real_id, actor, to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'demo.shadow: no % with id %', t, real_id using errcode = 'no_data_found'; end if;
  return real_id;
end $$;

-- Shadows every real row of a small table not yet in its store: run before a Demo mode upsert on a running number
-- (booking_ref_counters, document_counters), so Demo mode carries on from the real number instead of starting at 1.
create or replace function demo.shadow_all(t text) returns void language plpgsql as $$
declare pk text[]; cols text; real_cols text; pk_dp text; key text;
begin
  if to_regclass(format('demo.%I', t)) is null or to_regclass(format('pos.%I', t)) is null then
    raise exception 'demo.shadow_all: % has no demo store', t using errcode = 'invalid_parameter_value';
  end if;
  select array_agg(a.attname::text order by array_position(k.conkey, a.attnum)) into pk
    from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
    where k.conrelid = format('pos.%I', t)::regclass and k.contype = 'p';
  select string_agg(format('%I', attname), ', ' order by attnum), string_agg(format('p.%I', attname), ', ' order by attnum)
    into cols, real_cols
    from pg_attribute where attrelid = format('pos.%I', t)::regclass and attnum > 0 and not attisdropped;
  select string_agg(format('d.%1$I = p.%1$I', x), ' and '), 'concat_ws(''|'', ' || string_agg(format('p.%I', x), ', ') || ')'
    into pk_dp, key from unnest(pk) x;
  execute format('insert into demo.%I (%s, shadow_of, demo_at) select %s, %s, %L from pos.%I p where not exists (select 1 from demo.%I d where %s)',
    t, cols, real_cols, key, to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), t, t, pk_dp);
end $$;

-- Clear demo: every store emptied. Counts the five 0199 tables by name and everything else as other.
create or replace function demo.clear() returns jsonb language plpgsql as $$
declare r record; n int; other int := 0; out jsonb := '{}'::jsonb;
begin
  for r in select c.relname::text as t from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'demo' and c.relkind = 'r' order by 1 loop
    execute format('delete from demo.%I', r.t);
    get diagnostics n = row_count;
    if r.t in ('reservations', 'reviews', 'units', 'owners', 'guests') then out := out || jsonb_build_object(r.t, n);
    else other := other + n; end if;
  end loop;
  return out || jsonb_build_object('other', other);
end $$;

revoke all on function demo.drop_views(), demo.sync(), demo.live_only() from public;
revoke all on function demo.shadow(text, text, text), demo.clear() from public;
revoke all on function demo.shadow_all(text) from public;
grant execute on function demo.shadow(text, text, text), demo.shadow_all(text), demo.clear(), demo.refuse_write() to pos_app, service_role;

select demo.sync();
