-- The Conts Property OS — seed data
-- Matches the figures shown in the designs so a local backend renders identical screens.
-- All data is representative placeholder in a Kuala Lumpur / Petaling Jaya context.
-- Reference date: 16 September 2026. Statement period: August 2026.
-- Run after schema.sql. Passwords below are placeholders — hash them with the app's own hasher.

BEGIN;

-- Users ---------------------------------------------------------------------
INSERT INTO users (id, email, full_name, phone, password_hash, role, must_change_password) VALUES
 ('11111111-1111-4111-8111-000000000001','aina@theconts.com',    'Aina Zulkifli',  '+60123456701','REPLACE_WITH_HASH','operations_manager', false),
 ('11111111-1111-4111-8111-000000000002','management@theconts.com','Lee Wei Siang','+60123456702','REPLACE_WITH_HASH','management',         false),
 ('11111111-1111-4111-8111-000000000003','finance@theconts.com', 'Priya Devi',     '+60123456703','REPLACE_WITH_HASH','finance_admin',      false),
 ('11111111-1111-4111-8111-000000000004','weiwen@theconts.com',  'Chan Wei Wen',   '+60123456704','REPLACE_WITH_HASH','operations_staff',   false),
 ('11111111-1111-4111-8111-000000000005','nurul@theconts.com',   'Nurul Huda',     '+60123456705','REPLACE_WITH_HASH','housekeeper',        false),
 ('11111111-1111-4111-8111-000000000006','faridah@theconts.com', 'Faridah Ismail', '+60123456706','REPLACE_WITH_HASH','housekeeper',        true),
 ('11111111-1111-4111-8111-000000000007','hafiz@theconts.com',   'Hafiz Omar',     '+60123456707','REPLACE_WITH_HASH','technician',         false),
 ('11111111-1111-4111-8111-000000000008','limck@example.com',    'Lim Chee Keong', '+60123456708','REPLACE_WITH_HASH','owner',              false);

-- Owners --------------------------------------------------------------------
INSERT INTO owners (id, user_id, display_name, email, phone, bank_name, bank_account_last4) VALUES
 ('22222222-2222-4222-8222-000000000001','11111111-1111-4111-8111-000000000008','Lim Chee Keong','limck@example.com','+60123456708','Maybank','4417'),
 ('22222222-2222-4222-8222-000000000002',NULL,'Wong Mei Ling',  'wongml@example.com','+60123456711','CIMB','8802'),
 ('22222222-2222-4222-8222-000000000003',NULL,'Rajesh Kumar',   'rajesh@example.com','+60123456712','Maybank','1193'),
 ('22222222-2222-4222-8222-000000000004',NULL,'Chong Wei Han',  'chongwh@example.com','+60123456713','Public Bank','6640'),
 ('22222222-2222-4222-8222-000000000005',NULL,'Nur Aisyah',     'aisyah@example.com','+60123456714','Maybank','2275'),
 ('22222222-2222-4222-8222-000000000006',NULL,'Tan Boon Huat',  'tanbh@example.com','+60123456715','RHB','5518');

INSERT INTO owner_contracts (id, owner_id, management_fee_pct, starts_on, renews_on) VALUES
 ('33333333-3333-4333-8333-000000000001','22222222-2222-4222-8222-000000000001',25.00,'2025-03-01','2027-03-01'),
 ('33333333-3333-4333-8333-000000000002','22222222-2222-4222-8222-000000000002',25.00,'2025-06-01','2027-06-01'),
 ('33333333-3333-4333-8333-000000000003','22222222-2222-4222-8222-000000000003',25.00,'2024-11-01','2026-11-01'),
 ('33333333-3333-4333-8333-000000000004','22222222-2222-4222-8222-000000000004',25.00,'2025-08-01','2027-08-01'),
 ('33333333-3333-4333-8333-000000000005','22222222-2222-4222-8222-000000000005',25.00,'2026-09-04','2028-09-04'),
 ('33333333-3333-4333-8333-000000000006','22222222-2222-4222-8222-000000000006',25.00,'2025-01-15','2027-01-15');

