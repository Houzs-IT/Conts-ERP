-- LOCAL DEMO DATA ONLY (scripts/dev-pglite.mjs loads it after local-demo-setup.mjs). Never run on staging or production.
-- Fills Reviews and Messages so every view has something to show: finished stays with and without a review (dated
-- from today, so "days since checkout" and "Window closed" stay meaningful), Booking.com category scores, a reply that
-- did not reach the channel, reviews with no booking matched, an Airbnb inquiry before booking, a message with a file,
-- replies that were not delivered, and saved replies. RE-RUN: safe (fixed ids, ON CONFLICT DO NOTHING).
set search_path = pos, public;

INSERT INTO guests (id, full_name, email, phone, country_code, created_at) VALUES
 ('66666666-6666-4666-8666-000000000010','Hannah Weber','hannah@example.com','+49 151 0000 010','DE','2026-09-01T00:00:00Z'),
 ('66666666-6666-4666-8666-000000000011','Kenji Tanaka','kenji@example.com','+81 90 0000 011','JP','2026-09-01T00:00:00Z'),
 ('66666666-6666-4666-8666-000000000012','Siti Rahmah','siti@example.com','+60121110012','MY','2026-09-01T00:00:00Z'),
 ('66666666-6666-4666-8666-000000000013','Oliver Grant','oliver@example.com','+44 7700 000013','GB','2026-09-01T00:00:00Z'),
 ('66666666-6666-4666-8666-000000000014','Mei Ling Tan','meiling@example.com','+65 8111 0014','SG','2026-09-01T00:00:00Z'),
 ('66666666-6666-4666-8666-000000000015','Arjun Nair','arjun@example.com','+91 98000 00015','IN','2026-09-01T00:00:00Z'),
 ('66666666-6666-4666-8666-000000000016','Sofia Rossi','sofia@example.com','+39 320 000 0016','IT','2026-09-01T00:00:00Z'),
 ('66666666-6666-4666-8666-000000000017','Daniel Ong','daniel@example.com','+60121110017','MY','2026-09-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- Finished stays: (id suffix, unit, guest, channel, nights, checked out N days ago, reference).
INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, guests_count, gross_booking_value, channel_fee, collected_revenue, created_at, updated_at)
SELECT '77777777-0000-4000-8000-0000000009' || s.n, '55555555-5555-4555-8555-00000000000' || s.unit, '66666666-6666-4666-8666-0000000000' || s.guest, s.channel, s.ref, 'checked_out',
  to_char(current_date - (s.ago + s.nights), 'YYYY-MM-DD'), to_char(current_date - s.ago, 'YYYY-MM-DD'), 2, s.nights * 26000, s.nights * 3000, s.nights * 23000,
  to_char(current_date - (s.ago + 30), 'YYYY-MM-DD') || 'T00:00:00Z', to_char(current_date - s.ago, 'YYYY-MM-DD') || 'T04:00:00Z'
FROM (VALUES
  ('01', 1, 10, 'airbnb',      3,  3, 'HMDEMO0101'),
  ('02', 1, 11, 'booking_com', 2,  9, 'BDC-7700102'),
  ('03', 1, 12, 'direct',      3, 20, 'DIR-0103'),
  ('04', 1, 13, 'airbnb',      4, 34, 'HMDEMO0104'),
  ('05', 1, 14, 'booking_com', 3, 75, 'BDC-7700105'),
  ('06', 2, 15, 'airbnb',      2,  5, 'HMDEMO0106'),
  ('07', 2, 16, 'booking_com', 3, 16, 'BDC-7700107'),
  ('08', 2, 17, 'agoda',       2, 30, 'AGD-770108'),
  ('09', 2, 10, 'airbnb',      3, 60, 'HMDEMO0109'),
  ('10', 3, 11, 'airbnb',      2,  2, 'HMDEMO0110'),
  ('11', 3, 13, 'booking_com', 4, 12, 'BDC-7700111'),
  ('12', 3, 14, 'airbnb',      3, 26, 'HMDEMO0112'),
  ('13', 3, 15, 'booking_com', 2, 65, 'BDC-7700113')
) AS s(n, unit, guest, channel, nights, ago, ref)
ON CONFLICT (id) DO NOTHING;

