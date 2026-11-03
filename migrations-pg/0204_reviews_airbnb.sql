-- REVERSAL: select demo.drop_views(); DROP TABLE pos.guest_reviews, pos.guest_review_rules, pos.guest_review_templates; DROP TABLE IF EXISTS demo.guest_reviews, demo.guest_review_rules, demo.guest_review_templates; ALTER TABLE pos.reviews DROP COLUMN is_hidden, DROP COLUMN tags; ALTER TABLE demo.reviews DROP COLUMN is_hidden, DROP COLUMN tags; select demo.sync();
-- Reviews, Airbnb's way (owner, 3 Nov 2026; three batches approved together). Nothing existing changes meaning.
--   reviews.is_hidden         Airbnb only: the guest's review exists but Airbnb shows it only once the host has reviewed
--                             the guest (Channex is_hidden). 0 for every other review and every review pulled before this.
--   reviews.tags              Airbnb only: the tag codes the guest picked (guest_review_host_positive_* / negative_*).
--   guest_review_templates    the texts the host's public review of a guest is written from; a rule or the form picks
--                             one at random among the least used, so guests do not all read the same words.
--   guest_review_rules        automatic reviews of guests: when a finished Airbnb stay meets the condition (no_issues:
--                             no repair reported during the stay; always), write the ratings and a random template, then
--                             send it (auto) or leave it for someone to approve (approval). Never for a Bad guest or a
--                             guest on the Blacklist.
--   guest_reviews             one row per reservation: the host's review of the guest and where it stands, and the Bad
--                             guest flag. state: needs_approval | scheduled (waiting for send_after, or for Airbnb to
--                             open the review in Channex) | sent | failed (attempts, last_error; tried again by the
--                             scheduled job or Retry). Empty state: not written yet (a row may exist for the flag alone).
--                             A Bad guest's review is scheduled for day 13 after checkout (src/lib/reviewRules.ts).
-- APPLY: by hand, in one transaction with its public.pos_migrations row, after 0203. Starts with demo.drop_views() and ends
-- with demo.sync() (Demo mode overlays every pos table, migration 0203), so the demo store gets the new columns and tables.
set local search_path = pos;
set local lock_timeout = '5s';
select demo.drop_views();

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1));
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS tags JSONB;

CREATE TABLE IF NOT EXISTS guest_review_templates (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  use_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guest_review_rules (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  condition           TEXT NOT NULL DEFAULT 'no_issues' CHECK (condition IN ('no_issues', 'always')),
  cleanliness         INTEGER NOT NULL CHECK (cleanliness BETWEEN 1 AND 5),
  communication       INTEGER NOT NULL CHECK (communication BETWEEN 1 AND 5),
  respect_house_rules INTEGER NOT NULL CHECK (respect_house_rules BETWEEN 1 AND 5),
  recommend           INTEGER NOT NULL DEFAULT 1 CHECK (recommend IN (0, 1)),
  tags                JSONB,
  mode                TEXT NOT NULL DEFAULT 'approval' CHECK (mode IN ('auto', 'approval')),
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  position            INTEGER NOT NULL DEFAULT 0,
  created_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guest_reviews (
  id                  TEXT PRIMARY KEY,
  reservation_id      TEXT NOT NULL UNIQUE REFERENCES reservations(id) ON DELETE CASCADE,
  bad_guest           INTEGER NOT NULL DEFAULT 0 CHECK (bad_guest IN (0, 1)),
  bad_guest_note      TEXT,
  bad_guest_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  bad_guest_at        TEXT,
  state               TEXT CHECK (state IS NULL OR state IN ('needs_approval', 'scheduled', 'sent', 'failed')),
  source              TEXT CHECK (source IS NULL OR source IN ('manual', 'rule')),
  rule_id             TEXT REFERENCES guest_review_rules(id) ON DELETE SET NULL,
  template_id         TEXT REFERENCES guest_review_templates(id) ON DELETE SET NULL,
  cleanliness         INTEGER CHECK (cleanliness BETWEEN 1 AND 5),
  communication       INTEGER CHECK (communication BETWEEN 1 AND 5),
  respect_house_rules INTEGER CHECK (respect_house_rules BETWEEN 1 AND 5),
  public_review       TEXT,
  private_note        TEXT,
  recommend           INTEGER CHECK (recommend IN (0, 1)),
  tags                JSONB,
  send_after          TEXT,
  attempts            INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  last_attempt_at     TEXT,
  sent_at             TEXT,
  written_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  written_at          TEXT,
  approved_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS guest_reviews_due_idx ON guest_reviews (state, send_after);

ALTER TABLE guest_review_templates OWNER TO pos_app;
ALTER TABLE guest_review_rules OWNER TO pos_app;
ALTER TABLE guest_reviews OWNER TO pos_app;
ALTER TABLE guest_review_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_review_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_reviews ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON guest_review_templates, guest_review_rules, guest_reviews TO pos_app;

select demo.sync();