-- Properties ----------------------------------------------------------------
INSERT INTO properties (id, name, address_line, city, state, postcode) VALUES
 ('44444444-4444-4444-8444-000000000001','Vista Jaya One',     'C-41-06, Jaya One, Jalan Universiti','Petaling Jaya','Selangor','46200'),
 ('44444444-4444-4444-8444-000000000002','Arcoris Mont Kiara', 'Arcoris Residences, Jalan Kiara','Kuala Lumpur','Kuala Lumpur','50480'),
 ('44444444-4444-4444-8444-000000000003','Tribeca',            'Tribeca Serviced Suites, Jalan Imbi','Kuala Lumpur','Kuala Lumpur','55100'),
 ('44444444-4444-4444-8444-000000000004','Scarletz',           'Scarletz Suites, Jalan Yap Kwan Seng','Kuala Lumpur','Kuala Lumpur','50450'),
 ('44444444-4444-4444-8444-000000000005','The Establishment',  'The Establishment, Jalan Kuchai Lama','Kuala Lumpur','Kuala Lumpur','58100'),
 ('44444444-4444-4444-8444-000000000006','Sentral Suites',     'Sentral Suites, Jalan Tun Sambanthan','Kuala Lumpur','Kuala Lumpur','50470');

-- Units ---------------------------------------------------------------------
INSERT INTO units (id, property_id, owner_id, contract_id, unit_number, bedrooms, bathrooms, max_guests, readiness, base_rate, is_listed, listed_at, fitted_out_at) VALUES
 ('55555555-5555-4555-8555-000000000001','44444444-4444-4444-8444-000000000001','22222222-2222-4222-8222-000000000001','33333333-3333-4333-8333-000000000001','#A-12-03',2,2,4,'occupied',   284.00,true,'2025-03-15','2025-03-01'),
 ('55555555-5555-4555-8555-000000000002','44444444-4444-4444-8444-000000000002','22222222-2222-4222-8222-000000000002','33333333-3333-4333-8333-000000000002','#B-08-11',0,1,2,'cleaning',   231.00,true,'2025-06-20','2025-06-05'),
 ('55555555-5555-4555-8555-000000000003','44444444-4444-4444-8444-000000000003','22222222-2222-4222-8222-000000000003','33333333-3333-4333-8333-000000000003','#2207',   1,1,3,'ready',      318.00,true,'2024-11-20','2024-11-05'),
 ('55555555-5555-4555-8555-000000000004','44444444-4444-4444-8444-000000000004','22222222-2222-4222-8222-000000000004','33333333-3333-4333-8333-000000000004','#15-06',  1,1,2,'dirty',      265.00,true,'2025-08-18','2025-08-01'),
 ('55555555-5555-4555-8555-000000000005','44444444-4444-4444-8444-000000000005','22222222-2222-4222-8222-000000000005','33333333-3333-4333-8333-000000000005','#A-21-02',2,2,4,'dirty',      242.00,true,'2026-09-04','2026-08-20'),
 ('55555555-5555-4555-8555-000000000006','44444444-4444-4444-8444-000000000006','22222222-2222-4222-8222-000000000006','33333333-3333-4333-8333-000000000006','#C-31-14',0,1,2,'maintenance',228.00,true,'2025-02-01','2025-01-20');

INSERT INTO unit_channels (unit_id, channel, is_active) VALUES
 ('55555555-5555-4555-8555-000000000001','airbnb',true),
 ('55555555-5555-4555-8555-000000000001','booking_com',true),
 ('55555555-5555-4555-8555-000000000001','direct',true),
 ('55555555-5555-4555-8555-000000000002','airbnb',true),
 ('55555555-5555-4555-8555-000000000002','direct',true),
 ('55555555-5555-4555-8555-000000000003','airbnb',true),
 ('55555555-5555-4555-8555-000000000003','booking_com',true),
 ('55555555-5555-4555-8555-000000000004','direct',true),
 ('55555555-5555-4555-8555-000000000004','airbnb',true),
 ('55555555-5555-4555-8555-000000000005','airbnb',true),
 ('55555555-5555-4555-8555-000000000006','airbnb',true);

