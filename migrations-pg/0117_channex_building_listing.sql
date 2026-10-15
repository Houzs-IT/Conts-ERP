-- REVERSAL: ALTER TABLE properties DROP COLUMN channex_property_id;
-- A building's Channex listing (owner, 15 Oct 2026). Booking.com sells a building as one property whose room types
-- are the units (Host Platform, 14 Oct 2026: Continew 14 room types for 14 units, Trion KL 12 for 12), and a
-- Booking.com hotel can be connected to one Channex property only. So a unit set up in Channex from now on becomes a
-- room type inside its building's Channex property, made with the building's first unit. Units set up before this
-- keep the property of their own (units.channex_property_id is still each unit's property, shared or not).
set local search_path = pos;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS channex_property_id TEXT;
