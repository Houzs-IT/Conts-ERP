-- REVERSAL: drop table scm.staff_receipt_files, scm.staff_receipt_lines, scm.staff_receipts, scm.petty_cash_events,
--   scm.petty_cash_overrides, scm.petty_cash_floats, scm.payment_request_files, scm.payment_request_lines,
--   scm.payment_requests, scm.staff_bank_details; drop view public.conts_units, public.conts_maintenance_jobs,
--   public.conts_employee_bank, pos.staff_receipt_job_lines; alter table scm.payment_vouchers drop column
--   payment_request_id, drop column petty_cash_float_id, drop column staff_receipt_id; alter table
--   scm.payment_voucher_lines drop column unit_id; and re-create public.conts_staff as in 0113.
-- Staff payment requests and petty cash (finance; SOP 3.2, 3.5 and 6; design
-- docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md, chew 28-29 Oct 2026).
-- Staff hand in receipts from either system; each department's petty cash float pays them back, or finance does
-- when the department has none. Office staff ask finance to pay suppliers. The engine owns every row; Property OS
-- only forwards to it. People are Property OS user ids (pos.users.id, text) throughout.
--   scm.petty_cash_floats        one active float per department, kept by one person (any staff member)
--   scm.petty_cash_overrides     a person pointed at another department's float
--   scm.petty_cash_events        money paid to the keeper (a posted voucher), returned to finance, repaid by staff
--   scm.staff_receipts (+ lines, files)   a person's own spending, paid back from a float or by finance
--   scm.payment_requests (+ lines, files) a supplier payment (optionally against a PO) or a deposit
--   scm.staff_bank_details       bank details of staff not on the HR employee record
--   scm.payment_vouchers         gains the request, float or receipt it pays; its lines gain the Rental unit
--   public.conts_staff           gains department_id, the department's side and the role
--   public.conts_units / conts_maintenance_jobs / conts_employee_bank   read-only views for the engine
--   pos.staff_receipt_job_lines  read-only view of receipts by maintenance job, for Property OS
-- APPLY: by hand, to production before the code merges, in one transaction with its public.pos_migrations row.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

create table scm.petty_cash_floats (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id),
  department_id text not null,
  keeper_user_id text not null,
  float_sen bigint not null check (float_sen >= 0),
  warn_pct integer not null default 20 check (warn_pct between 0 and 100),
  active boolean not null default true,
  topup_requested_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index petty_cash_floats_department_active on scm.petty_cash_floats (company_id, department_id) where active;
create unique index petty_cash_floats_keeper_active on scm.petty_cash_floats (company_id, keeper_user_id) where active;

create table scm.petty_cash_overrides (
  company_id bigint not null references public.companies(id),
  user_id text not null,
  float_id uuid not null references scm.petty_cash_floats(id),
  primary key (company_id, user_id)
);

create table scm.staff_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id),
  receipt_no text not null,
  submitter_user_id text not null,
  float_id uuid references scm.petty_cash_floats(id),
  spend_date date not null,
  amount_sen bigint not null check (amount_sen > 0),
  vendor_name text,
  note text,
  status text not null default 'HANDED_IN'
    check (status in ('HANDED_IN', 'CHECKED', 'TOPPED_UP', 'PAID_BACK', 'REJECTED', 'REPAID', 'WRITTEN_OFF', 'REPLACED')),
  reject_reason text,
  checked_at timestamptz,
  checked_by text,
  je_id uuid,
  topup_pv_id uuid references scm.payment_vouchers(id),
  payback_pv_id uuid references scm.payment_vouchers(id),
  replaces_id uuid references scm.staff_receipts(id),
  writeoff_account_code text,
  writeoff_je_id uuid,
  source text not null default 'engine' check (source in ('engine', 'property_os', 'field_app')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, receipt_no)
);
create index staff_receipts_submitter on scm.staff_receipts (company_id, submitter_user_id, spend_date);
create index staff_receipts_float on scm.staff_receipts (company_id, float_id, spend_date);

create table scm.staff_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references scm.staff_receipts(id) on delete cascade,
  department text not null check (department in ('rental', 'supply', 'shared')),
  unit_id text,
  maintenance_issue_id text,
  project_id bigint references public.projects(id),
  account_code text,
  amount_sen bigint not null check (amount_sen > 0),
  description text,
  sort integer not null default 0
);
create index staff_receipt_lines_receipt on scm.staff_receipt_lines (receipt_id);
create index staff_receipt_lines_project on scm.staff_receipt_lines (project_id) where project_id is not null;
create index staff_receipt_lines_job on scm.staff_receipt_lines (maintenance_issue_id) where maintenance_issue_id is not null;

create table scm.staff_receipt_files (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references scm.staff_receipts(id) on delete cascade,
  r2_key text not null,
  file_name text not null,
  mime text not null,
  byte_size bigint not null,
  created_at timestamptz not null default now()
);
create index staff_receipt_files_receipt on scm.staff_receipt_files (receipt_id);

create table scm.petty_cash_events (
  id uuid primary key default gen_random_uuid(),
  float_id uuid not null references scm.petty_cash_floats(id),
  kind text not null check (kind in ('PAID_IN', 'RETURNED', 'REPAID')),
  amount_sen bigint not null check (amount_sen > 0),
  pv_id uuid references scm.payment_vouchers(id),
  receipt_id uuid references scm.staff_receipts(id),
  event_date date not null,
  note text,
  created_by text,
  created_at timestamptz not null default now()
);
create index petty_cash_events_float on scm.petty_cash_events (float_id);
create unique index petty_cash_events_pv on scm.petty_cash_events (pv_id) where pv_id is not null;

