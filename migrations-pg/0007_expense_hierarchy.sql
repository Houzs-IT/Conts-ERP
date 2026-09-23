-- Expense drill-down (Monthly expenses screen: L1 Total -> L2 category -> L3 line items).
-- parent_expense_id lets a line item nest under a parent expense — e.g. a maintenance
-- rollup ("Plumbing works") whose children are labour + parts — so the unit's monthly
-- expenses (and the owner statement) can drill Total -> category -> items.
-- Additive and idempotent: every existing expense stays top-level (NULL parent).
-- See conts-buildout-plan.html, screen "整屏 D · Monthly expenses".
set local search_path = pos;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS parent_expense_id TEXT REFERENCES expenses(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS expenses_parent_idx ON expenses(parent_expense_id);
