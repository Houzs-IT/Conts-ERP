-- REVERSAL: alter table scm.product_category_groups drop column active;
-- Owner, 20 Nov 2026: the catalog groups (Works, Built-in, ... Raw material) are kept from Products > SKU Master >
-- Sub-categories, like their sub-categories: renamed, reordered and hidden there. A hidden group leaves the group chips
-- and the pickers; SKUs, documents and accounting keep its code. New groups are still born under Accounting > Item Groups.
-- Optional for the code: until this runs every group reads as shown, and hiding one answers an error.
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0348, dry run first.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.product_category_groups add column if not exists active boolean not null default true;
