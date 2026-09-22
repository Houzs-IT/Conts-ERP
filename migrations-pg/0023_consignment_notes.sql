-- Consignment Notes (sell-side), ported from 2990's SCM concept. Consign stock OUT to a
-- consignee (retailer/showroom); track consigned / sold / returned per line. Full 2990
-- sell-side consignment schema isn't in the base snapshot, so this is a bounded core.
-- Money integer sen. REVERSAL: DROP TABLE consignment_note_lines; DROP TABLE consignment_notes;
set local search_path = pos;

CREATE TABLE consignment_notes (
  id              TEXT PRIMARY KEY,
  cn_number       TEXT NOT NULL,
  consignee_name  TEXT NOT NULL,
  consignee_phone TEXT,
  cn_date         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PARTIALLY_SETTLED','CLOSED','CANCELLED')),
  notes           TEXT,
  total_sen       INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (cn_number)
);

CREATE TABLE consignment_note_lines (
  id                  TEXT PRIMARY KEY,
  consignment_note_id TEXT NOT NULL REFERENCES consignment_notes(id) ON DELETE CASCADE,
  line_no             INTEGER NOT NULL,
  item_code           TEXT NOT NULL,
  description         TEXT NOT NULL,
  uom                 TEXT NOT NULL DEFAULT 'UNIT',
  qty_consigned       INTEGER NOT NULL DEFAULT 0,
  qty_sold            INTEGER NOT NULL DEFAULT 0,
  qty_returned        INTEGER NOT NULL DEFAULT 0,
  unit_price_sen      INTEGER NOT NULL DEFAULT 0,
  line_total_sen      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_cn_status ON consignment_notes (status);
CREATE INDEX idx_cn_lines_cn ON consignment_note_lines (consignment_note_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
