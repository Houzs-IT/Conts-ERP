-- Reservation payments (owner, 12 Nov 2026): the money on a booking (recording a payment or refund, a host payout, guest
-- receipts and invoices, late checkout paid) gets its own area, reservationPayments, in the Reservations category. It
-- followed Finance, so finance staff had it without changing bookings, but nobody could see where it was set.
--
-- Nobody's level changes on the day it ships: reservationPayments takes everyone's Finance level. It moves category
-- (Finance to Reservations), so a Finance baseline no longer reaches it and a Reservations baseline would. So:
--   1. every stored finance row is copied, at every scope;
--   2. a position whose Finance baseline decided finance (no finance row on it or its department) is pinned to it;
--   3. every department without its own finance row is pinned to its Finance baseline, or none.
-- After 2 and 3 no Reservations baseline decides reservationPayments for anyone who has a department today.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0311, dry run first.
-- REVERSAL: DELETE FROM pos.access_rules WHERE updated_by = 'migration 0311';
set local search_path = pos;

-- 1.
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT r.scope, r.scope_id, 'reservationPayments', r.level, 'migration 0311'
FROM access_rules r
WHERE r.area = 'finance'
ON CONFLICT (scope, scope_id, area) DO NOTHING;

-- 2.
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'position', p.id, 'reservationPayments', position_finance.level, 'migration 0311'
FROM positions p
JOIN access_rules position_finance ON position_finance.scope = 'position' AND position_finance.scope_id = p.id
  AND position_finance.area = 'group:Finance' AND position_finance.level <> 'inherit'
WHERE NOT EXISTS (SELECT 1 FROM access_rules area_row
                   WHERE area_row.area = 'finance' AND area_row.level <> 'inherit'
                     AND ((area_row.scope = 'position' AND area_row.scope_id = p.id)
                       OR (area_row.scope = 'department' AND area_row.scope_id = p.department_id)))
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by
  WHERE access_rules.level = 'inherit';

-- 3.
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'department', d.id, 'reservationPayments', COALESCE(department_finance.level, 'none'), 'migration 0311'
FROM departments d
LEFT JOIN access_rules department_finance ON department_finance.scope = 'department' AND department_finance.scope_id = d.id
  AND department_finance.area = 'group:Finance' AND department_finance.level <> 'inherit'
WHERE NOT EXISTS (SELECT 1 FROM access_rules area_row
                   WHERE area_row.scope = 'department' AND area_row.scope_id = d.id
                     AND area_row.area = 'finance' AND area_row.level <> 'inherit')
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by
  WHERE access_rules.level = 'inherit';