create table scm.payment_requests (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id),
  request_no text not null,
  type text not null check (type in ('PAYMENT', 'DEPOSIT')),
  requester_user_id text not null,
  supplier_id uuid references scm.suppliers(id),
  payee_name text not null,
  payee_to_check boolean not null default false,
  purchase_order_id uuid references scm.purchase_orders(id),
  wanted_on date,
  owes_formal_invoice boolean not null default false,
  note text,
  amount_sen bigint not null check (amount_sen > 0),
  status text not null default 'SUBMITTED'
    check (status in ('SUBMITTED', 'PART_PAID', 'PAID', 'REJECTED', 'CLOSED', 'WITHDRAWN')),
  reason text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, request_no)
);
create index payment_requests_requester on scm.payment_requests (company_id, requester_user_id);
create index payment_requests_status on scm.payment_requests (company_id, status);

create table scm.payment_request_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references scm.payment_requests(id) on delete cascade,
  department text not null check (department in ('rental', 'supply', 'shared')),
  unit_id text,
  maintenance_issue_id text,
  project_id bigint references public.projects(id),
  account_code text,
  amount_sen bigint not null check (amount_sen > 0),
  description text,
  sort integer not null default 0
);
create index payment_request_lines_request on scm.payment_request_lines (request_id);
create index payment_request_lines_project on scm.payment_request_lines (project_id) where project_id is not null;

create table scm.payment_request_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references scm.payment_requests(id) on delete cascade,
  r2_key text not null,
  file_name text not null,
  mime text not null,
  byte_size bigint not null,
  created_at timestamptz not null default now()
);
create index payment_request_files_request on scm.payment_request_files (request_id);

create table scm.staff_bank_details (
  company_id bigint not null references public.companies(id),
  user_id text not null,
  bank_name text not null,
  account_no text not null,
  account_name text not null,
  checked_by text,
  checked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

alter table scm.payment_vouchers
  add column if not exists payment_request_id uuid references scm.payment_requests(id),
  add column if not exists petty_cash_float_id uuid references scm.petty_cash_floats(id),
  add column if not exists staff_receipt_id uuid references scm.staff_receipts(id);
create index if not exists payment_vouchers_payment_request on scm.payment_vouchers (payment_request_id) where payment_request_id is not null;
create index if not exists payment_vouchers_petty_cash_float on scm.payment_vouchers (petty_cash_float_id) where petty_cash_float_id is not null;
alter table scm.payment_voucher_lines add column if not exists unit_id text;

do $$ declare t text; begin
  foreach t in array array['petty_cash_floats', 'petty_cash_overrides', 'staff_receipts', 'staff_receipt_lines',
    'staff_receipt_files', 'petty_cash_events', 'payment_requests', 'payment_request_lines', 'payment_request_files',
    'staff_bank_details'] loop
    execute format('alter table scm.%I owner to scm_engine', t);
    execute format('alter table scm.%I enable row level security', t);
    execute format('revoke all on scm.%I from anon, authenticated', t);
    -- The engine reaches these through the Supabase REST client (service_role).
    execute format('grant all on scm.%I to service_role, pos_app', t);
  end loop;
end $$;

-- The staff the engine may see, now with the department (and its side) and the role. Columns are only appended, so
-- the engine's existing readers of 0113's columns are unchanged.
create or replace view public.conts_staff as
  select u.id, u.full_name, u.email, nullif(trim(u.department), '') as department, nullif(trim(u.position), '') as position,
         (u.is_active = 1) as active, u.department_id, d.side as department_side, u.role
    from pos.users u
    left join pos.departments d on d.id = u.department_id
   where u.role <> 'owner';

create or replace view public.conts_units as
  select u.id, p.name as building, u.unit_number
    from pos.units u join pos.properties p on p.id = u.property_id;

create or replace view public.conts_maintenance_jobs as
  select m.id, m.unit_id, m.title, m.assignee_user_id, m.state
    from pos.maintenance_issues m;

-- In-house cleaners' and technicians' bank details live on the HR record, linked to a login through the rosters.
create or replace view public.conts_employee_bank as
  select coalesce(c.user_id, t.user_id) as user_id, e.bank_name, e.bank_account
    from pos.employees e
    left join pos.cleaners c on c.id = e.cleaner_id
    left join pos.technicians t on t.id = e.technician_id
   where coalesce(c.user_id, t.user_id) is not null and e.bank_account is not null;

do $$ declare v text; begin
  foreach v in array array['conts_staff', 'conts_units', 'conts_maintenance_jobs', 'conts_employee_bank'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', v);
    execute format('grant select on public.%I to scm_engine, service_role', v);
  end loop;
end $$;

-- What staff spent on each maintenance job, for the job page in Property OS (replaced and rejected receipts left out).
create or replace view pos.staff_receipt_job_lines as
  select l.maintenance_issue_id, r.receipt_no, r.status, l.amount_sen, r.spend_date
    from scm.staff_receipt_lines l join scm.staff_receipts r on r.id = l.receipt_id
   where l.maintenance_issue_id is not null and r.status not in ('REPLACED', 'REJECTED');
revoke all on pos.staff_receipt_job_lines from public, anon, authenticated;
grant select on pos.staff_receipt_job_lines to pos_app;

notify pgrst, 'reload schema';
