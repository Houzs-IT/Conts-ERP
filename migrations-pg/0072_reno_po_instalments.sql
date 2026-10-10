-- REVERSAL: DROP TABLE scm.reno_po_instalment_payments, scm.reno_po_instalments;
-- Payment schedule of a renovation purchase order (supplier or subcontractor): default Mobilise 30 / Completion 65 /
-- Retention 5, editable per PO. When an instalment becomes payable is worked out when it is read, never stored:
-- ON_CONFIRM once the PO is confirmed, ON_RECEIPT once every line is received, ON_HANDOVER once the project is handed
-- over (phase 3), MANUAL once someone releases it. Payments link the payment voucher that paid them.
create table scm.reno_po_instalments (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null default 1,
  purchase_order_id uuid not null references scm.purchase_orders(id) on delete cascade,
  seq integer not null check (seq > 0),
  label text not null,
  pct_bp integer not null check (pct_bp > 0 and pct_bp <= 10000),
  amount_sen integer not null check (amount_sen >= 0),
  payable_on text not null check (payable_on in ('ON_CONFIRM', 'ON_RECEIPT', 'ON_HANDOVER', 'MANUAL')),
  released_at timestamptz,
  released_by text,
  release_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_id, seq)
);

create table scm.reno_po_instalment_payments (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null default 1,
  po_instalment_id uuid not null references scm.reno_po_instalments(id) on delete cascade,
  payment_voucher_id uuid references scm.payment_vouchers(id) on delete set null,
  amount_sen integer not null check (amount_sen > 0),
  paid_on date not null default current_date,
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by text
);
create index idx_reno_po_instalment_payments_inst on scm.reno_po_instalment_payments (po_instalment_id);

do $$ declare t text; begin
  foreach t in array array['reno_po_instalments', 'reno_po_instalment_payments'] loop
    execute format('alter table scm.%I owner to scm_engine', t);
    execute format('alter table scm.%I enable row level security', t);
    execute format('grant all on scm.%I to pos_app, service_role', t);
    execute format('revoke all on scm.%I from anon, authenticated', t);
  end loop;
end $$;
