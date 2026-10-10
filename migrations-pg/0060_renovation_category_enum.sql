-- REVERSAL: none possible (Postgres cannot drop an enum value); the six values are harmless once 0061-0064 are reversed, because nothing else stores them.
-- The renovation catalog's six new category groups (WORKS, BUILTIN, FURNITURE, LIGHTING, APPLIANCE, SOFT) as
-- members of the product category enum. SERVICE already exists and is reused. Both copies of the enum carry
-- the list (scm, and Houzs's public copy), the same rule scm.acc_register_item_group follows, so a product can
-- never save in one schema and fail in the other.
-- Alone in its file: a value added by ALTER TYPE ... ADD VALUE cannot be used in the same transaction, and
-- scripts/migrate-pg.mjs runs each file in one transaction. 0061 uses them.
alter type scm.mfg_product_category add value if not exists 'WORKS';
alter type scm.mfg_product_category add value if not exists 'BUILTIN';
alter type scm.mfg_product_category add value if not exists 'FURNITURE';
alter type scm.mfg_product_category add value if not exists 'LIGHTING';
alter type scm.mfg_product_category add value if not exists 'APPLIANCE';
alter type scm.mfg_product_category add value if not exists 'SOFT';

alter type public.mfg_product_category add value if not exists 'WORKS';
alter type public.mfg_product_category add value if not exists 'BUILTIN';
alter type public.mfg_product_category add value if not exists 'FURNITURE';
alter type public.mfg_product_category add value if not exists 'LIGHTING';
alter type public.mfg_product_category add value if not exists 'APPLIANCE';
alter type public.mfg_product_category add value if not exists 'SOFT';
