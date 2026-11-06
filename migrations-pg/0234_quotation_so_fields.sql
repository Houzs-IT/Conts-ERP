-- REVERSAL: alter table scm.reno_quotation_revisions drop column salesperson_id, drop column customer_state, drop column city, drop column postcode, drop column customer_country, drop column sales_location;
-- A quotation asks for what a sales order asks for (owner, 6 Nov 2026), so it keeps the salesperson and the address and sales location fields and hands them over on convert.
select demo.drop_views();
set local lock_timeout = '5s';

alter table scm.reno_quotation_revisions
  add column if not exists salesperson_id uuid,
  add column if not exists customer_state text,
  add column if not exists city text,
  add column if not exists postcode text,
  add column if not exists customer_country text,
  add column if not exists sales_location text;

select demo.sync();
