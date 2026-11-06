-- REVERSAL: REVOKE ALL ON scm.onsite_twins FROM service_role, pos_app, scm_engine;
-- 0232 made the table without the grants every scm table carries, so the engine could not write it.
GRANT SELECT, INSERT, UPDATE, DELETE ON scm.onsite_twins TO service_role, pos_app, scm_engine;
