-- Saved table views (10 Oct 2026). Every list in the app is one shared table (src/components/DataTable.tsx);
-- people can save how a table looks (which columns, in what order, sort, rows per page) together with its
-- filters, under a name, and pick one as their default. Management can save views for the whole company
-- and mark one of them as the company default, which applies to everyone who has no default of their own.
--
--   table_layouts   one saved view of one table.
--                   table_key  which table, e.g. 'bookings', 'guests', 'owner.statements'
--                   user_id    the person it belongs to; NULL = shared with the whole company
--                   is_default the one view that opens first (at most one per person per table, and at
--                              most one company default per table)
--                   layout     { columns: [{ key, hidden }], sort, pageSize, filters: { urlParam: value } }
--                              read and written only by functions/api/table-layouts, shape checked there
--
-- REVERSAL: DROP TABLE pos.table_layouts;
set local search_path = pos;

CREATE TABLE table_layouts (
  id         TEXT PRIMARY KEY,
  table_key  TEXT NOT NULL CHECK (table_key ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  is_default BOOLEAN NOT NULL DEFAULT false,
  layout     JSONB NOT NULL CHECK (jsonb_typeof(layout) = 'object'),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX table_layouts_table_idx ON table_layouts(table_key, user_id);
CREATE UNIQUE INDEX table_layouts_name_uq ON table_layouts(table_key, COALESCE(user_id, ''), lower(btrim(name)));
CREATE UNIQUE INDEX table_layouts_default_uq ON table_layouts(table_key, COALESCE(user_id, '')) WHERE is_default;

ALTER TABLE table_layouts OWNER TO pos_app;
ALTER TABLE table_layouts ENABLE ROW LEVEL SECURITY;
