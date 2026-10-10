-- REVERSAL: ALTER TABLE units DROP COLUMN weekend_rate; ALTER TABLE reservations DROP COLUMN block_reason;
--   (and put WEEKEND_MULTIPLIER back into functions/_lib/channelPrice.ts, or weekend nights sell at the base rate)
-- Weekend price per unit, replacing the 22% weekend multiplier that was hard-coded for every unit.
--
--   units.weekend_rate     the direct (web) price of a Friday or Saturday night, in sen. NULL: weekend nights
--                          sell at the base rate. Each channel adds its own uplift on top, as on weekdays.
--                          Backfilled with round(base_rate * 1.22) for every unit that has a base rate, so no
--                          live weekend price moves when this ships: those units sold Fri/Sat at the multiplier.
--   reservations.block_reason  why dates are held: 'maintenance', 'owner_stay' or 'other'. Blocks made before
--                          this could only be maintenance, so existing maintenance blocks are marked so.
-- Additive only.
set local search_path = pos;

ALTER TABLE units ADD COLUMN IF NOT EXISTS weekend_rate INTEGER CHECK (weekend_rate IS NULL OR weekend_rate > 0);
UPDATE units SET weekend_rate = round(base_rate * 1.22)::int WHERE weekend_rate IS NULL AND base_rate > 0;

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS block_reason TEXT CHECK (block_reason IS NULL OR block_reason IN ('maintenance','owner_stay','other'));
UPDATE reservations SET block_reason = 'maintenance' WHERE channel = 'maintenance_block' AND block_reason IS NULL;