-- Reviews of eight of those stays, plus two with no booking matched.
INSERT INTO reviews (id, unit_id, reservation_id, channel, rating, comment, reviewed_at, reply, replied_at, scores, channel_reply, channex_review_id, reply_push_state, reply_push_error, guest_name)
SELECT 'demo-rv-' || s.n, CASE WHEN s.unit IS NULL THEN NULL ELSE '55555555-5555-4555-8555-00000000000' || s.unit END,
  CASE WHEN s.res IS NULL THEN NULL ELSE '77777777-0000-4000-8000-0000000009' || s.res END,
  s.channel, s.rating, s.comment, to_char(current_date - s.ago, 'YYYY-MM-DD') || 'T09:00:00Z',
  s.reply, CASE WHEN s.reply IS NULL THEN NULL ELSE to_char(current_date - s.ago + 1, 'YYYY-MM-DD') || 'T10:00:00Z' END,
  s.scores::jsonb, s.channel_reply, s.cx, s.push, s.push_error, s.guest
FROM (VALUES
  ('01', 1, '01', 'airbnb', 5.0, 'Spotless flat with a great view of the city. Self check-in was easy and the host answered within minutes.', 2,
     NULL, NULL, NULL, 'cx-demo-01', NULL, NULL, NULL),
  ('02', 1, '02', 'booking_com', 4.5, E'Liked: Location, very clean, comfortable bed.\nDisliked: The air conditioning in the living room was noisy at night.', 7,
     'Thank you Kenji. We have had the living room air conditioning serviced since your stay.', '[{"category":"cleanliness","score":10},{"category":"comfort","score":9},{"category":"location","score":10},{"category":"facilities","score":8},{"category":"staff","score":9},{"category":"value for money","score":8}]', NULL, 'cx-demo-02', 'failed', 'The Messages & Reviews app is not installed in Channex.', NULL),
  ('03', 1, '04', 'airbnb', 4.0, 'Good value and a quiet building. Towels could be refreshed more often for longer stays.', 31,
     'Thanks Oliver, noted on the towels for longer stays.', NULL, 'Thanks Oliver, noted on the towels for longer stays.', 'cx-demo-03', 'sent', NULL, NULL),
  ('04', 2, '06', 'airbnb', 3.0, 'The unit was fine but parking instructions were confusing and we waited 20 minutes at the gate.', 4,
     NULL, NULL, NULL, 'cx-demo-04', NULL, NULL, NULL),
  ('05', 2, '07', 'booking_com', 4.0, E'Liked: Pool and gym.\nDisliked: Check-in took a while.', 14,
     NULL, '[{"category":"cleanliness","score":8},{"category":"comfort","score":8},{"category":"location","score":9},{"category":"facilities","score":9},{"category":"staff","score":7},{"category":"value for money","score":8}]', NULL, 'cx-demo-05', NULL, NULL, NULL),
  ('06', 3, '10', 'airbnb', 5.0, 'Perfect for a short business trip, walking distance to everything.', 1,
     NULL, NULL, NULL, 'cx-demo-06', NULL, NULL, NULL),
  ('07', 3, '11', 'booking_com', 2.5, E'Disliked: Hair in the shower and the kettle was missing. Location is good.', 10,
     'We are sorry, Oliver. The cleaning team has been briefed and a new kettle is in the unit.', '[{"category":"cleanliness","score":4},{"category":"comfort","score":6},{"category":"location","score":9},{"category":"facilities","score":5},{"category":"staff","score":7},{"category":"value for money","score":5}]', NULL, 'cx-demo-07', 'sent', NULL, NULL),
  ('08', 3, '12', 'airbnb', 4.5, 'Lovely stay, the welcome note and local tips were a nice touch.', 24,
     NULL, NULL, 'Thank you Mei Ling, see you next time!', 'cx-demo-08', NULL, NULL, NULL),
  ('09', 2, NULL, 'airbnb', 4.0, 'Nice place, would come back.', 18,
     NULL, NULL, NULL, 'cx-demo-09', NULL, NULL, 'Lukas M.'),
  ('10', NULL, NULL, 'booking_com', 3.5, 'Decent apartment, building lifts were slow.', 40,
     NULL, '[{"category":"cleanliness","score":7},{"category":"location","score":8},{"category":"staff","score":7}]', NULL, 'cx-demo-10', NULL, NULL, 'Amelia K.')
) AS s(n, unit, res, channel, rating, comment, ago, reply, scores, channel_reply, cx, push, push_error, guest)
ON CONFLICT (id) DO NOTHING;
-- A reply written on Airbnb's own site, not here, counts as replied (as the Channex pull stores it).
UPDATE reviews SET reply = channel_reply, replied_at = reviewed_at WHERE id = 'demo-rv-08' AND reply IS NULL;

