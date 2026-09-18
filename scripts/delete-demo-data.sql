-- Removes everything scripts/demo-data-1.sql added. Run once "Add owner /
-- property / unit" screens exist and real data has replaced this placeholder set.
DELETE FROM reservations WHERE id LIKE '77777777-0000-4000-8000-%';
DELETE FROM guests WHERE id LIKE '66666666-6666-4666-8666-%';
DELETE FROM units WHERE id LIKE '55555555-5555-4555-8555-%';
DELETE FROM properties WHERE id LIKE '44444444-4444-4444-8444-%';
DELETE FROM owners WHERE id LIKE '22222222-2222-4222-8222-%';
DELETE FROM users WHERE id LIKE '11111111-1111-4111-8111-%';
DELETE FROM integrations WHERE id LIKE '88888888-0000-4000-8000-%';