-- Access credentials (secret masked in every API response by default) -------
INSERT INTO access_credentials (unit_id, kind, label, secret, instruction, rotates_after_stay) VALUES
 ('55555555-5555-4555-8555-000000000001','smart_lock','Smart lock, main door','ENCRYPT_ME','Smart lock 4417# · lobby via guard, say The Conts',true),
 ('55555555-5555-4555-8555-000000000002','key_box','Key box B2','ENCRYPT_ME','Key box B2, code 2208 · lift card at counter',false),
 ('55555555-5555-4555-8555-000000000004','smart_lock','Smart lock, main door','ENCRYPT_ME','Smart lock 9021# · parking level B2',true),
 ('55555555-5555-4555-8555-000000000005','guard_desk','Site office key','ENCRYPT_ME','Collect key from site office before 14:00',false);

-- Guests --------------------------------------------------------------------
INSERT INTO guests (id, full_name, email, phone, country_code) VALUES
 ('66666666-6666-4666-8666-000000000001','Nadia Abdullah','nadia@example.com','+60121110001','MY'),
 ('66666666-6666-4666-8666-000000000002','Aaron Lee',     'aaron@example.com','+60121110002','MY'),
 ('66666666-6666-4666-8666-000000000003','Priya Sundaram','priya@example.com','+65811110003','SG'),
 ('66666666-6666-4666-8666-000000000004','Chen Yu',       'chen@example.com', '+86131110004','CN'),
 ('66666666-6666-4666-8666-000000000005','Marcus Wong',   'marcus@example.com','+60121110005','MY'),
 ('66666666-6666-4666-8666-000000000006','Jonathan Tan',  'jon@example.com',  '+60121110006','MY');

-- Reservations: August (statement period) then September (live board) -------
INSERT INTO reservations (unit_id, guest_id, channel, state, check_in, check_out, guests_count, gross_booking_value, channel_fee, collected_revenue) VALUES
 -- August, unit #A-12-03: gross 9,260 to match the owner statement
 ('55555555-5555-4555-8555-000000000001','66666666-6666-4666-8666-000000000003','booking_com','checked_out','2026-08-24','2026-08-31',2,1988.00,298.00,1690.00),
 ('55555555-5555-4555-8555-000000000001','66666666-6666-4666-8666-000000000002','direct',     'checked_out','2026-08-18','2026-08-22',2, 1136.00,  0.00,1136.00),
 ('55555555-5555-4555-8555-000000000001','66666666-6666-4666-8666-000000000004','airbnb',     'checked_out','2026-08-10','2026-08-15',2, 1420.00,213.00,1207.00),
 ('55555555-5555-4555-8555-000000000001','66666666-6666-4666-8666-000000000005','airbnb',     'checked_out','2026-08-04','2026-08-08',2, 1136.00,170.00, 966.00),
 ('55555555-5555-4555-8555-000000000001','66666666-6666-4666-8666-000000000006','airbnb',     'checked_out','2026-08-01','2026-08-03',2,  568.00, 85.00, 483.00),
 -- September, live: checked in, arriving, pending
 ('55555555-5555-4555-8555-000000000001','66666666-6666-4666-8666-000000000001','airbnb',     'checked_in', '2026-09-13','2026-09-16',2,  852.00,128.00, 724.00),
 ('55555555-5555-4555-8555-000000000001','66666666-6666-4666-8666-000000000002','direct',     'confirmed',  '2026-09-16','2026-09-20',2, 1136.00,  0.00,1136.00),
 ('55555555-5555-4555-8555-000000000001','66666666-6666-4666-8666-000000000003','booking_com','pending',    '2026-09-24','2026-10-01',2, 1988.00,298.00,   0.00),
 ('55555555-5555-4555-8555-000000000002','66666666-6666-4666-8666-000000000006','airbnb',     'checked_out','2026-09-14','2026-09-16',1,  462.00, 69.00, 393.00),
 ('55555555-5555-4555-8555-000000000002','66666666-6666-4666-8666-000000000003','airbnb',     'confirmed',  '2026-09-16','2026-09-23',2, 1617.00,242.00,1375.00),
 ('55555555-5555-4555-8555-000000000003','66666666-6666-4666-8666-000000000004','airbnb',     'checked_out','2026-09-11','2026-09-16',2, 1590.00,238.00,1352.00),
 ('55555555-5555-4555-8555-000000000003','66666666-6666-4666-8666-000000000005','booking_com','confirmed',  '2026-09-25','2026-09-29',2, 1272.00,190.00,1082.00),
 ('55555555-5555-4555-8555-000000000004','66666666-6666-4666-8666-000000000001','direct',     'confirmed',  '2026-09-19','2026-09-22',2,  795.00,  0.00, 795.00),
 ('55555555-5555-4555-8555-000000000005','66666666-6666-4666-8666-000000000002','airbnb',     'confirmed',  '2026-09-16','2026-09-20',4,  968.00,145.00, 823.00);

