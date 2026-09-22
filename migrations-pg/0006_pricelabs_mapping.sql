-- DRAFT / feature-flagged OFF. Which PriceLabs listing a unit is linked to, if any.
-- PriceLabs sends recommended nightly rates keyed by its own listing_id; this column is
-- how the intake webhook (functions/api/pricelabs/webhook.ts) finds our unit for one.
-- A unit with no pricelabs_listing_id is simply never matched, so this is inert until a
-- listing is linked AND PRICELABS_WEBHOOK_SECRET is set. Nullable, so existing rows stay valid.
-- REVERSAL: ALTER TABLE units DROP COLUMN pricelabs_listing_id;
set local search_path = pos;

ALTER TABLE units ADD COLUMN pricelabs_listing_id TEXT;
CREATE INDEX units_pricelabs_listing_idx ON units(pricelabs_listing_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
