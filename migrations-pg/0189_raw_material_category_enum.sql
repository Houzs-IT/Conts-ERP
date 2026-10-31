-- REVERSAL: none possible (Postgres cannot drop an enum value); the value is harmless once 0190 is reversed, because nothing else stores it.
-- A new product group, Raw material (owner, 1 Nov 2026): cement, wire, gypsum board and the like that the in-house
-- production team orders for a production order. Both copies of the enum carry it, as 0162 did for AIRBNB.
-- Alone in its file: a value added by ALTER TYPE ... ADD VALUE cannot be used in the same transaction. 0190 uses it.
alter type scm.mfg_product_category add value if not exists 'RAW';
alter type public.mfg_product_category add value if not exists 'RAW';
