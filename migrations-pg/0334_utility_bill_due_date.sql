-- REVERSAL: alter table pos.utility_bill_scans drop column if exists due_date;
-- A utility bill's due date (chew, 18 Nov 2026: finance wants to see when each utility must be paid). The engine reads it
-- off the scanned page ("Tarikh Akhir Bayaran", "Due date"); the Scan bills screen shows it for checking and records it
-- here with the bill. The payment request sent to finance takes the earliest due date of its bills as its "Wanted by".
-- Null: not printed, or a bill scanned before this.
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0334, dry run first.

set local search_path = pos, public;
set local lock_timeout = '5s';

alter table pos.utility_bill_scans add column if not exists due_date date;
