-- Indexes for lookups the screens make on every open (performance audit, 11 Oct 2026). Each column below is read
-- by "one record's ..." queries that today scan the whole table: fine at 4,000 rows (about 1 ms), but these
-- tables grow with every booking, clean and save, and the audit log never shrinks.
--
--   tasks(unit_id), tasks(reservation_id)     a unit's jobs (unit page), a booking's cleans (booking drawer)
--   reservations(guest_id)                    a guest's stays (guest profile, guest list totals)
--   maintenance_issues(unit_id)               a unit's repairs (unit page, owner portal)
--   documents(unit_id)                        a unit's files (unit page)
--   message_threads(reservation_id)           a booking's conversation (booking drawer)
--   notification_log(entity_table, entity_id) messages sent about one record (booking drawer)
--   audit_log(occurred_at)                    System health's last-7-days counts and failure feed
--   statement_lines(statement_id)             one owner statement's lines (statement page, PDF, report)
--   payouts(statement_id)                     a statement's payout
--   owner_statements(period_start, period_end) the statements of one month (statements list, generate)
--
-- REVERSAL: DROP INDEX pos.<each name below>;
set local search_path = pos;

CREATE INDEX IF NOT EXISTS tasks_unit_idx ON tasks(unit_id);
CREATE INDEX IF NOT EXISTS tasks_reservation_idx ON tasks(reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reservations_guest_idx ON reservations(guest_id);
CREATE INDEX IF NOT EXISTS maintenance_issues_unit_idx ON maintenance_issues(unit_id, reported_at DESC);
CREATE INDEX IF NOT EXISTS documents_unit_idx ON documents(unit_id, created_at DESC) WHERE unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS message_threads_reservation_idx ON message_threads(reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notification_log_entity_idx ON notification_log(entity_table, entity_id, queued_at);
CREATE INDEX IF NOT EXISTS audit_log_occurred_idx ON audit_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS statement_lines_statement_idx ON statement_lines(statement_id, sort_order);
CREATE INDEX IF NOT EXISTS payouts_statement_idx ON payouts(statement_id) WHERE statement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS owner_statements_period_idx ON owner_statements(period_start, period_end);
