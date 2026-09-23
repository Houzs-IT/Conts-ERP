-- Sales Orders, ported from 2990's SCM (mfg_sales_orders). The core sell-side document:
-- header + lines + a 9-state status flow + deposit/payment tracking. Customer is inline
-- (a full customers master is a follow-up). Venue/fair, margins, MRP processing-gate and
-- furniture specials are deferred. Delivery Orders + Sales Invoices are the next modules.
-- Money integer sen. REVERSAL: DROP TABLE sales_order_lines; DROP TABLE sales_orders;
set local search_path = pos;

CREATE TABLE sales_orders (
  id             TEXT PRIMARY KEY,
  doc_no         TEXT NOT NULL,
  customer_name  TEXT NOT NULL,
  customer_phone TEXT,
  customer_po    TEXT,
  so_date        TEXT NOT NULL,
  target_date    TEXT,
  status         TEXT NOT NULL DEFAULT 'CONFIRMED'
                 CHECK (status IN ('CONFIRMED','IN_PRODUCTION','READY_TO_SHIP','SHIPPED','DELIVERED','INVOICED','CLOSED','ON_HOLD','CANCELLED')),
  currency       TEXT NOT NULL DEFAULT 'MYR',
  subtotal_sen   INTEGER NOT NULL DEFAULT 0,
  tax_sen        INTEGER NOT NULL DEFAULT 0,
  total_sen      INTEGER NOT NULL DEFAULT 0,
  deposit_sen    INTEGER NOT NULL DEFAULT 0,
  paid_sen       INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  cancelled_at   TEXT,
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (doc_no)
);

CREATE TABLE sales_order_lines (
  id             TEXT PRIMARY KEY,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  line_no        INTEGER NOT NULL,
  item_code      TEXT NOT NULL,
  description    TEXT NOT NULL,
  uom            TEXT NOT NULL DEFAULT 'UNIT',
  qty            INTEGER NOT NULL DEFAULT 0,
  unit_price_sen INTEGER NOT NULL DEFAULT 0,
  discount_sen   INTEGER NOT NULL DEFAULT 0,
  line_total_sen INTEGER NOT NULL DEFAULT 0,
  delivered_qty  INTEGER NOT NULL DEFAULT 0,
  notes          TEXT
);

CREATE INDEX idx_so_status ON sales_orders (status);
CREATE INDEX idx_so_lines_so ON sales_order_lines (sales_order_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
