-- REVERSAL: alter table scm.reno_quotation_revisions drop column land_area_sqft, drop column land_size;
-- A quotation asks for the same land fields as its sales order and project, and hands them over on convert (owner, 5 Nov 2026).
set local lock_timeout = '5s';

alter table scm.reno_quotation_revisions
  add column if not exists land_area_sqft numeric(12, 2),
  add column if not exists land_size text;
