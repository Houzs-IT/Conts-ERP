-- Owner money screens (owner, 11 Oct 2026): the unit's standard cleaning price becomes its own field, and bills
-- The Conts pays for the owner gain a "building maintenance fee" kind. Additive only:
--
--   units.cleaning_price     the standard clean's price on this unit (sen). Read first by cleanPrice()
--                            (functions/_lib/cleaning.ts). Copied from the unit's 'cleaning' row in unit_expenses
--                            ("Recurring monthly costs"), the only row anything read, so every clean is priced as before.
--                            unit_expenses and its rows stay; the other rows were never deducted from any statement.
--   expenses.category        also 'building_fee' (the building's maintenance fee paid on the owner's behalf). The
--                            statement deducts it as an additional deduction, like every other owner-paid bill.
--
-- REVERSAL: ALTER TABLE pos.units DROP COLUMN cleaning_price;
--   UPDATE pos.expenses SET category = 'other' WHERE category = 'building_fee';
--   ALTER TABLE pos.expenses DROP CONSTRAINT expenses_category_check; ALTER TABLE pos.expenses ADD CONSTRAINT expenses_category_check
--   CHECK (category IN ('internet','electricity','water','sewerage','cleaning','housekeeping','maintenance','utilities','consumables','furniture','management_fee','channel_fee','other'));
set local search_path = pos;

ALTER TABLE units ADD COLUMN IF NOT EXISTS cleaning_price INTEGER CHECK (cleaning_price IS NULL OR cleaning_price >= 0);

UPDATE units u SET cleaning_price = x.amount
FROM (SELECT DISTINCT ON (unit_id) unit_id, amount FROM unit_expenses
      WHERE category = 'cleaning' AND amount > 0 ORDER BY unit_id, sort_order) x
WHERE x.unit_id = u.id AND u.cleaning_price IS NULL;

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_check CHECK (category IN
  ('internet','electricity','water','sewerage','cleaning','housekeeping','maintenance','utilities','consumables','furniture','management_fee','channel_fee','building_fee','other'));
