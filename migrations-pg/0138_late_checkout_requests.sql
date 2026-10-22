-- Paid late checkout (owner, 22 Oct 2026). Checkout is 11:00 by default; a guest may ask to stay later for a fee. Staff
-- record the request with the new time, the amount and a remark. The booking's checkout time changes only once the guest
-- has paid: marking it paid records the fee as a guest payment on the booking (so it counts as unit income on the owner
-- statement, owner's choice) and moves reservations.check_out_time, which Cleaning plans the turnover from.
--
--   late_checkout_requests  one row per request. status: requested (waiting for the guest to pay), paid, cancelled.
--                           amount is sen. payment_id is the booking_payments row made when it was paid.
--                           At most one open (requested) request per booking.
--
-- Optional: the code reads the table only when it exists, so a booking opens as before on a database without it.
--
-- REVERSAL: DROP TABLE late_checkout_requests;  (paid fees stay as booking_payments, times stay as set)
set local search_path = pos;

CREATE TABLE IF NOT EXISTS late_checkout_requests (
  id             TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  checkout_time  TEXT NOT NULL CHECK (checkout_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  amount         INTEGER NOT NULL CHECK (amount > 0),
  remark         TEXT,
  status         TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','paid','cancelled')),
  payment_id     TEXT REFERENCES booking_payments(id) ON DELETE SET NULL,
  requested_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  requested_at   TEXT NOT NULL,
  closed_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  closed_at      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS late_checkout_requests_one_open ON late_checkout_requests(reservation_id) WHERE status = 'requested';

GRANT SELECT, INSERT, UPDATE, DELETE ON late_checkout_requests TO pos_app;
