-- TEMPORARY DEMO DATA (from scripts/seed-d1.sql, bundled with the original design
-- package). Every name, owner, property and booking here is fake, for the
-- dashboard/portfolio screens to have something to show before real owners
-- exist. Delete with scripts/delete-demo-data.sql once "Add owner" is built and
-- real data replaces it. Money is integer sen: RM 284.00 === 28400.
-- All 4 staff accounts below share one password (see the operator's own notes).

INSERT INTO users (id, email, full_name, phone, password_hash, role, must_change_password, created_at, updated_at) VALUES
 ('11111111-1111-4111-8111-000000000001','aina@theconts.com','Aina Zulkifli','+60123456701','pbkdf2$ALREADY-APPLIED-HASH-REDACTED-BEFORE-COMMIT','operations_manager',0,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
 ('11111111-1111-4111-8111-000000000002','management@theconts.com','Lee Wei Siang','+60123456702','pbkdf2$ALREADY-APPLIED-HASH-REDACTED-BEFORE-COMMIT','management',0,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
 ('11111111-1111-4111-8111-000000000003','finance@theconts.com','Priya Devi','+60123456703','pbkdf2$ALREADY-APPLIED-HASH-REDACTED-BEFORE-COMMIT','finance_admin',0,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
 ('11111111-1111-4111-8111-000000000005','nurul@theconts.com','Nurul Huda','+60123456705','pbkdf2$ALREADY-APPLIED-HASH-REDACTED-BEFORE-COMMIT','housekeeper',0,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');

INSERT INTO owners (id, user_id, display_name, email, phone, bank_name, bank_account_last4, created_at, updated_at) VALUES
 ('22222222-2222-4222-8222-000000000001',NULL,'Lim Chee Keong','limck@example.com','+60123456708','Maybank','4417','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
 ('22222222-2222-4222-8222-000000000002',NULL,'Wong Mei Ling','wongml@example.com','+60123456711','CIMB','8802','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
 ('22222222-2222-4222-8222-000000000003',NULL,'Rajesh Kumar','rajesh@example.com','+60123456712','Maybank','1193','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');

INSERT INTO properties (id, name, address_line, city, state, postcode, created_at, updated_at) VALUES
 ('44444444-4444-4444-8444-000000000001','Vista Jaya One','C-41-06, Jaya One, Jalan Universiti','Petaling Jaya','Selangor','46200','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
 ('44444444-4444-4444-8444-000000000002','Arcoris Mont Kiara','Arcoris Residences, Jalan Kiara','Kuala Lumpur','Kuala Lumpur','50480','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
 ('44444444-4444-4444-8444-000000000003','Tribeca','Tribeca Serviced Suites, Jalan Imbi','Kuala Lumpur','Kuala Lumpur','55100','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');

INSERT INTO units (id, property_id, owner_id, unit_number, bedrooms, bathrooms, max_guests, readiness, base_rate, is_listed, created_at, updated_at) VALUES
 ('55555555-5555-4555-8555-000000000001','44444444-4444-4444-8444-000000000001','22222222-2222-4222-8222-000000000001','#A-12-03',2,2,4,'occupied',28400,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
 ('55555555-5555-4555-8555-000000000002','44444444-4444-4444-8444-000000000002','22222222-2222-4222-8222-000000000002','#B-08-11',0,1,2,'cleaning',23100,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
 ('55555555-5555-4555-8555-000000000003','44444444-4444-4444-8444-000000000003','22222222-2222-4222-8222-000000000003','#2207',1,1,3,'ready',31800,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');

INSERT INTO guests (id, full_name, email, phone, country_code, created_at) VALUES
 ('66666666-6666-4666-8666-000000000001','Nadia Abdullah','nadia@example.com','+60121110001','MY','2026-09-01T00:00:00Z'),
 ('66666666-6666-4666-8666-000000000002','Aaron Lee','aaron@example.com','+60121110002','MY','2026-09-01T00:00:00Z');

INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, guests_count, gross_booking_value, collected_revenue, created_at, updated_at) VALUES
 ('77777777-0000-4000-8000-000000000001','55555555-5555-4555-8555-000000000001','66666666-6666-4666-8666-000000000001','airbnb','ABNB-7741QK','checked_in','2026-09-13','2026-09-16',2,85200,72400,'2026-09-09T00:00:00Z','2026-09-13T00:00:00Z'),
 ('77777777-0000-4000-8000-000000000002','55555555-5555-4555-8555-000000000001','66666666-6666-4666-8666-000000000002','direct','TC-2026-0916','confirmed','2026-09-16','2026-09-20',2,113600,113600,'2026-09-02T00:00:00Z','2026-09-02T00:00:00Z');

INSERT INTO integrations (id, provider, state, last_synced_at) VALUES
 ('88888888-0000-4000-8000-000000000001','airbnb','connected','2026-09-16T06:02:00Z'),
 ('88888888-0000-4000-8000-000000000002','booking_com','connected','2026-09-16T05:58:00Z'),
 ('88888888-0000-4000-8000-000000000003','agoda','expired','2026-09-09T04:00:00Z');