-- Owner stay and maintenance block: excluded from occupancy and ADR
INSERT INTO reservations (unit_id, guest_id, channel, state, check_in, check_out, guests_count, gross_booking_value, notes) VALUES
 ('55555555-5555-4555-8555-000000000004',NULL,'owner_stay','confirmed','2026-09-23','2026-09-25',2,0.00,'Owner staying, agreed 12 Sep'),
 ('55555555-5555-4555-8555-000000000006',NULL,'maintenance_block','confirmed','2026-09-16','2026-09-22',0,0.00,'Plumbing works, AquaFix on site');

-- Tasks: today's operations board, risk-first ------------------------------
INSERT INTO tasks (unit_id, kind, state, title, instructions, assignee_id, due_at, next_guest_at, requires_photo) VALUES
 ('55555555-5555-4555-8555-000000000005','turnover',  'open',       'Full turnover, 2BR','Linen set A. No cleaner assigned.',            NULL,                                   '2026-09-16T06:54:00Z','2026-09-16T07:00:00Z',true),
 ('55555555-5555-4555-8555-000000000004','deep_clean','assigned',   'Deep clean, 1BR',   'Vacant 4 nights. Run aircon, check drainage.','11111111-1111-4111-8111-000000000006','2026-09-16T06:30:00Z','2026-09-16T10:00:00Z',true),
 ('55555555-5555-4555-8555-000000000002','turnover',  'in_progress','Full turnover, studio','Guest requested early check-in at 14:00.',  '11111111-1111-4111-8111-000000000005','2026-09-16T05:45:00Z','2026-09-16T08:00:00Z',true),
 ('55555555-5555-4555-8555-000000000001','turnover',  'in_progress','Full turnover, 2BR','Linen set B. Restock coffee pods.',            '11111111-1111-4111-8111-000000000005','2026-09-16T05:00:00Z','2026-09-16T07:00:00Z',true),
 ('55555555-5555-4555-8555-000000000003','inspection','assigned',   'Quality inspection','Photos required before release.',              '11111111-1111-4111-8111-000000000004','2026-09-16T09:30:00Z',NULL,true),
 ('55555555-5555-4555-8555-000000000001','other',     'assigned',   'Owner report photos','Routine monthly evidence capture.',           '11111111-1111-4111-8111-000000000004','2026-09-16T08:30:00Z',NULL,true);

-- Maintenance ---------------------------------------------------------------
INSERT INTO maintenance_issues (unit_id, reported_by, state, title, detail, vendor_name, quoted_amount, owner_approval_required, blocks_unit, blocked_from, blocked_to, charge_to, reported_at) VALUES
 ('55555555-5555-4555-8555-000000000001','11111111-1111-4111-8111-000000000005','waiting','Curtain replacement quoted','Blackout curtains, 3 windows. Awaiting owner approval.','Kiara Interiors',890.00,true,false,NULL,NULL,'owner','2026-09-12T02:00:00Z'),
 ('55555555-5555-4555-8555-000000000006','11111111-1111-4111-8111-000000000001','in_progress','Plumbing works','Riser replacement. Unit offline until 22 Sep.','AquaFix',3200.00,false,true,'2026-09-16','2026-09-22','owner','2026-09-14T01:00:00Z'),
 ('55555555-5555-4555-8555-000000000002','11111111-1111-4111-8111-000000000005','open','Broken blind, living room','Guest reported on arrival. Inspect before next stay.',NULL,NULL,false,false,NULL,NULL,'owner','2026-09-16T01:20:00Z');

