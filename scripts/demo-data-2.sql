-- TEMPORARY DEMO DATA, part 2. Fills in every table the original design package
-- never wrote seed rows for (maintenance, tasks, reviews, pricing, inbox,
-- automations, contracts, statements, payouts, expenses, inspections, inventory,
-- access codes) — content adapted from the example values baked into each
-- screen's own FALLBACK constant, anchored to the 3 real fake properties/owners
-- already loaded by demo-data-1.sql rather than inventing new ones with no
-- proper ownership chain. Run only after demo-data-1.sql. Delete both together
-- with delete-demo-data.sql once real data replaces this.

-- Bank details for the 3 demo owners (statements/payouts reference these).
UPDATE owners SET bank_name = 'Maybank', bank_account_last4 = '4417' WHERE id = '22222222-2222-4222-8222-000000000001';
UPDATE owners SET bank_name = 'CIMB',    bank_account_last4 = '8802' WHERE id = '22222222-2222-4222-8222-000000000002';
UPDATE owners SET bank_name = 'Maybank', bank_account_last4 = '1193' WHERE id = '22222222-2222-4222-8222-000000000003';

-- Two more guests and two more reservations, so unit 2 and unit 3 (not just
-- unit 1) have bookings — Bookings, Calendar, Guests and Analytics all need this.
INSERT INTO guests (id, full_name, email, phone, country_code, created_at) VALUES
 ('66666666-6666-4666-8666-000000000003','Priya Sundaram','priya@example.com','+65 8111 0003','SG','2026-09-01T00:00:00Z'),
 ('66666666-6666-4666-8666-000000000004','Chen Yu','chen@example.com','+86 131 1100 04','CN','2026-09-01T00:00:00Z');

INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, guests_count, gross_booking_value, channel_fee, collected_revenue, created_at, updated_at) VALUES
 ('77777777-0000-4000-8000-000000000003','55555555-5555-4555-8555-000000000002','66666666-6666-4666-8666-000000000003','booking_com','BDC-5512087','confirmed','2026-09-16','2026-09-23',2,161700,20200,141500,'2026-09-02T00:00:00Z','2026-09-02T00:00:00Z'),
 ('77777777-0000-4000-8000-000000000004','55555555-5555-4555-8555-000000000003','66666666-6666-4666-8666-000000000004','agoda','AGD-330912','confirmed','2026-09-11','2026-09-16',2,159000,19800,139200,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');

INSERT INTO reviews (id, unit_id, reservation_id, channel, rating, comment, reviewed_at) VALUES
 ('demo-review-001','55555555-5555-4555-8555-000000000001',NULL,'airbnb',5,'Spotless and exactly as described. Check-in instructions were clear.','2026-09-14T00:00:00Z'),
 ('demo-review-002','55555555-5555-4555-8555-000000000002',NULL,'booking_com',5,'Great location, quick responses from the host.','2026-09-12T00:00:00Z'),
 ('demo-review-003','55555555-5555-4555-8555-000000000003',NULL,'agoda',5,'Best value in the city. Would stay again.','2026-09-10T00:00:00Z');

INSERT INTO tasks (id, unit_id, reservation_id, kind, state, title, instructions, assignee_id, scheduled_for, due_at, next_guest_at, started_at, completed_at, completed_by, requires_photo, sync, created_at, updated_at) VALUES
 ('demo-task-001','55555555-5555-4555-8555-000000000001',NULL,'turnover','in_progress','Turnover, 2BR','Late check-out to 13:00.','11111111-1111-4111-8111-000000000005','2026-09-18','2026-09-18T14:30:00Z','2026-09-18T15:00:00Z',NULL,NULL,NULL,1,'synced','2026-09-18T06:00:00Z','2026-09-18T06:00:00Z'),
 ('demo-task-002','55555555-5555-4555-8555-000000000002',NULL,'turnover','assigned','Turnover, studio','Early check-in requested.','11111111-1111-4111-8111-000000000005','2026-09-18','2026-09-18T15:30:00Z','2026-09-18T16:00:00Z',NULL,NULL,NULL,1,'synced','2026-09-18T06:00:00Z','2026-09-18T06:00:00Z'),
 ('demo-task-003','55555555-5555-4555-8555-000000000003',NULL,'deep_clean','overdue','Deep clean','Vacant, 4 nights.',NULL,'2026-09-17','2026-09-17T16:30:00Z','2026-09-19T00:00:00Z',NULL,NULL,NULL,1,'synced','2026-09-17T06:00:00Z','2026-09-17T06:00:00Z'),
 ('demo-task-004','55555555-5555-4555-8555-000000000001',NULL,'inspection','resolved','Owner report photos',NULL,'11111111-1111-4111-8111-000000000005',NULL,'2026-09-15T16:30:00Z',NULL,'2026-09-15T15:00:00Z','2026-09-15T16:20:00Z','11111111-1111-4111-8111-000000000005',0,'synced','2026-09-15T09:00:00Z','2026-09-15T16:20:00Z');

INSERT INTO maintenance_issues (id, unit_id, reported_by, state, title, detail, vendor_name, quoted_amount, final_amount, owner_approval_required, owner_approved_at, blocks_unit, blocked_from, blocked_to, charge_to, reported_at, resolved_at, created_at, updated_at) VALUES
 ('demo-mnt-001','55555555-5555-4555-8555-000000000001','11111111-1111-4111-8111-000000000001','waiting','Curtain replacement quoted','Blackout curtains, 3 windows. Awaiting owner approval.','Kiara Interiors',89000,NULL,1,NULL,0,NULL,NULL,'owner','2026-09-12T00:00:00Z',NULL,'2026-09-12T00:00:00Z','2026-09-12T00:00:00Z'),
 ('demo-mnt-002','55555555-5555-4555-8555-000000000001','11111111-1111-4111-8111-000000000001','resolved','Aircon service','Quarterly service. Gas top-up not required.','CoolCare',NULL,18000,0,NULL,0,NULL,NULL,'owner','2026-09-10T00:00:00Z','2026-09-10T15:00:00Z','2026-09-10T00:00:00Z','2026-09-10T15:00:00Z'),
 ('demo-mnt-003','55555555-5555-4555-8555-000000000002','11111111-1111-4111-8111-000000000001','open','Broken blind, living room','Guest reported on arrival. Inspect before next stay.',NULL,NULL,NULL,0,NULL,0,NULL,NULL,'owner','2026-09-16T00:00:00Z',NULL,'2026-09-16T00:00:00Z','2026-09-16T00:00:00Z'),
 ('demo-mnt-004','55555555-5555-4555-8555-000000000003','11111111-1111-4111-8111-000000000001','in_progress','Plumbing works','Riser replacement. Unit offline temporarily.','AquaFix',320000,NULL,0,NULL,1,'2026-09-14','2026-09-22','owner','2026-09-14T00:00:00Z',NULL,'2026-09-14T00:00:00Z','2026-09-14T00:00:00Z');

INSERT INTO inspections (id, unit_id, task_id, inspector_id, state, passed, checklist, notes, inspected_at, created_at) VALUES
 ('demo-ins-001','55555555-5555-4555-8555-000000000003',NULL,'11111111-1111-4111-8111-000000000001','assigned',NULL,'[{"item":"Linen set complete and pressed","ok":null},{"item":"Bathroom sealed and dry","ok":null},{"item":"Consumables restocked","ok":null},{"item":"Aircon cooling within 10 minutes","ok":null},{"item":"Wifi reachable at 20 Mbps","ok":null}]',NULL,NULL,'2026-09-17T00:00:00Z'),
 ('demo-ins-002','55555555-5555-4555-8555-000000000001',NULL,'11111111-1111-4111-8111-000000000001','resolved',1,'[{"item":"Linen set complete and pressed","ok":true},{"item":"Bathroom sealed and dry","ok":true},{"item":"Consumables restocked","ok":true},{"item":"Aircon cooling within 10 minutes","ok":true},{"item":"Wifi reachable at 20 Mbps","ok":true}]',NULL,'2026-09-15T16:10:00Z','2026-09-15T14:00:00Z');

INSERT INTO inventory_items (id, unit_id, name, quantity, condition, supplied_in_house, purchase_cost, installed_on, last_checked, created_at) VALUES
 ('demo-inv-001','55555555-5555-4555-8555-000000000001','Queen bed frame and mattress','1 set','good',1,320000,'2025-03-01','2026-09-12','2025-03-01T00:00:00Z'),
 ('demo-inv-002','55555555-5555-4555-8555-000000000001','Three-seater fabric sofa','1','fair',1,185000,'2025-03-01','2026-09-12','2025-03-01T00:00:00Z'),
 ('demo-inv-003','55555555-5555-4555-8555-000000000001','Blackout curtains','3 windows','replace_soon',1,89000,'2025-03-01','2026-09-12','2025-03-01T00:00:00Z'),
 ('demo-inv-004','55555555-5555-4555-8555-000000000002','Living room blind','1','damaged',1,42000,'2025-06-05','2026-09-16','2025-06-05T00:00:00Z'),
 ('demo-inv-005','55555555-5555-4555-8555-000000000002','Kitchenware bundle','1 set','good',1,68000,'2025-06-05','2026-09-10','2025-06-05T00:00:00Z'),
 ('demo-inv-006','55555555-5555-4555-8555-000000000003','Dining table and 4 chairs','1 set','good',1,240000,'2024-11-05','2026-09-08','2024-11-05T00:00:00Z');

INSERT INTO access_credentials (id, unit_id, kind, label, secret, instruction, rotates_after_stay, updated_at) VALUES
 ('demo-acc-001','55555555-5555-4555-8555-000000000001','smart_lock','Main door','4417#','Smart lock 4417#. Lobby via the guard — say The Conts.',1,'2026-09-13T00:00:00Z'),
 ('demo-acc-002','55555555-5555-4555-8555-000000000002','key_box','Key box B2','2208','Key box B2, code 2208. Lift card at the counter.',0,'2025-06-01T00:00:00Z'),
 ('demo-acc-003','55555555-5555-4555-8555-000000000003','smart_lock','Main door','9021#','Smart lock 9021#. Parking at level B2.',1,'2026-09-14T00:00:00Z');

INSERT INTO pricing_rules (id, unit_id, name, starts_on, ends_on, weekday_rate, weekend_rate, min_nights, is_active) VALUES
 ('demo-price-001','55555555-5555-4555-8555-000000000001','Standard rate',NULL,NULL,28400,34700,1,1),
 ('demo-price-002','55555555-5555-4555-8555-000000000002','Standard rate',NULL,NULL,23100,28200,1,1),
 ('demo-price-003','55555555-5555-4555-8555-000000000003','Standard rate',NULL,NULL,31800,38800,2,1);

INSERT INTO message_threads (id, reservation_id, guest_id, owner_id, channel, subject, is_read, last_message_at) VALUES
 ('demo-thread-001','77777777-0000-4000-8000-000000000003','66666666-6666-4666-8666-000000000003',NULL,'booking_com','Early check-in request',0,'2026-09-16T13:45:00Z'),
 ('demo-thread-002','77777777-0000-4000-8000-000000000002','66666666-6666-4666-8666-000000000002',NULL,'direct','Parking access',0,'2026-09-16T11:20:00Z'),
 ('demo-thread-003','77777777-0000-4000-8000-000000000001','66666666-6666-4666-8666-000000000001',NULL,'airbnb','Check-in details',1,'2026-09-15T09:00:00Z');

INSERT INTO messages (id, thread_id, direction, sender_id, body, sent_at, is_automated) VALUES
 ('demo-msg-001','demo-thread-001','inbound',NULL,'Hi, our flight lands at noon. Would 14:00 check-in be possible?','2026-09-16T13:45:00Z',0),
 ('demo-msg-002','demo-thread-002','inbound',NULL,'Is there a parking bay included?','2026-09-16T11:20:00Z',0),
 ('demo-msg-003','demo-thread-003','inbound',NULL,'Received, thank you.','2026-09-15T09:00:00Z',0);

INSERT INTO automations (id, name, trigger, offset_hours, template, is_active) VALUES
 ('demo-auto-001','Booking confirmed','reservation.confirmed',0,'guest.booking_confirmed',1),
 ('demo-auto-002','Pre-arrival details','reservation.check_in',-48,'guest.pre_arrival',1),
 ('demo-auto-003','Access code','unit.ready',-2,'guest.access_details',1),
 ('demo-auto-004','Check-out reminder','reservation.check_out',-12,'guest.checkout_reminder',1),
 ('demo-auto-005','Review request','reservation.checked_out',24,'guest.review_request',1),
 ('demo-auto-006','Owner statement ready','statement.sent',0,'owner.statement_ready',1),
 ('demo-auto-007','Approval reminder','maintenance.waiting',48,'owner.approval_reminder',0);

INSERT INTO owner_contracts (id, owner_id, management_fee_pct, starts_on, renews_on, created_at) VALUES
 ('demo-contract-001','22222222-2222-4222-8222-000000000001',25,'2025-03-01','2027-03-01','2025-03-01T00:00:00Z'),
 ('demo-contract-002','22222222-2222-4222-8222-000000000002',25,'2025-06-01','2027-06-01','2025-06-01T00:00:00Z'),
 ('demo-contract-003','22222222-2222-4222-8222-000000000003',25,'2024-11-01','2026-11-01','2024-11-01T00:00:00Z');

INSERT INTO owner_statements (id, owner_id, period_start, period_end, state, gross_booking_value, management_fee, expenses_total, adjustments_total, net_payout, generated_at, finalised_at, sent_at, created_at) VALUES
 ('demo-stmt-001','22222222-2222-4222-8222-000000000001','2026-08-01','2026-08-31','paid',926000,231500,46300,0,648200,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z','2026-09-02T00:00:00Z','2026-09-01T00:00:00Z'),
 ('demo-stmt-002','22222222-2222-4222-8222-000000000003','2026-08-01','2026-08-31','paid',1048000,262000,31800,0,754200,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z','2026-09-02T00:00:00Z','2026-09-01T00:00:00Z'),
 ('demo-stmt-003','22222222-2222-4222-8222-000000000002','2026-08-01','2026-08-31','paid',714000,178500,24000,0,511500,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z','2026-09-02T00:00:00Z','2026-09-01T00:00:00Z');

INSERT INTO statement_lines (id, statement_id, unit_id, line_type, category, description, occurred_on, amount, reference, sort_order) VALUES
 ('demo-line-001','demo-stmt-001','55555555-5555-4555-8555-000000000001','gross',NULL,'Bookings, August','2026-08-31',926000,NULL,1),
 ('demo-line-002','demo-stmt-001','55555555-5555-4555-8555-000000000001','management_fee','management_fee','Management fee 25%','2026-08-31',-231500,NULL,2),
 ('demo-line-003','demo-stmt-001','55555555-5555-4555-8555-000000000001','expense','housekeeping','Housekeeping, 11 turnovers','2026-08-31',-38500,'HK-2026-08-A1203',3),
 ('demo-line-004','demo-stmt-001','55555555-5555-4555-8555-000000000001','expense','maintenance','Aircon quarterly service','2026-08-20',-7800,'INV-2026-0820',4),
 ('demo-line-005','demo-stmt-002','55555555-5555-4555-8555-000000000003','gross',NULL,'Bookings, August','2026-08-31',1048000,NULL,1),
 ('demo-line-006','demo-stmt-002','55555555-5555-4555-8555-000000000003','management_fee','management_fee','Management fee 25%','2026-08-31',-262000,NULL,2),
 ('demo-line-007','demo-stmt-002','55555555-5555-4555-8555-000000000003','expense','furniture','Replacement dining chairs, 2','2026-09-02',-31800,'FRN-2026-114',3),
 ('demo-line-008','demo-stmt-003','55555555-5555-4555-8555-000000000002','gross',NULL,'Bookings, August','2026-08-31',714000,NULL,1),
 ('demo-line-009','demo-stmt-003','55555555-5555-4555-8555-000000000002','management_fee','management_fee','Management fee 25%','2026-08-31',-178500,NULL,2),
 ('demo-line-010','demo-stmt-003','55555555-5555-4555-8555-000000000002','expense','consumables','Coffee pods, toiletries, 3 months','2026-09-12',-24000,'PO-2026-0912',3);

INSERT INTO payouts (id, statement_id, owner_id, amount, currency, state, method, bank_last4, paid_at, failure_reason, created_at) VALUES
 ('demo-pay-001','demo-stmt-001','22222222-2222-4222-8222-000000000001',648200,'MYR','paid','bank_transfer','4417','2026-09-03T10:00:00Z',NULL,'2026-09-02T00:00:00Z'),
 ('demo-pay-002','demo-stmt-002','22222222-2222-4222-8222-000000000003',754200,'MYR','paid','bank_transfer','1193','2026-09-03T10:00:00Z',NULL,'2026-09-02T00:00:00Z'),
 ('demo-pay-003','demo-stmt-003','22222222-2222-4222-8222-000000000002',511500,'MYR','paid','bank_transfer','8802','2026-09-03T10:00:00Z',NULL,'2026-09-02T00:00:00Z');

INSERT INTO expenses (id, unit_id, maintenance_id, task_id, category, description, amount, currency, incurred_on, reference, charge_to, created_by, created_at) VALUES
 ('demo-exp-001','55555555-5555-4555-8555-000000000001',NULL,NULL,'housekeeping','Housekeeping, 11 turnovers',38500,'MYR','2026-08-31','HK-2026-08-A1203','owner','11111111-1111-4111-8111-000000000001','2026-08-31T00:00:00Z'),
 ('demo-exp-002','55555555-5555-4555-8555-000000000001','demo-mnt-002',NULL,'maintenance','Aircon quarterly service',7800,'MYR','2026-08-20','INV-2026-0820','owner','11111111-1111-4111-8111-000000000001','2026-08-20T00:00:00Z'),
 ('demo-exp-003','55555555-5555-4555-8555-000000000003',NULL,NULL,'furniture','Replacement dining chairs, 2',56000,'MYR','2026-09-02','FRN-2026-114','owner','11111111-1111-4111-8111-000000000001','2026-09-02T00:00:00Z'),
 ('demo-exp-004','55555555-5555-4555-8555-000000000002',NULL,NULL,'consumables','Coffee pods, toiletries, 3 months',24000,'MYR','2026-09-12','PO-2026-0912','owner','11111111-1111-4111-8111-000000000001','2026-09-12T00:00:00Z');
