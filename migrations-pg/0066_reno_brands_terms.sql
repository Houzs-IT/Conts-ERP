-- REVERSAL: DROP TABLE scm.reno_term_template_lines, scm.reno_term_templates, scm.reno_brand_profiles;
--           DELETE FROM public.project_brands WHERE name IN ('Dream Crafter', 'The Conts') AND logo_r2_key IS NULL;
-- Letterheads and payment terms for renovation documents (quotation, sales order, variation order).
-- 1. The two brands the owner's documents print under, as project brands (the engine already keeps a logo per
--    brand there), plus what each prints: company block, phone/email line, bank line, terms and the intro sentence.
--    Text copied from the owner's sample PDFs (AVA Residence and D'Clover for Dream Crafter; Skyline Embassy and
--    KL 48 for The Conts). Editable on screen.
-- 2. Payment-term templates. CUSTOMER templates are the instalments a contract bills (each tied to a project stage and
--    a trigger); PO templates are the instalments a supplier or subcontractor is paid. Seeds: 30/30/35/5 with the
--    D'Clover wording, 15/50/30/5, and Mobilise 30 / Completion 65 / Retention 5 (owner default for POs).
insert into public.project_brands (name, color, sort_order, active, company_id)
select v.name, v.color, v.sort_order, 1, 1
from (values ('Dream Crafter', '#4a90d9', 90), ('The Conts', '#8a6a2f', 91)) as v(name, color, sort_order)
where not exists (select 1 from public.project_brands b where lower(b.name) = lower(v.name));

create table scm.reno_brand_profiles (
  brand_id bigint primary key references public.project_brands(id) on delete cascade,
  company_id bigint not null default 1,
  company_lines text[] not null default '{}',
  contact_line text not null default '',
  bank_line text not null default '',
  terms_lines text[] not null default '{}',
  intro text not null default '',
  signatory_company text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into scm.reno_brand_profiles (brand_id, company_lines, contact_line, bank_line, terms_lines, intro, signatory_company)
select b.id,
  array['THE CONTS SDN BHD 202301027399 (1521322-V)', 'E-28-02 Menara SUEZCAP 2, KL Gateway,',
        'No.2, Jalan Kerinchi, Gerbang Kerinchi Lestari,', '59200 Kuala Lumpur, Wilayah Persekutuan KL.'],
  case when b.name = 'Dream Crafter' then 'PHONE : 016-616 4727 // EMAIL : T.CONTS725@GMAIL.COM'
       else 'PHONE : 018-9444796 // EMAIL : servicesupport@thecontsgroup.com' end,
  'Payment shall be made payable to THE CONTS SDN BHD HLBB 23601011471',
  array['Customer shall inspect and confirm that goods receive are in good condition.',
        'Goods sold are not returnable. All payment are not refundable.',
        'The company reserves the right not to entertain any claims after 7 days from handover.',
        'The company reserves the right to refund the customer if the items purchased be discontinued.'],
  'We refer to our meeting with regards the above captioned matter and we are pleased to submit our quotation as follow : -',
  'THE CONTS SDN BHD'
from public.project_brands b
where b.name in ('Dream Crafter', 'The Conts')
on conflict (brand_id) do nothing;

create table scm.reno_term_templates (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null default 1,
  kind text not null check (kind in ('CUSTOMER', 'PO')),
  name text not null check (length(trim(name)) > 0),
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, kind, name)
);
create unique index uq_reno_term_templates_default on scm.reno_term_templates (company_id, kind) where is_default;

create table scm.reno_term_template_lines (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references scm.reno_term_templates(id) on delete cascade,
  seq integer not null check (seq > 0),
  label text not null,
  pct_bp integer not null check (pct_bp > 0 and pct_bp <= 10000),
  description text not null default '',
  stage_code text check (stage_code in ('design', 'key_permit', 'defect_check', 'shop_drawings', 'hardware', 'furniture', 'appliances', 'soft_furnishing', 'handover', 'warranty', 'closed')),
  trigger text not null default 'stage_start' check (trigger in ('so_confirmed', 'stage_start', 'stage_done')),
  payable_on text check (payable_on in ('ON_CONFIRM', 'ON_RECEIPT', 'ON_HANDOVER', 'MANUAL')),
  unique (template_id, seq)
);

with t as (
  insert into scm.reno_term_templates (kind, name, is_default) values
    ('CUSTOMER', '30 / 30 / 35 / 5', true),
    ('CUSTOMER', '15 / 50 / 30 / 5', false),
    ('PO', 'Mobilise 30 / Completion 65 / Retention 5', true)
  returning id, kind, name
)
insert into scm.reno_term_template_lines (template_id, seq, label, pct_bp, description, stage_code, trigger, payable_on)
select t.id, l.seq, l.label, l.pct_bp, l.description, l.stage_code, l.trigger, l.payable_on
from t join (values
  ('30 / 30 / 35 / 5', 1, '1ST PAYMENT', 3000, 'Upon confirmation, we will proceed with key collection, arrange defect inspection, and conduct site measurement for design drawings.', 'key_permit', 'so_confirmed', null),
  ('30 / 30 / 35 / 5', 2, '2ND PAYMENT', 3000, 'Once defects are rectified and the design is finalized, we will begin initial works such as ceiling, electrical, and painting.', 'hardware', 'stage_start', null),
  ('30 / 30 / 35 / 5', 3, '3RD PAYMENT', 3500, 'A detailed work schedule, including the estimated completion date, will be provided prior to cabinet installation.', 'furniture', 'stage_start', null),
  ('30 / 30 / 35 / 5', 4, '4TH PAYMENT', 500, 'Final payment shall be made upon project completion and site inspection by the owner. Any defects identified will be rectified within 7 days prior to final payment.', 'handover', 'stage_done', null),
  ('15 / 50 / 30 / 5', 1, '1ST PAYMENT', 1500, 'Deposit upon confirmation.', 'design', 'so_confirmed', null),
  ('15 / 50 / 30 / 5', 2, '2ND PAYMENT', 5000, 'Before hardware works begin.', 'hardware', 'stage_start', null),
  ('15 / 50 / 30 / 5', 3, '3RD PAYMENT', 3000, 'Before furniture and built-in installation.', 'furniture', 'stage_start', null),
  ('15 / 50 / 30 / 5', 4, '4TH PAYMENT', 500, 'Upon handover.', 'handover', 'stage_done', null),
  ('Mobilise 30 / Completion 65 / Retention 5', 1, 'Mobilise', 3000, 'Payable when the PO is confirmed.', null, 'stage_start', 'ON_CONFIRM'),
  ('Mobilise 30 / Completion 65 / Retention 5', 2, 'Completion', 6500, 'Payable when the PO is fully received.', null, 'stage_start', 'ON_RECEIPT'),
  ('Mobilise 30 / Completion 65 / Retention 5', 3, 'Retention', 500, 'Released after handover with the snag list closed.', null, 'stage_start', 'ON_HANDOVER')
) as l(tname, seq, label, pct_bp, description, stage_code, trigger, payable_on) on l.tname = t.name;

do $$ declare t text; begin
  foreach t in array array['reno_brand_profiles', 'reno_term_templates', 'reno_term_template_lines'] loop
    execute format('alter table scm.%I owner to scm_engine', t);
    execute format('alter table scm.%I enable row level security', t);
    execute format('grant all on scm.%I to pos_app, service_role', t);
    execute format('revoke all on scm.%I from anon, authenticated', t);
  end loop;
end $$;