INSERT INTO maintenance_issues (unit_id, state, title, detail, final_amount, charge_to, reported_at, resolved_at) VALUES
 ('55555555-5555-4555-8555-000000000001','resolved','Aircon service, master bedroom','Quarterly service. Gas top-up not required.',180.00,'owner','2026-09-10T02:00:00Z','2026-09-12T08:00:00Z'),
 ('55555555-5555-4555-8555-000000000001','resolved','Water heater replaced','Guest reported no hot water. Same-day replacement by in-house crew.',640.00,'warranty','2026-08-28T03:00:00Z','2026-08-28T09:00:00Z'),
 ('55555555-5555-4555-8555-000000000001','resolved','Sofa cover deep clean','Stain from previous stay. Recovered from guest deposit.',120.00,'guest_deposit','2026-08-14T04:00:00Z','2026-08-15T06:00:00Z');

-- Inventory -----------------------------------------------------------------
INSERT INTO inventory_items (unit_id, name, quantity, condition, supplied_in_house, installed_on) VALUES
 ('55555555-5555-4555-8555-000000000001','Queen bed frame and mattress','1 set','good','true','2025-03-01'),
 ('55555555-5555-4555-8555-000000000001','Three-seater fabric sofa','1','fair',true,'2025-03-01'),
 ('55555555-5555-4555-8555-000000000001','Dining table and 4 chairs','1 set','good',true,'2025-03-01'),
 ('55555555-5555-4555-8555-000000000001','Smart lock, Yale YDM4109','1','good',true,'2025-03-01'),
 ('55555555-5555-4555-8555-000000000001','Blackout curtains','3 windows','replace_soon',true,'2025-03-01'),
 ('55555555-5555-4555-8555-000000000001','Kitchenware bundle','1 set','good',true,'2025-03-01');

-- Expenses for the August statement period ----------------------------------
INSERT INTO expenses (unit_id, category, description, amount, incurred_on, reference, charge_to) VALUES
 ('55555555-5555-4555-8555-000000000001','housekeeping','Housekeeping, 11 turnovers',385.00,'2026-08-31','HK-2026-08-A1203','owner'),
 ('55555555-5555-4555-8555-000000000001','maintenance', 'Aircon quarterly service',   78.00,'2026-08-20','INV-2026-0820',   'owner');

-- Owner statements: August 2026 ---------------------------------------------
INSERT INTO owner_statements (id, owner_id, period_start, period_end, state, gross_booking_value, management_fee, expenses_total, net_payout, finalised_at, sent_at) VALUES
 ('77777777-7777-4777-8777-000000000001','22222222-2222-4222-8222-000000000001','2026-08-01','2026-08-31','paid',      9260.00,2315.00, 463.00, 6482.00,'2026-09-01T02:00:00Z','2026-09-01T03:00:00Z'),
 ('77777777-7777-4777-8777-000000000002','22222222-2222-4222-8222-000000000003','2026-08-01','2026-08-31','paid',     10480.00,2620.00, 318.00, 7542.00,'2026-09-01T02:00:00Z','2026-09-01T03:00:00Z'),
 ('77777777-7777-4777-8777-000000000003','22222222-2222-4222-8222-000000000002','2026-08-01','2026-08-31','paid',      7140.00,1785.00, 240.00, 5115.00,'2026-09-01T02:00:00Z','2026-09-01T03:00:00Z'),
 ('77777777-7777-4777-8777-000000000004','22222222-2222-4222-8222-000000000005','2026-08-01','2026-08-31','finalised', 7690.00,1922.00, 512.00, 5256.00,'2026-09-01T02:00:00Z',NULL),
 ('77777777-7777-4777-8777-000000000005','22222222-2222-4222-8222-000000000006','2026-08-01','2026-08-31','finalised', 4980.00,1245.00,1640.00, 2095.00,'2026-09-01T02:00:00Z',NULL),
 ('77777777-7777-4777-8777-000000000006','22222222-2222-4222-8222-000000000004','2026-08-01','2026-08-31','provisional',6210.00,1552.00, 180.00, 4478.00,NULL,NULL);

