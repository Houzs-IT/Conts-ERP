-- REVERSAL: DROP INDEX IF EXISTS pos.audit_log_entity_id_idx;
-- A unit's history on the Units screen (functions/api/units/detail.ts) looks up audit_log by entity_id alone. The only
-- index starts with entity_table, so that lookup read the whole audit log on every unit opened (owner, 20 Oct 2026:
-- page speed). Index only: no code depends on it.
set local search_path = pos;

CREATE INDEX IF NOT EXISTS audit_log_entity_id_idx ON audit_log(entity_id, occurred_at DESC);
