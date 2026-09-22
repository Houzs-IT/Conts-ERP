-- Payment Vouchers (AP), ported from 2990's SCM. A voucher pays one or more purchase
-- invoices for a supplier: each allocation adds to the invoice's paid_sen and drives its
-- status (POSTED -> PARTIALLY_PAID -> PAID). Cancelling reverses. Money integer sen.
-- REVERSAL: DROP TABLE payment_voucher_allocations; DROP TABLE payment_vouchers;
set local search_path = pos;

CREATE TABLE payment_vouchers (
  id             TEXT PRIMARY KEY,
  voucher_number TEXT NOT NULL,
  supplier_id    TEXT NOT NULL REFERENCES suppliers(id),
  payment_date   TEXT NOT NULL,
  method         TEXT NOT NULL DEFAULT 'TRANSFER',
  reference      TEXT,
  amount_sen     INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','CANCELLED')),
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (voucher_number)
);

CREATE TABLE payment_voucher_allocations (
  id                  TEXT PRIMARY KEY,
  voucher_id          TEXT NOT NULL REFERENCES payment_vouchers(id) ON DELETE CASCADE,
  purchase_invoice_id TEXT NOT NULL REFERENCES purchase_invoices(id),
  amount_sen          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_pv_supplier ON payment_vouchers (supplier_id);
CREATE INDEX idx_pv_status ON payment_vouchers (status);
CREATE INDEX idx_pv_alloc_voucher ON payment_voucher_allocations (voucher_id);
CREATE INDEX idx_pv_alloc_invoice ON payment_voucher_allocations (purchase_invoice_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
