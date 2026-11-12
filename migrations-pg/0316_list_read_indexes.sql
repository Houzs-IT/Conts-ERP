-- Faster reads for the Maintenance list and the Cleaning board (performance, 12 Nov 2026: the job list took 1.8 s and
-- the board 1.2 s on production). Indexes only: no table, column or row changes, so nothing reads differently.
--
--   documents_maintenance_idx   GET /api/maintenance/issues counts each job's photos and files (documents.maintenance_id,
--                               with kind). Until now every job's count read the whole documents table.
--   expenses_maintenance_idx    the same list sums each job's expenses and finds the first one (expenses.maintenance_id).
--   reservations_check_out_idx  the board's departures (WHERE r.check_out = day) and the turnover planning in
--                               lib/cleaning.ts ensureTurnovers (check_out between two days) read by checkout day; the
--                               existing index leads with unit_id, so neither could use it.
--
-- Plain CREATE INDEX: scripts/migrate-pg.mjs runs each file in one transaction, where CONCURRENTLY is not allowed. Each
-- holds back writes to its table while it builds (well under a second at today's sizes); lock_timeout stops it from
-- waiting behind a long write.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0316, dry run first.
-- REVERSAL: drop index if exists pos.documents_maintenance_idx, pos.expenses_maintenance_idx, pos.reservations_check_out_idx;
set local search_path = pos;
set local lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS documents_maintenance_idx ON documents (maintenance_id, kind) WHERE maintenance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS expenses_maintenance_idx ON expenses (maintenance_id) WHERE maintenance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reservations_check_out_idx ON reservations (check_out);
