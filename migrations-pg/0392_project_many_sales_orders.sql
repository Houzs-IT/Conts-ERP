-- REVERSAL: CREATE UNIQUE INDEX uq_mfg_so_reno_project ON scm.mfg_sales_orders (project_id) WHERE so_kind = 'RENOVATION' AND status <> 'CANCELLED';
-- A project may hold more than one renovation sales order (owner, 26 Nov 2026): the SO form may pick a project that
-- already has an order, and the project shows every order's lines and money. The one-live-order-per-project index
-- from migration 0069 goes.
drop index if exists scm.uq_mfg_so_reno_project;
