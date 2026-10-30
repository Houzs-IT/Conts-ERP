-- REVERSAL: drop table scm.acc_sub_category_accounts;
-- Renovation revenue in the ledger (finance, chew 30 Oct 2026; spec docs/superpowers/specs/2026-10-30-renovation-revenue-
-- einvoice-design.md 2.4; plan 2026-10-30-renovation-revenue-ledger.md). Renovation revenue and costs book to the chart's
-- own detailed accounts per product sub-category (501-0020 electrical, 502-0010 TV cabinet …), not one account per group.
--   scm.acc_sub_category_accounts   per company, a sub-category's own sales / purchase account. A null side, or no row,
--                                   means that side uses its category group's binding (scm.acc_item_group_accounts);
--                                   neither bound = the line refuses to post by name (the group_unbound rule).
-- Later tasks of the same plan append the contract tables and columns to this file before it is applied.
-- Numbered 0184: 0181 (drop_wh_codes), 0182 (conts_menu_categories) and 0183 (building_punch_radius) are taken on main
-- or open branches.
-- APPLY: by hand, to production before the code merges, in one transaction with its public.pos_migrations row.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

create table if not exists scm.acc_sub_category_accounts (
  company_id bigint not null,
  sub_category_code text not null references scm.product_sub_categories (code),
  sales_account text,
  purchase_account text,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (company_id, sub_category_code),
  constraint acc_sub_category_accounts_some_side check (sales_account is not null or purchase_account is not null)
);

alter table scm.acc_sub_category_accounts owner to scm_engine;
alter table scm.acc_sub_category_accounts enable row level security;
revoke all on scm.acc_sub_category_accounts from anon, authenticated;
-- The engine reaches it through the Supabase REST client (service_role).
grant all on scm.acc_sub_category_accounts to service_role, pos_app;
