-- REVERSAL: select demo.drop_views(); drop index if exists pos.guests_full_name_trgm, pos.reservations_external_ref_trgm, pos.owners_display_name_trgm, pos.maintenance_issues_title_trgm, public.projects_customer_name_trgm, public.projects_building_trgm, public.projects_unit_no_trgm, public.projects_phone_key_trgm, public.projects_code_key_trgm, public.assr_cases_phone_key_trgm, public.assr_cases_no_key_trgm, scm.customers_name_trgm, scm.customers_phone_key_trgm, scm.suppliers_name_trgm, scm.reno_quotations_no_key_trgm, scm.mfg_sales_orders_doc_key_trgm, scm.mfg_sales_orders_phone_key_trgm; select demo.sync();
-- One search box for the whole system (owner, 3 Nov 2026: "search any keyword - customer name, project name, etc.").
-- Indexes only: nothing is added, changed or removed in any table, and the search works without them (slower on large
-- tables). Trigram (pg_trgm, in schema extensions since 0044) indexes let "contains" searches use an index:
--   *_trgm      the column as it is, for the words typed (functions/api/search, engine renovationSearch.ts).
--   *_key_trgm  the column's letters and digits only, lower case, for numbers typed with or without spaces and dashes
--               ("so 2610 001" finds SO-2610-001, "012-345 6789" finds +60 12 3456789). The expression must stay
--               exactly the one in engine/backend/src/services/renovation/renovationSearch.ts (norm), or the index is
--               not used.
-- Columns the Houzs snapshot already indexes (0044 / 0045 trgm_*: assr_cases customer_name, doc_no, assr_no, phone;
-- projects code, name; the scm documents' numbers and names) are not repeated.
-- APPLY: by hand, in one transaction with its public.pos_migrations row, after 0205; staging first, then production.
-- Starts with demo.drop_views() and ends with demo.sync() like every migration since 0203.
set local search_path = pos, public;
set local lock_timeout = '5s';
select demo.drop_views();

create index if not exists guests_full_name_trgm on pos.guests using gin (full_name extensions.gin_trgm_ops);
create index if not exists reservations_external_ref_trgm on pos.reservations using gin (external_ref extensions.gin_trgm_ops);
create index if not exists owners_display_name_trgm on pos.owners using gin (display_name extensions.gin_trgm_ops);
create index if not exists maintenance_issues_title_trgm on pos.maintenance_issues using gin (title extensions.gin_trgm_ops);

create index if not exists projects_customer_name_trgm on public.projects using gin (customer_name extensions.gin_trgm_ops);
create index if not exists projects_building_trgm on public.projects using gin (building extensions.gin_trgm_ops);
create index if not exists projects_unit_no_trgm on public.projects using gin (unit_no extensions.gin_trgm_ops);
create index if not exists projects_phone_key_trgm on public.projects
  using gin ((regexp_replace(lower(coalesce(customer_phone, '')), '[^a-z0-9]+', '', 'g')) extensions.gin_trgm_ops);
create index if not exists projects_code_key_trgm on public.projects
  using gin ((regexp_replace(lower(coalesce(code, '')), '[^a-z0-9]+', '', 'g')) extensions.gin_trgm_ops);
create index if not exists assr_cases_phone_key_trgm on public.assr_cases
  using gin ((regexp_replace(lower(coalesce(phone, '')), '[^a-z0-9]+', '', 'g')) extensions.gin_trgm_ops);
create index if not exists assr_cases_no_key_trgm on public.assr_cases
  using gin ((regexp_replace(lower(coalesce(assr_no, '')), '[^a-z0-9]+', '', 'g')) extensions.gin_trgm_ops);

create index if not exists customers_name_trgm on scm.customers using gin (name extensions.gin_trgm_ops);
create index if not exists customers_phone_key_trgm on scm.customers
  using gin ((regexp_replace(lower(coalesce(phone, '')), '[^a-z0-9]+', '', 'g')) extensions.gin_trgm_ops);
create index if not exists suppliers_name_trgm on scm.suppliers using gin (name extensions.gin_trgm_ops);
create index if not exists reno_quotations_no_key_trgm on scm.reno_quotations
  using gin ((regexp_replace(lower(coalesce(quote_no, '')), '[^a-z0-9]+', '', 'g')) extensions.gin_trgm_ops);
create index if not exists mfg_sales_orders_doc_key_trgm on scm.mfg_sales_orders
  using gin ((regexp_replace(lower(coalesce(doc_no, '')), '[^a-z0-9]+', '', 'g')) extensions.gin_trgm_ops);
create index if not exists mfg_sales_orders_phone_key_trgm on scm.mfg_sales_orders
  using gin ((regexp_replace(lower(coalesce(phone, '')), '[^a-z0-9]+', '', 'g')) extensions.gin_trgm_ops);

select demo.sync();
