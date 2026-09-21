-- Tables the Conts ERP screens need that the original schema did not have.
-- REVERSAL: DROP TABLE channel_rates;  (add one DROP per table created below)
set local search_path = pos;

-- One row per unit, sales channel and night whose price was set by hand.
-- 'web' is the direct rate; nights with no row use the unit's base rate times the channel uplift.
CREATE TABLE channel_rates (
  unit_id    TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  channel    TEXT NOT NULL CHECK (channel IN ('web','airbnb','booking_com','agoda')),
  rate_date  TEXT NOT NULL,
  rate       INTEGER NOT NULL CHECK (rate >= 0),   -- sen
  updated_at TEXT NOT NULL,
  PRIMARY KEY (unit_id, channel, rate_date)
);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
