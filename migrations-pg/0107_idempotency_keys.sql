-- Duplicate-submit protection for money and document writes (payments, payouts, statements, expenses, credit notes,
-- guest documents, owner adjustments). The screens send an Idempotency-Key header with those writes and reuse it when
-- the same write is sent again (a second click while the first is still on its way, or a retry after the connection
-- dropped). The API middleware (functions/_lib/idempotency.ts) records the first answer here and, for 24 hours, hands
-- that answer back for the same key and person instead of running the write a second time.
--
-- Optional: the middleware checks for this table first. Without it the header is ignored and every write runs as before.
--
-- REVERSAL: DROP TABLE idempotency_keys;
set local search_path = pos;

CREATE TABLE idempotency_keys (
  user_id       TEXT NOT NULL,
  key           TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  status        INTEGER,          -- NULL while the first request is still running
  response_body TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys(created_at);

ALTER TABLE idempotency_keys OWNER TO pos_app;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO pos_app;
