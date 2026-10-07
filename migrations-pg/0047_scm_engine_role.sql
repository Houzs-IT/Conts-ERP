-- The supply chain engine's own database role, scm_engine, in the same shape as pos_app for the rental
-- side: it owns the engine's tables (schema scm, and Houzs's tables in public), and owners skip row level
-- security, so the tables stay closed to every other role with no policies to maintain. It is granted
-- nothing in schema pos, so the engine cannot read rental records (owners, bank details, bookings).
-- Until this role existed the engine on staging connected as the database admin.
-- The role's password is set outside this file, by scripts/migrate-pg.mjs from SCM_ENGINE_PASSWORD.
-- REVERSAL: reassign the tables to postgres (ALTER TABLE ... OWNER TO postgres for each), then DROP ROLE scm_engine.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'scm_engine') then create role scm_engine login; end if;
end $$;
grant scm_engine to current_user;
alter role scm_engine set search_path = public, extensions;

-- A table's owner must be able to create in its schema, so the role has that in both.
grant usage, create on schema scm, public to scm_engine;
grant usage on schema extensions to scm_engine;

do $$ declare r record; begin
  -- Tables: every one in scm, and every one in public except this project's own migration ledger.
  for r in select schemaname, tablename from pg_tables
           where schemaname = 'scm' or (schemaname = 'public' and tablename <> 'pos_migrations') loop
    execute format('alter table %I.%I owner to scm_engine', r.schemaname, r.tablename);
  end loop;
  for r in select schemaname, viewname as name from pg_views where schemaname in ('scm', 'public')
           union all select schemaname, matviewname from pg_matviews where schemaname in ('scm', 'public') loop
    execute format('alter table %I.%I owner to scm_engine', r.schemaname, r.name);
  end loop;
  -- Sequences not tied to a column (those follow their table).
  for r in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where c.relkind = 'S' and n.nspname in ('scm', 'public')
             and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype in ('a', 'i')) loop
    execute format('alter sequence %I.%I owner to scm_engine', r.nspname, r.relname);
  end loop;
end $$;

grant execute on all functions in schema scm to scm_engine;
grant execute on all functions in schema public to scm_engine;
