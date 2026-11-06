-- REVERSAL: ALTER TABLE scm.pending_slip_uploads ALTER COLUMN showroom_id SET NOT NULL;  (only once every row has one)
-- Every photo upload in the engine (the office "Mark delivered" proof-of-delivery photos, the phone POD, run-sheet
-- job photos, payment slips) opens a scm.pending_slip_uploads row first, and that row demanded a showroom. Houzs
-- seeded showrooms; Conts has none, so /slips/init answered 400 "no_active_showroom" and not one upload had ever
-- succeeded on production (found 3 Nov 2026 testing TC-DO-2611-001). The showroom stays recorded when a company has
-- one; a company without one stores the upload with none.
-- APPLY: by hand, in one transaction with its public.pos_migrations row, after 0204. Touches only scm, which the
-- demo overlay (0203) does not cover; migrate-pg.mjs still wraps it in demo.drop_views()/demo.sync().
set local lock_timeout = '5s';

ALTER TABLE scm.pending_slip_uploads ALTER COLUMN showroom_id DROP NOT NULL;