INSERT INTO statement_lines (statement_id, unit_id, line_type, category, description, occurred_on, amount, reference, sort_order) VALUES
 ('77777777-7777-4777-8777-000000000001','55555555-5555-4555-8555-000000000001','gross',         NULL,          'Gross booking value',          '2026-08-31', 9260.00,NULL,1),
 ('77777777-7777-4777-8777-000000000001','55555555-5555-4555-8555-000000000001','management_fee','management_fee','Management fee, 25%',         '2026-08-31',-2315.00,NULL,2),
 ('77777777-7777-4777-8777-000000000001','55555555-5555-4555-8555-000000000001','expense',       'housekeeping','Housekeeping, 11 turnovers',   '2026-08-31', -385.00,'HK-2026-08-A1203',3),
 ('77777777-7777-4777-8777-000000000001','55555555-5555-4555-8555-000000000001','expense',       'maintenance', 'Aircon quarterly service',     '2026-08-20',  -78.00,'INV-2026-0820',4);

INSERT INTO payouts (statement_id, owner_id, amount, state, bank_last4, paid_at) VALUES
 ('77777777-7777-4777-8777-000000000001','22222222-2222-4222-8222-000000000001',6482.00,'paid','4417','2026-09-03T04:00:00Z'),
 ('77777777-7777-4777-8777-000000000002','22222222-2222-4222-8222-000000000003',7542.00,'paid','1193','2026-09-03T04:00:00Z'),
 ('77777777-7777-4777-8777-000000000003','22222222-2222-4222-8222-000000000002',5115.00,'paid','8802','2026-09-03T04:00:00Z');

-- Reviews -------------------------------------------------------------------
INSERT INTO reviews (unit_id, channel, rating, comment, reviewed_at) VALUES
 ('55555555-5555-4555-8555-000000000001','airbnb',     4.92,'Spotless and exactly as described.','2026-09-14'),
 ('55555555-5555-4555-8555-000000000002','airbnb',     4.88,'Great location, quick responses.',  '2026-09-12'),
 ('55555555-5555-4555-8555-000000000003','booking_com',4.95,'Best value in Bukit Bintang.',      '2026-09-10'),
 ('55555555-5555-4555-8555-000000000004','airbnb',     4.79,'Comfortable, aircon a little loud.','2026-09-05');

-- Integrations --------------------------------------------------------------
INSERT INTO integrations (provider, state, last_synced_at) VALUES
 ('airbnb',      'connected','2026-09-16T06:02:00Z'),
 ('booking_com', 'connected','2026-09-16T05:58:00Z'),
 ('agoda',       'expired',  '2026-09-09T04:00:00Z'),
 ('whatsapp',    'connected','2026-09-16T06:05:00Z'),
 ('maybank',     'degraded', '2026-09-15T22:00:00Z');

-- Audit example: the Activity tab reads from here ---------------------------
INSERT INTO audit_log (actor_id, actor_label, action, entity_table, entity_id, before_state, after_state, source, occurred_at) VALUES
 ('11111111-1111-4111-8111-000000000001','Aina Zulkifli','unit.readiness_change','units','55555555-5555-4555-8555-000000000001','{"readiness":"cleaning"}','{"readiness":"occupied"}','web','2026-09-16T06:14:00Z'),
 ('11111111-1111-4111-8111-000000000005','Nurul Huda',   'task.complete',        'tasks','55555555-5555-4555-8555-000000000001','{"state":"in_progress"}','{"state":"resolved"}','field_app','2026-09-16T05:50:00Z'),
 ('11111111-1111-4111-8111-000000000003','Priya Devi',   'statement.send',       'owner_statements','77777777-7777-4777-8777-000000000001','{"state":"finalised"}','{"state":"sent"}','web','2026-09-01T03:00:00Z');

COMMIT;

-- Expected screen figures after seeding (September 2026 to date):
--   Units live 6 in seed / 24 in the designs — extend with the same pattern for full density testing.
--   #A-12-03 August: gross 9,260.00, fee 2,315.00, expenses 463.00, net 6,482.00.
--   Operations today: 6 tasks, 1 overdue and unassigned (#A-21-02), 1 unit in maintenance (#C-31-14).
--   Statements: 3 paid, 2 finalised and unsent, 1 provisional.
