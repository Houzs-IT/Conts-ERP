-- Owner Showcase (CONTS-0006, Loo Wen Wei, 26 Oct 2026). Sales staff open the Owner Showcase in front of a prospective
-- owner; Showcase control lets them replace any portfolio-level figure it shows with a typed value, and switch each
-- one back to the live figure. One copy for the whole company (Samuel, 26 Oct 2026), so every salesperson and every
-- device shows the same numbers.
--
--   showcase_overrides  one row per figure (key, e.g. occ_rate, rev_count; the list is functions/_lib/showcase.ts).
--                       value is the typed figure; active says whether the showcase uses it (a stored value can stay
--                       switched off). Clearing a figure deletes its row.
--
-- Optional: the code reads the table only when it exists, so the showcase shows live figures on a database without it.
--
-- REVERSAL: DROP TABLE showcase_overrides;
set local search_path = pos;

CREATE TABLE IF NOT EXISTS showcase_overrides (
  key        TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,31}$'),
  value      DOUBLE PRECISION NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON showcase_overrides TO pos_app;
