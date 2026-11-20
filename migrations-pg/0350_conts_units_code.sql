-- 0350_conts_units_code: the engine's view of the Property OS units also carries the code each unit is shown by.
--
-- public.conts_units (0178) gives the engine each unit's building and unit_number. unit_number is the number the unit
-- was imported with ("A1201") for 130 of 151 units, while Property OS shows the unit's code ("A-12-01", chew 20 Nov
-- 2026, #1084). The engine's finance screens (payment requests, vouchers) now name a line's unit the same way, so the
-- view gets unit_code: the code when set, else the number. unit_number stays as it is: files from AutoCount are still
-- matched on it (acc/opening-deposits.ts). A column added at the end keeps create or replace view valid and keeps
-- the grants (0178: select for scm_engine and service_role only).
--
-- REVERSAL:
--   drop view public.conts_units; then recreate it as in 0178 and grant select on it to scm_engine, service_role.

set local lock_timeout = '5s';

create or replace view public.conts_units as
  select u.id, p.name as building, u.unit_number, coalesce(nullif(btrim(u.unit_code), ''), u.unit_number) as unit_code
    from pos.units u join pos.properties p on p.id = u.property_id;
