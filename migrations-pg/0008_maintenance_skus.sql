-- Maintenance SKU catalog: a master list of repair items (down to "change a lightbulb"),
-- each with a preset selling price (卖价, integer sen) the operator can pull into a job.
-- Also records, on each maintenance job, which SKU it came from and the start/end time of the
-- work so the duration can be shown for efficiency control. The money loop (final_amount →
-- maintenance expense → owner statement) is unchanged; a SKU only seeds the quote.
-- REVERSAL: DROP TABLE pos.maintenance_skus;
--           ALTER TABLE pos.maintenance_issues DROP COLUMN sku_id;
--           ALTER TABLE pos.maintenance_issues DROP COLUMN started_at;
--           ALTER TABLE pos.maintenance_issues DROP COLUMN ended_at;
set local search_path = pos;

CREATE TABLE maintenance_skus (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'general'
                CHECK (category IN ('plumbing','electrical','aircon','furniture','appliance','cleaning','general','other')),
  unit_label    TEXT NOT NULL DEFAULT 'job',   -- what the price is per: 'job', 'unit', 'hour'
  default_price INTEGER NOT NULL DEFAULT 0,     -- preset selling price, sen
  active        INTEGER NOT NULL DEFAULT 1,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX maintenance_skus_code_key ON maintenance_skus(lower(code));

-- Which catalog item a job was raised from (nullable — ad-hoc jobs have none), plus the
-- start/end stamps that give the repair its duration.
ALTER TABLE maintenance_issues ADD COLUMN sku_id     TEXT REFERENCES maintenance_skus(id) ON DELETE SET NULL;
ALTER TABLE maintenance_issues ADD COLUMN started_at TEXT;
ALTER TABLE maintenance_issues ADD COLUMN ended_at   TEXT;

-- Every table in pos is owned by pos_app and has RLS enabled (mirrors 0005).
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
