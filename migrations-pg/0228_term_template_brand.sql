-- REVERSAL: drop index scm.uq_reno_term_templates_default; alter table scm.reno_term_templates drop column brand_id; create unique index uq_reno_term_templates_default on scm.reno_term_templates (company_id, kind) where is_default;
-- A payment-term template can belong to one brand (owner, 5 Nov 2026). Blank means every brand. Each brand keeps its own default.
set local lock_timeout = '5s';

alter table scm.reno_term_templates
  add column if not exists brand_id bigint references public.project_brands(id) on delete set null;

drop index if exists scm.uq_reno_term_templates_default;
create unique index uq_reno_term_templates_default on scm.reno_term_templates (company_id, kind, coalesce(brand_id, 0)) where is_default;
