-- Numbered guest documents (owner, 10 Oct 2026): an Invoice and an Official Receipt for a booking, printed on the
-- company letterhead. Numbers are INV-YYMM-NNNN and OR-YYMM-NNNN, YYMM being the Malaysian month of issue.
--
--   document_counters   the last number handed out per type and month. Taken with one INSERT ... ON CONFLICT DO UPDATE
--                       ... RETURNING inside the issuing transaction, so two documents issued at the same moment never
--                       share a number, and a failed issue rolls its number back with it. It only ever rises.
--   issued_documents    every document ever issued. A mistake is voided, never deleted or edited: voided_at and
--                       void_reason are set, the number stays taken (the list shows it struck through) and is never
--                       issued again. snapshot holds everything printed (company, guest, booking, lines, totals) as
--                       it was at issue, so reprinting later shows the same document even after the booking changes.
--                       payment_id: the booking_payments row a receipt acknowledges (not a foreign key: a payment
--                       typed in by mistake can still be removed, and its receipt keeps its snapshot; removing it is
--                       refused while a receipt for it is not voided).
--
-- One live invoice per booking and one live receipt per payment: a voided one can be replaced by a new number.
--
-- REVERSAL: DROP TABLE pos.issued_documents; DROP TABLE pos.document_counters;
set local search_path = pos;

CREATE TABLE document_counters (
  doc_type  TEXT NOT NULL CHECK (doc_type IN ('invoice','receipt')),
  period    TEXT NOT NULL CHECK (period ~ '^\d{4}$'),
  last_no   INTEGER NOT NULL CHECK (last_no > 0),
  PRIMARY KEY (doc_type, period)
);

CREATE TABLE issued_documents (
  id              TEXT PRIMARY KEY,
  doc_type        TEXT NOT NULL CHECK (doc_type IN ('invoice','receipt')),
  doc_no          TEXT NOT NULL UNIQUE CHECK (doc_no ~ '^(INV|OR)-\d{4}-\d{4,}$'),
  reservation_id  TEXT NOT NULL REFERENCES reservations(id),
  payment_id      TEXT,
  amount          INTEGER NOT NULL CHECK (amount >= 0),
  issued_at       TEXT NOT NULL,
  issued_by       TEXT NOT NULL REFERENCES users(id),
  voided_at       TEXT,
  voided_by       TEXT REFERENCES users(id),
  void_reason     TEXT,
  snapshot        JSONB NOT NULL,
  CHECK ((doc_type = 'invoice') = (doc_no LIKE 'INV-%')),
  CHECK (doc_type = 'invoice' OR payment_id IS NOT NULL),
  CHECK ((voided_at IS NULL) = (void_reason IS NULL)),
  CHECK (void_reason IS NULL OR length(btrim(void_reason)) > 0)
);
CREATE INDEX issued_documents_reservation_idx ON issued_documents(reservation_id);
CREATE INDEX issued_documents_issued_idx ON issued_documents(issued_at DESC);
CREATE UNIQUE INDEX issued_documents_live_invoice ON issued_documents(reservation_id) WHERE doc_type = 'invoice' AND voided_at IS NULL;
CREATE UNIQUE INDEX issued_documents_live_receipt ON issued_documents(payment_id) WHERE doc_type = 'receipt' AND voided_at IS NULL;

ALTER TABLE document_counters OWNER TO pos_app;
ALTER TABLE document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE issued_documents OWNER TO pos_app;
ALTER TABLE issued_documents ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON document_counters, issued_documents TO pos_app;
