-- A unit connected to a booking site before connecting set the flag itself stays "Not listed", so it is
-- left out of occupancy and the dashboard. From now on connecting marks it; this catches the ones already linked.
-- REVERSAL: none needed; a unit can be unmarked from its record.
set local search_path = pos;

UPDATE units SET is_listed = 1 WHERE is_listed = 0 AND id IN (SELECT unit_id FROM channex_channels);
