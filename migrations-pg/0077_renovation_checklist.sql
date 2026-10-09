-- REVERSAL: drop index public.project_checklist_project_item_key_unique; drop index public.project_checklist_sections_stage_idx; alter table public.project_checklist drop constraint project_checklist_skip_check, drop column item_key, drop column evidence_hint, drop column skippable, drop column skip_reason, drop column skipped_by, drop column skipped_at; alter table public.project_checklist_sections drop column stage_key; alter table public.project_checklist_template_items drop column item_key, drop column evidence_hint, drop column skippable; alter table public.project_checklist_template_sections drop column stage_key; alter table public.project_checklist_templates drop constraint project_checklist_templates_kind_check, drop column project_kind;
-- The renovation checklist reuses the engine's checklist tables. A template and its copies on a
-- project gain a stage (one section per stage) and a stable item_key that the gates read
-- (renovation_permit, shop_drawings_signed, handover_signed...). An item may be skipped only with a
-- reason; the old 'na' status is refused for renovation items by the route.
set local search_path = public, extensions;

alter table public.project_checklist_templates
  add column project_kind text not null default 'exhibition',
  add constraint project_checklist_templates_kind_check check (project_kind in ('exhibition', 'renovation'));

alter table public.project_checklist_template_sections add column stage_key text;
alter table public.project_checklist_template_items
  add column item_key text,
  add column evidence_hint text,
  add column skippable boolean not null default true;

alter table public.project_checklist_sections add column stage_key text;
alter table public.project_checklist
  add column item_key text,
  add column evidence_hint text,
  add column skippable boolean not null default true,
  add column skip_reason text,
  add column skipped_by bigint,
  add column skipped_at timestamptz;

-- A skipped item carries who, when and why, and only a skippable item can be skipped.
alter table public.project_checklist
  add constraint project_checklist_skip_check check (
    (skip_reason is null and skipped_by is null and skipped_at is null)
    or (length(trim(skip_reason)) >= 3 and skipped_by is not null and skipped_at is not null and skippable));

create unique index project_checklist_project_item_key_unique
  on public.project_checklist (project_id, item_key) where item_key is not null;
create index project_checklist_sections_stage_idx
  on public.project_checklist_sections (project_id, stage_key) where stage_key is not null;
