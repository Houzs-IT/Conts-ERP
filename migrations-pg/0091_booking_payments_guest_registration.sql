-- Bookings and guests (owner-approved design, 10 Oct 2026). Every change is additive: one new table for
-- money received against a booking, one counter for our own booking references, and new nullable or
-- defaulted columns on guests and reservations.
--
--   booking_payments        money received (or refunded) against a booking: a guest paying a direct booking,
--                           a booking site paying us out (one row per Airbnb monthly instalment), a refund.
--                           amount is always positive sen; kind says which way it went.
--                           status 'expected' is used only by the owner-workbook import, for an instalment
--                           Airbnb lists as not paid out yet (数据来源 待处理); everything typed in is 'received'.
--                           source 'owner_workbook' rows are rewritten by the import; 'manual' rows are people's.
--   booking_ref_counters    the last TC-YYMM-#### number handed out per month, so two bookings made at
--                           the same moment never get the same reference
--   reservations.staff_notes  internal notes people type; reservations.notes stays what the import or
--                           Channex wrote (re-imports rewrite it, so people's notes cannot live there)
--   guests                  manual tags (vip, blacklist), language, the registration details Malaysian
--                           short-stay rules ask for (id_type, id_number, date_of_birth; nationality is the
--                           existing country_code), internal notes, and merged_into for a duplicate that was
--                           merged into another guest (kept, not deleted, so a later re-import that names the
--                           old id is redirected instead of bringing the duplicate back)
--
-- Received on a booking = sum of its received booking_payments (refunds subtract) + what the booking already
-- carried from before this table (GREATEST(collected_revenue, payout_amount)), except that a booking with
-- workbook instalment rows counts those rows only, because the import writes the same money into both.
-- (functions/_lib/bookingMoney.ts)
--
-- REVERSAL:
--   DROP TABLE booking_payments; DROP TABLE booking_ref_counters;
--   ALTER TABLE reservations DROP COLUMN staff_notes;
--   ALTER TABLE guests DROP COLUMN tags, DROP COLUMN language, DROP COLUMN id_type, DROP COLUMN id_number,
--     DROP COLUMN date_of_birth, DROP COLUMN notes, DROP COLUMN merged_into;
set local search_path = pos;

CREATE TABLE booking_payments (
  id             TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  amount         INTEGER NOT NULL CHECK (amount > 0),
  received_on    TEXT CHECK (received_on IS NULL OR received_on ~ '^\d{4}-\d{2}-\d{2}$'),
  status         TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','expected')),
  method         TEXT,
  reference      TEXT,
  kind           TEXT NOT NULL CHECK (kind IN ('guest_payment','ota_payout','refund')),
  note           TEXT,
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','owner_workbook')),
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  CHECK (status = 'expected' OR source = 'owner_workbook' OR received_on IS NOT NULL)
);
CREATE INDEX booking_payments_reservation_idx ON booking_payments(reservation_id);

CREATE TABLE booking_ref_counters (
  month TEXT PRIMARY KEY CHECK (month ~ '^\d{4}$'),
  last  INTEGER NOT NULL CHECK (last > 0)
);

ALTER TABLE reservations ADD COLUMN staff_notes TEXT;

ALTER TABLE guests ADD COLUMN tags          TEXT NOT NULL DEFAULT '' CHECK (tags ~ '^((vip|blacklist)(,(vip|blacklist))*)?$');
ALTER TABLE guests ADD COLUMN language      TEXT;
ALTER TABLE guests ADD COLUMN id_type       TEXT CHECK (id_type IS NULL OR id_type IN ('mykad','passport','other'));
ALTER TABLE guests ADD COLUMN id_number     TEXT;
ALTER TABLE guests ADD COLUMN date_of_birth TEXT CHECK (date_of_birth IS NULL OR date_of_birth ~ '^\d{4}-\d{2}-\d{2}$');
ALTER TABLE guests ADD COLUMN notes         TEXT;
ALTER TABLE guests ADD COLUMN merged_into   TEXT REFERENCES guests(id) ON DELETE SET NULL;
CREATE INDEX guests_merged_into_idx ON guests(merged_into) WHERE merged_into IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON booking_payments, booking_ref_counters TO pos_app;
