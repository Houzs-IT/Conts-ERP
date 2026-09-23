-- Delivery Rate Cards ("Carriers & Rates"), ported from 2990's SCM (delivery_rate_cards +
-- delivery_rate_rules). A card is one carrier's freight tariff; its rules are the priced
-- lines the pure engine (functions/_lib/rate-card-compute.ts) sums into a delivery cost:
-- positional tiers, overage cap, sofa compartment brackets, outstation zone surcharges, and
-- per-occurrence charges (dispose/setup/dismantle/service/pickup/inspection/transfer), all
-- inside the card's min-charge / cap / rounding envelope. Money integer sen.
-- REVERSAL: DROP TABLE delivery_rate_rules; DROP TABLE delivery_rate_cards;
set local search_path = pos;

CREATE TABLE delivery_rate_cards (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  carrier_company_id TEXT REFERENCES threepl_companies(id),
  carrier_label      TEXT,
  basis              TEXT NOT NULL DEFAULT 'SET' CHECK (basis IN ('SET','ITEM')),
  aggregation        TEXT NOT NULL DEFAULT 'UNIT' CHECK (aggregation IN ('UNIT','DROP','CUSTOMER','TRIP')),
  min_charge_sen     INTEGER,
  cap_sen            INTEGER,
  rounding           TEXT NOT NULL DEFAULT 'NONE' CHECK (rounding IN ('NONE','NEAREST_10C','NEAREST_RM')),
  is_active          INTEGER NOT NULL DEFAULT 1,
  notes              TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE delivery_rate_rules (
  id            TEXT PRIMARY KEY,
  card_id       TEXT NOT NULL REFERENCES delivery_rate_cards(id) ON DELETE CASCADE,
  rule_type     TEXT NOT NULL CHECK (rule_type IN (
                  'POSITIONAL_TIER','OVERAGE','SOFA_BRACKET','OUTSTATION','OUTSTATION_TRIP',
                  'DISPOSE','SETUP','DISMANTLE','SERVICE','PICKUP','INSPECTION','TRANSFER')),
  tier_position INTEGER,
  bracket_min   INTEGER,
  bracket_max   INTEGER,
  zone          TEXT,
  amount_sen    INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_ratecard_active ON delivery_rate_cards (is_active);
CREATE INDEX idx_ratecard_carrier ON delivery_rate_cards (carrier_company_id);
CREATE INDEX idx_raterule_card ON delivery_rate_rules (card_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
