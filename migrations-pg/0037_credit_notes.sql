-- Credit and debit notes, copied from Houzs ERP (acc_credit_notes). Three documents on one table:
--   CN  — credit note to a customer: reduces what the customer owes
--   DN  — debit note to a customer: increases what the customer owes
--   SCN — credit note from a supplier: reduces what we owe the supplier
-- A note is DRAFT until posted; only a POSTED note moves a balance; a posted note is never edited,
-- it is cancelled and raised again. Houzs posts each note as a journal against a chart of
-- accounts; Conts has no general ledger, so a posted note adjusts the customer's or supplier's
-- outstanding balance directly (functions/api/accounting). Customers are matched by name, the
-- same key sales invoices carry. Money integer sen.
-- REVERSAL: DROP TABLE credit_note_lines; DROP TABLE credit_notes;
set local search_path = pos;

CREATE TABLE credit_notes (
  id                  TEXT PRIMARY KEY,
  note_number         TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('CN','DN','SCN')),
  party_type          TEXT NOT NULL CHECK (party_type IN ('CUSTOMER','SUPPLIER')),
  party_name          TEXT NOT NULL,
  supplier_id         TEXT REFERENCES suppliers(id),
  sales_order_id      TEXT REFERENCES sales_orders(id),
  sales_invoice_id    TEXT REFERENCES sales_invoices(id),
  purchase_invoice_id TEXT REFERENCES purchase_invoices(id),
  source_doc_no       TEXT,
  note_date           TEXT NOT NULL,
  total_sen           INTEGER NOT NULL CHECK (total_sen > 0),
  reason              TEXT,
  notes               TEXT,
  status              TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED','CANCELLED')),
  created_by          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  posted_at           TEXT,
  posted_by           TEXT,
  cancelled_at        TEXT,
  cancelled_by        TEXT,
  UNIQUE (note_number),
  CHECK ((kind = 'SCN') = (party_type = 'SUPPLIER')),
  CHECK (party_type <> 'SUPPLIER' OR supplier_id IS NOT NULL)
);

CREATE TABLE credit_note_lines (
  id          TEXT PRIMARY KEY,
  note_id     TEXT NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  description TEXT,
  amount_sen  INTEGER NOT NULL CHECK (amount_sen > 0)
);

CREATE INDEX idx_cn_kind_status ON credit_notes (kind, status);
CREATE INDEX idx_cn_party ON credit_notes (party_type, party_name);
CREATE INDEX idx_cn_supplier ON credit_notes (supplier_id);
CREATE INDEX idx_cn_lines_note ON credit_note_lines (note_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
