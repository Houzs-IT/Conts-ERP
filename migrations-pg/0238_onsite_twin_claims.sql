-- REVERSAL: DROP TABLE scm.onsite_twin_claims;
-- The on-site twin is asked more than once for one document (confirm, then Delivered, then a retry). One row here per
-- document while its twin runs, so two presses at once cannot both receive or both deliver.
select demo.drop_views();
set local lock_timeout = '5s';

CREATE TABLE scm.onsite_twin_claims (
  doc_id uuid PRIMARY KEY,
  company_id integer NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE scm.onsite_twin_claims OWNER TO scm_engine;
ALTER TABLE scm.onsite_twin_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON scm.onsite_twin_claims FROM anon, authenticated;
GRANT ALL ON scm.onsite_twin_claims TO service_role, pos_app;

select demo.sync();
