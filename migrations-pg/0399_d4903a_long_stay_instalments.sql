-- 0399_d4903a_long_stay_instalments: one-off data fix of one production booking, HMFA323EHS at SKYLINE D-49-03A
-- (reservation hp-res-0QEC6WSTN, 3 Sep - 31 Oct 2026, 58 nights), chew 27 Nov 2026 ("好，改吧"). On an empty database
-- (CI, staging) the row is not there and nothing changes.
--
-- Airbnb paid this long stay in two monthly instalments: RM 6,329.02 (Sep file) and RM 6,580.77 (Oct file), RM 12,909.79
-- for the stay (the Sep owner workbook: gross RM 15,604.73, the owner report counted RM 12,909.79). Only the Oct file is
-- uploaded to Airbnb reconciliation, so confirming the code on 17 Nov (decision ard-724ea3bc…, rule R8) set the
-- booking's guest total to RM 7,853.27, whose net (less Airbnb's fee RM 1,272.50) is the Oct instalment alone. From
-- October the owner statement reads the stay's net over all 58 nights, so October read RM 3,403.85 for the stay where the
-- owner report has RM 6,677.48 (RM 3,273.63 short).
--
-- The guest total becomes RM 14,182.29, so the net (fee unchanged, as reconciliation sets it) is RM 12,909.79 and October
-- reads 30/58 of it, RM 6,677.48. September is not touched: its statement is paid (from the workbook) and reads the
-- workbook's payout line (booking_payments), not this figure. Only when the booking still holds what reconciliation wrote.
--
-- REVERSAL:
--   update pos.reservations set gross_booking_value = 785327
--   where id = 'hp-res-0QEC6WSTN' and gross_booking_value = 1418229;

set local search_path = pos;
set local lock_timeout = '5s';

update reservations
   set gross_booking_value = 1418229, updated_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 where id = 'hp-res-0QEC6WSTN'
   and external_ref = 'HMFA323EHS'
   and gross_booking_value = 785327
   and channel_fee = 127250;
