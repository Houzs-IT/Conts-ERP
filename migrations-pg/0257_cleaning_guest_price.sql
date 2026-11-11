-- The guest's cleaning fee in the cleaning price table (chew, 10 Nov 2026: "charge guest 的也放一起"). One table by
-- number of beds holds, for Basic and Deep clean, what the owner is charged, what the guest is charged and the
-- cleaner's pay; a unit's own prices can set the guest's fee too (Arte MK2-27-16).
--
--   service_item_prices.guest_price   sen; what a guest is charged for this clean. Null = not set.
--   unit_service_prices.guest_price   sen; a unit's own guest fee, ahead of the list's. Null = the list's.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0257 (the Demo overlay
-- rebuild below is refused by the session's database tool). The code checks the columns exist, so it can be deployed
-- before or after this runs. Columns on existing tables: no new grant needed.
--
-- REVERSAL: set both columns back to null. Removing them goes together with a redeploy: running workers remember
-- that they exist.
set local search_path = pos;

alter table service_item_prices add column if not exists guest_price integer check (guest_price is null or guest_price >= 0);
alter table unit_service_prices add column if not exists guest_price integer check (guest_price is null or guest_price >= 0);

-- Rebuild the Demo mode overlay (migration 0203) so demo_pos has the new columns too.
select demo.drop_views();
select demo.sync();
