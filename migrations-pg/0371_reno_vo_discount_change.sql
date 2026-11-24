-- A VO can change the contract's document discount (owner, 24 Nov 2026: the imported "Discount as per quotation" row
-- has to come off, or change, for the contract to match what the client pays).
-- { "fromSen": 897900, "toSen": 0, "label": "Discount as per quotation" }; null = the VO leaves the discount alone.

alter table scm.reno_variation_orders add column if not exists discount_change jsonb;

notify pgrst, 'reload schema';
