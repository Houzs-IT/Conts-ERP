-- Sales Order Amendments, ported from 2990's SCM so-amendments (the CORE workflow — the
-- Houzs 2990-mirror/lane/lease/PO-cascade machinery is bridge-specific and dropped for
-- single-tenant Conts). An amendment lets a confirmed SO be changed through a controlled
-- flow: REQUESTED -> APPROVED -> APPLIED, or REJECTED / CANCELLED. Applying rewrites the SO
-- lines (guarded by delivered qty) and recomputes the SO totals. Money integer sen.
-- REVERSAL: DROP TABLE so_amendment_lines; DROP TABLE so_amendments;
set local search_path = pos;

CREATE TABLE so_amendments (
  id             TEXT PRIMARY KEY,
  amendment_no   TEXT NOT NULL,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id),
  so_doc_no      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'REQUESTED'
                 CHECK (status IN ('REQUESTED','APPROVED','APPLIED','REJECTED','CANCELLED')),
  reason         TEXT,
  requested_by   TEXT,
  applied_at     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (amendment_no)
);

CREATE TABLE so_amendment_lines (
  id                  TEXT PRIMARY KEY,
  amendment_id        TEXT NOT NULL REFERENCES so_amendments(id) ON DELETE CASCADE,
  sales_order_line_id TEXT REFERENCES sales_order_lines(id),   -- null = a line to ADD
  action              TEXT NOT NULL DEFAULT 'CHANGE' CHECK (action IN ('CHANGE','ADD','REMOVE')),
  line_no             INTEGER NOT NULL,
  item_code           TEXT NOT NULL,
  description         TEXT NOT NULL,
  uom                 TEXT NOT NULL DEFAULT 'UNIT',
  old_qty             INTEGER,
  old_unit_price_sen  INTEGER,
  new_qty             INTEGER NOT NULL DEFAULT 0,
  new_unit_price_sen  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_soamd_so ON so_amendments (sales_order_id);
CREATE INDEX idx_soamd_status ON so_amendments (status);
CREATE INDEX idx_soamd_lines ON so_amendment_lines (amendment_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
