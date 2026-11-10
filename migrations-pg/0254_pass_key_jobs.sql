-- CONTS-0016 (10 Nov 2026): every check-in at a building that hands keys over in person becomes a Pass key job.
--
--   properties.needs_pass_key           the building's check-ins need someone to hand over a key (Skyline, Agile, Star Residence).
--   reservations.self_check_in          this guest lets themselves in, so no Pass key job is made.
--   maintenance_issues.reservation_id   the booking an automatic Pass key job is for; one job per booking.
--   maintenance_issues.source 'booking' made by the system from a booking.
--
-- REVERSAL:
--   DELETE FROM maintenance_issues WHERE source = 'booking';
--   DROP INDEX maintenance_issues_pass_key_reservation;
--   ALTER TABLE maintenance_issues DROP COLUMN reservation_id;
--   ALTER TABLE maintenance_issues DROP CONSTRAINT maintenance_issues_source_check;
--   ALTER TABLE maintenance_issues ADD CONSTRAINT maintenance_issues_source_check CHECK (source IN ('guest','cleaner','inspection','staff'));
--   ALTER TABLE reservations DROP COLUMN self_check_in;
--   ALTER TABLE properties DROP COLUMN needs_pass_key;
--   select demo.sync();
set local search_path = pos;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS needs_pass_key BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS self_check_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE maintenance_issues ADD COLUMN IF NOT EXISTS reservation_id TEXT REFERENCES reservations(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS maintenance_issues_pass_key_reservation
  ON maintenance_issues (reservation_id) WHERE reservation_id IS NOT NULL AND job_type = 'pass_key';

ALTER TABLE maintenance_issues DROP CONSTRAINT IF EXISTS maintenance_issues_source_check;
ALTER TABLE maintenance_issues ADD CONSTRAINT maintenance_issues_source_check
  CHECK (source IN ('guest','cleaner','inspection','staff','booking'));

select demo.sync();
