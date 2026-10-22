-- Paid late checkout (owner, 22 Oct 2026). Checkout is 11:00 by default; a guest may ask to stay later for a fee. Staff
-- record the request (from the cleaning job or the reservation) with the new time, the fee and a remark. The booking's
-- checkout time changes only once the guest has paid, which moves reservations.check_out_time (Cleaning plans the
-- turnover from it).
--
-- The fee is the company's, not the unit's (owner, 22 Oct 2026): it is kept here and never written to booking_payments,
-- so it stays out of the booking's money and the owner statement.
--
--   late_checkout_requests  one row per request. status: requested (waiting for the guest to pay), paid, cancelled.
--                           amount is sen. paid_on / method / reference describe the payment once paid.
--                           At most one open (requested) request per booking.
--
-- Optional: the code reads the table only when it exists, so the screens work as before on a database without it.
--
-- REVERSAL: DROP TABLE late_checkout_requests;  (checkout times stay as set)
set local search_path = pos;

CREATE TABLE IF NOT EXISTS late_checkout_requests (
  id             TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  checkout_time  TEXT NOT NULL CHECK (checkout_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  amount         INTEGER NOT NULL CHECK (amount > 0),
  remark         TEXT,
  status         TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','paid','cancelled')),
  paid_on        TEXT CHECK (paid_on IS NULL OR paid_on ~ '^\d{4}-\d{2}-\d{2}$'),
  method         TEXT,
  reference      TEXT,
  requested_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  requested_at   TEXT NOT NULL,
  closed_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  closed_at      TEXT,
  CHECK (status <> 'paid' OR paid_on IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS late_checkout_requests_one_open ON late_checkout_requests(reservation_id) WHERE status = 'requested';

GRANT SELECT, INSERT, UPDATE, DELETE ON late_checkout_requests TO pos_app;
