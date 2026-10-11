-- An owner's mailing address and an alternate contact (owner, 11 Oct 2026: "record every owner's name, address,
-- contact details"). The owners table had name, email, phone and IC but nowhere for an address. All optional, and
-- the code reads and writes these columns only when they exist: before this runs, the owner page simply hides the
-- address and alternate contact and a save ignores them.
--
--   owners.address_lines         street lines as typed, one per line (unit, building, street, area)
--   owners.address_postcode      postcode
--   owners.address_city          town or city
--   owners.address_state         state or region (Selangor, Kuala Lumpur, ...)
--   owners.address_country       country name as shown (default on screen: Malaysia)
--   owners.alt_contact_name      someone to reach when the owner cannot be reached (family member, agent)
--   owners.alt_contact_phone     that person's phone, international form
--   owners.alt_contact_relation  who they are to the owner (wife, son, agent)
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
--
-- REVERSAL: ALTER TABLE owners DROP COLUMN address_lines, DROP COLUMN address_postcode, DROP COLUMN address_city,
--   DROP COLUMN address_state, DROP COLUMN address_country, DROP COLUMN alt_contact_name, DROP COLUMN alt_contact_phone,
--   DROP COLUMN alt_contact_relation;
set local search_path = pos;

ALTER TABLE owners
  ADD COLUMN IF NOT EXISTS address_lines        TEXT,
  ADD COLUMN IF NOT EXISTS address_postcode     TEXT,
  ADD COLUMN IF NOT EXISTS address_city         TEXT,
  ADD COLUMN IF NOT EXISTS address_state        TEXT,
  ADD COLUMN IF NOT EXISTS address_country      TEXT,
  ADD COLUMN IF NOT EXISTS alt_contact_name     TEXT,
  ADD COLUMN IF NOT EXISTS alt_contact_phone    TEXT,
  ADD COLUMN IF NOT EXISTS alt_contact_relation TEXT;
