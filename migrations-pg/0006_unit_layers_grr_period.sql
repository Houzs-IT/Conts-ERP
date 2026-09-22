-- Multi-layer units (a unit can hold sub-units / rooms) and a per-year entry mode for the GRR guarantee.
-- Every column is nullable or defaulted, so existing rows stay valid.
-- REVERSAL: ALTER TABLE units DROP COLUMN parent_unit_id, DROP COLUMN guarantee_period;
set local search_path = pos;

-- A sub-unit points at its parent unit. NULL = a top-level unit. Deleting a parent removes its sub-units.
ALTER TABLE units ADD COLUMN parent_unit_id TEXT REFERENCES units(id) ON DELETE CASCADE;
CREATE INDEX units_parent_idx ON units(parent_unit_id);

-- How the guaranteed rent was entered. split_value stays canonical sen-per-MONTH either way;
-- this only records whether the operator typed a monthly or an annual figure, so the form re-opens the same way.
ALTER TABLE units ADD COLUMN guarantee_period TEXT NOT NULL DEFAULT 'month' CHECK (guarantee_period IN ('month','year'));
