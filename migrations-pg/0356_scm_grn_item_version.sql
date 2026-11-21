-- REVERSAL: ALTER TABLE scm.grn_items DROP COLUMN version; (revert the engine code that selects it first).
-- GRANTS: none.
--
-- A GRN line carries a version, so two people editing one line cannot both move its stock (PR #1126 deferred D7).
--
-- THE BUG. PATCH /grns/:id/items/:itemId read the line, computed the stock delta from the qty it read, then wrote the
--   line with no condition. Two editors both read qty 10; one saved 6 (stock OUT 4), the other 8 (stock OUT 2). Both
--   writes landed and both stock moves landed: the line said 8 while the shelf had lost 6.
--
-- THE FIX. The edit writes `version = read + 1` WHERE version = read AND qty_accepted = read. The second save matches
--   no row, moves no stock, and is told to reload. Only the line edit compares it; other writers of grn_items leave it
--   alone, which is why the route also compares qty_accepted itself.
--
-- Adding a NOT NULL column with a constant default rewrites nothing on PostgreSQL 11+ (metadata only).

ALTER TABLE scm.grn_items ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
