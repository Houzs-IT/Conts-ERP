-- REVERSAL: none possible (Postgres cannot drop an enum value); the value is harmless once 0163 is reversed, because nothing else stores it.
-- A new product group, Airbnb supplies (owner, 26 Oct 2026): kitchenware, cleaning things, consumables and labels
-- that only an Airbnb unit needs. Both copies of the enum carry it, as 0060 did for the renovation groups.
-- Alone in its file: a value added by ALTER TYPE ... ADD VALUE cannot be used in the same transaction. 0163 uses it.
alter type scm.mfg_product_category add value if not exists 'AIRBNB';
alter type public.mfg_product_category add value if not exists 'AIRBNB';
