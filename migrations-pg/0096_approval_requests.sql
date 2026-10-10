-- Maker-checker for money leaving the company (owner, 10 Oct 2026). A guest refund, an owner payout run, an owner
-- credit or charge, an expense above the threshold in Settings, and writing off a held owner debt are not carried out
-- when they are asked for: they are staged here as a request, and only a second person approving it carries the
-- action out (functions/_lib/approvals.ts), in one transaction with the approval and its audit row.
--
--   kind          guest_refund | payout_run | owner_adjustment | expense | debt_write_off
--   entity        the table of the record the request is shown on (reservations, payouts, owners, units, owner_adjustments)
--   entity_id     that record (a payout run: its RUN- reference)
--   amount        sen, always positive: the money that would leave (a charge or a credit alike)
--   payload       the action exactly as it was asked for; approving runs it as written
--   result        what carrying it out created or changed (ids), for the audit trail and the screen
--   self_approved true only when the one management user approved their own request (allowed only while there is
--                 a single active management user, with a note); every such approval is audited as self-approved
--
-- Who may approve, and above what an expense needs approval, are settings (approvals.*), not columns here.
--
-- REVERSAL: DROP TABLE pos.approval_requests;
set local search_path = pos;

CREATE TABLE approval_requests (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('guest_refund','payout_run','owner_adjustment','expense','debt_write_off')),
  entity         TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  amount         INTEGER NOT NULL CHECK (amount >= 0),
  summary        TEXT NOT NULL,
  payload        JSONB NOT NULL,
  reason         TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  requested_by   TEXT NOT NULL REFERENCES users(id),
  requested_at   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by     TEXT REFERENCES users(id),
  decided_at     TEXT,
  decision_note  TEXT,
  self_approved  BOOLEAN NOT NULL DEFAULT false,
  result         JSONB,
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  CHECK (status = 'pending' OR decided_by IS NOT NULL),
  -- The requester never approves their own request, except the single-management case, which must say why.
  CHECK (status <> 'approved' OR decided_by <> requested_by OR (self_approved AND length(btrim(coalesce(decision_note, ''))) > 0))
);
CREATE INDEX approval_requests_status_idx ON approval_requests(status, requested_at DESC);
CREATE INDEX approval_requests_entity_idx ON approval_requests(entity, entity_id) WHERE status = 'pending';

ALTER TABLE approval_requests OWNER TO pos_app;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON approval_requests TO pos_app;