-- Conversations: an Airbnb inquiry before booking (no reservation, the unit from the listing), a stay with a photo the
-- guest sent, and replies that did not reach the guest.
INSERT INTO message_threads (id, reservation_id, guest_id, unit_id, guest_name, channel, subject, is_read, last_message_at, channex_thread_id) VALUES
 ('demo-thread-101', NULL, NULL, '55555555-5555-4555-8555-000000000003', 'Lukas Meyer', 'airbnb', 'Inquiry', 0, to_char((now() AT TIME ZONE 'UTC') - interval '25 minutes', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'cx-thread-101'),
 ('demo-thread-102', '77777777-0000-4000-8000-000000000906', '66666666-6666-4666-8666-000000000015', NULL, NULL, 'airbnb', 'Stay', 0, to_char((now() AT TIME ZONE 'UTC') - interval '3 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'cx-thread-102'),
 ('demo-thread-103', '77777777-0000-4000-8000-000000000907', '66666666-6666-4666-8666-000000000016', NULL, NULL, 'booking_com', 'Stay', 1, to_char((now() AT TIME ZONE 'UTC') - interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'cx-thread-103'),
 ('demo-thread-104', '77777777-0000-4000-8000-000000000903', '66666666-6666-4666-8666-000000000012', NULL, NULL, 'direct', 'Stay', 1, to_char((now() AT TIME ZONE 'UTC') - interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO messages (id, thread_id, direction, sender_id, body, sent_at, is_automated, delivery_state, delivery_error, attachments) VALUES
 ('demo-msg-101a','demo-thread-101','inbound',NULL,'Hi! Is the unit available from the 20th to the 24th, and is early check-in possible? We land at 9am.', to_char((now() AT TIME ZONE 'UTC') - interval '25 minutes', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),0,NULL,NULL,NULL),
 ('demo-msg-102a','demo-thread-102','inbound',NULL,'The gate guard did not have our name. Photo of the screen attached.', to_char((now() AT TIME ZONE 'UTC') - interval '3 hours 10 minutes', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),0,NULL,NULL,'[{"url":"https://placehold.co/600x400/png?text=Gate+screen","name":"gate-screen.png"}]'),
 ('demo-msg-102b','demo-thread-102','outbound','11111111-1111-4111-8111-000000000001','So sorry about that. I have called the guard house, please try again now.', to_char((now() AT TIME ZONE 'UTC') - interval '3 hours 5 minutes', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),0,'failed','The channel refused it (status 422).',NULL),
 ('demo-msg-102c','demo-thread-102','inbound',NULL,'Hello? Still waiting at the gate.', to_char((now() AT TIME ZONE 'UTC') - interval '3 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),0,NULL,NULL,NULL),
 ('demo-msg-103a','demo-thread-103','inbound',NULL,'Can we leave our bags after checkout until 4pm?', to_char((now() AT TIME ZONE 'UTC') - interval '1 day 1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),0,NULL,NULL,NULL),
 ('demo-msg-103b','demo-thread-103','outbound','11111111-1111-4111-8111-000000000001','Yes, the concierge on the ground floor will hold them for you.', to_char((now() AT TIME ZONE 'UTC') - interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),0,'sent',NULL,NULL),
 ('demo-msg-104a','demo-thread-104','outbound','11111111-1111-4111-8111-000000000001','Hi Siti, thanks for staying with us. We hope to host you again.', to_char((now() AT TIME ZONE 'UTC') - interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),0,'failed','WhatsApp did not accept the message. Try again in a moment.',NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO saved_replies (id, title, body, created_by, created_at, updated_at) VALUES
 ('demo-saved-1','Early check-in','Early check-in depends on the cleaning before you. We will confirm by 12:00 on the day; you are welcome to leave your bags with the concierge from 10:00.','11111111-1111-4111-8111-000000000001','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z'),
 ('demo-saved-2','Parking','Your car park bay number is in the access details we send on the day of arrival. Tell the guard house the unit number and your name.','11111111-1111-4111-8111-000000000001','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z'),
 ('demo-saved-3','Thank you after checkout','Thank you for staying with us. We hope you enjoyed it, and a review on the site would mean a lot to the team.','11111111-1111-4111-8111-000000000001','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
