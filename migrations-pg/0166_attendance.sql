-- Attendance (HR phase 2, owner 26 Oct 2026, PLAN-hr-employees.md), ported from Hookka's punch clock.
-- Cleaners and technicians clock in and out on the portal; the office reads the day on Workers > Attendance.
--
--   attendance   one row per employee per Malaysia day. Location and selfie are recorded, never required: a phone that
--                refuses the camera or GPS still clocks in, and the office sees "No photo" / "No GPS" (Hookka's soft
--                geofence). A clock-in that finds an earlier day still open closes it as forgot_out; payroll pays that
--                day as a normal shift (Hookka rule, 16 Jun 2026). Times the office fixes keep who fixed them and why.
--                in_photo_id / out_photo_id are the selfies, documents rows stored in R2 like job photos.
--
-- Optional: the code reads attendance only when the table exists; without it the Clock screen and the Attendance tab
-- answer "needs a database update".
--
-- REVERSAL: DROP TABLE attendance;  (the selfies' documents rows and R2 objects under attendance/ stay)
set local search_path = pos;

CREATE TABLE IF NOT EXISTS attendance (
  id              TEXT PRIMARY KEY,
  employee_id     TEXT NOT NULL REFERENCES employees(id),
  work_date       TEXT NOT NULL CHECK (work_date ~ '^\d{4}-\d{2}-\d{2}$'),
  clock_in_at     TEXT NOT NULL,
  clock_out_at    TEXT,
  in_lat          DOUBLE PRECISION CHECK (in_lat BETWEEN -90 AND 90),
  in_lng          DOUBLE PRECISION CHECK (in_lng BETWEEN -180 AND 180),
  in_accuracy_m   INTEGER CHECK (in_accuracy_m >= 0),
  out_lat         DOUBLE PRECISION CHECK (out_lat BETWEEN -90 AND 90),
  out_lng         DOUBLE PRECISION CHECK (out_lng BETWEEN -180 AND 180),
  out_accuracy_m  INTEGER CHECK (out_accuracy_m >= 0),
  in_photo_id     TEXT REFERENCES documents(id) ON DELETE SET NULL,
  out_photo_id    TEXT REFERENCES documents(id) ON DELETE SET NULL,
  forgot_out      INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  edited_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (employee_id, work_date),
  CHECK (clock_out_at IS NULL OR clock_out_at >= clock_in_at)
);
-- The desk reads one day for everyone; employee_id is indexed by the UNIQUE constraint. The photo ids are only ever
-- read from their attendance row, so they need no index.
CREATE INDEX IF NOT EXISTS attendance_work_date_idx ON attendance(work_date);

ALTER TABLE attendance OWNER TO pos_app;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance TO pos_app;
