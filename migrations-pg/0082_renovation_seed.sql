-- REVERSAL: delete from public.app_settings where key = 'projects_mode'; delete from public.project_types where slug in ('full_renovation', 'airbnb_package', 'carpentry_only'); then delete the renovation templates' items, sections and templates (project_checklist_templates.project_kind = 'renovation', children by template_id).
-- Seeds the three renovation project types with their checklist templates (spec section 5), and
-- switches the engine's Projects area to renovation mode. Item keys are what the gates read:
--   renovation_permit     hardware gate; may be skipped with a reason (no permit needed)
--   shop_drawings_signed  hardware gate; never skippable
--   handover_signed       handover; never skippable
-- One template per type so each can be edited on its own in Project Maintenance.
set local search_path = public, extensions;

insert into public.app_settings (key, value, updated_at)
values ('projects_mode', 'renovation', to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

do $$
declare
  co record;
  ty record;
  tpl_id bigint;
  sec_id bigint;
  st text;
  it record;
  sec_order integer;
  item_seq integer;
  type_order integer := 0;
  stage_names constant jsonb := '{
    "design": "Design", "key_permit": "Key collection & permit", "defect_check": "Defect check",
    "shop_drawings": "Site measure & shop drawings", "hardware": "Hardware works",
    "furniture": "Furniture & built-in", "appliances": "Appliances",
    "soft_furnishing": "Soft furnishing / Airbnb setup", "handover": "Cleaning & handover",
    "warranty": "Warranty", "closed": "Closed"}';
begin
  for co in select id from public.companies loop
    type_order := 0;
    for ty in
      select * from (values
        ('full_renovation', 'Full renovation',
          array['design','key_permit','defect_check','shop_drawings','hardware','furniture','appliances','soft_furnishing','handover','warranty','closed']),
        ('airbnb_package', 'Airbnb package',
          array['design','key_permit','shop_drawings','furniture','appliances','soft_furnishing','handover','warranty','closed']),
        ('carpentry_only', 'Carpentry only',
          array['design','key_permit','defect_check','shop_drawings','furniture','handover','warranty','closed'])
      ) as t(slug, name, stage_keys)
    loop
      if exists (select 1 from public.project_types where company_id = co.id and slug = ty.slug) then
        continue;
      end if;
      type_order := type_order + 10;
      insert into public.project_checklist_templates (name, description, active, company_id, project_kind)
      values (ty.name || ' checklist', 'Renovation stage checklist for ' || ty.name, 1, co.id, 'renovation')
      returning id into tpl_id;

      sec_order := 0;
      item_seq := 0;
      foreach st in array ty.stage_keys loop
        sec_order := sec_order + 10;
        insert into public.project_checklist_template_sections (template_id, name, sort_order, company_id, stage_key)
        values (tpl_id, stage_names ->> st, sec_order, co.id, st)
        returning id into sec_id;
        for it in
          select * from (values
            ('design', 'design_brief', 'Design brief from the customer', 'Brief notes', true),
            ('design', 'layout_plan', 'Layout plan', 'Drawings', true),
            ('design', 'design_3d', '3D design', 'Renders', true),
            ('design', 'quotation_revisions', 'Quotation revisions agreed', 'Quotation', true),
            ('key_permit', 'keys_collected', 'Keys and access cards collected (count)', 'Photo of keys and cards', true),
            ('key_permit', 'renovation_permit', 'Renovation permit approved', 'Permit', true),
            ('key_permit', 'renovation_deposit', 'Renovation deposit paid to management', 'Deposit receipt', true),
            ('key_permit', 'worker_passes', 'Worker passes issued', 'Passes', true),
            ('defect_check', 'defect_inspect', 'Inspect every room for defects', 'Defect report with photos', true),
            ('defect_check', 'defect_submit', 'Submit defect list to the developer', 'Submission', true),
            ('defect_check', 'defect_follow_up', 'Follow up with the developer', null, true),
            ('defect_check', 'defect_reinspect', 'Re-inspect after developer repair', 'Photos', true),
            ('shop_drawings', 'site_measure', 'Site measure', 'Measurements', false),
            ('shop_drawings', 'carpentry_drawings', 'Carpentry shop drawings', 'Drawings', true),
            ('shop_drawings', 'electrical_drawings', 'Electrical layout drawing', 'Drawings', true),
            ('shop_drawings', 'ceiling_drawings', 'Plaster ceiling drawing', 'Drawings', true),
            ('shop_drawings', 'material_colour', 'Material and colour selection', 'Colour sheet', true),
            ('shop_drawings', 'shop_drawings_signed', 'Customer signs off shop drawings (max 3 amendments)', 'Signed drawings', false),
            ('furniture', 'cabinet_install', 'Cabinet delivery and installation', 'Site receipt', true),
            ('furniture', 'stone_top_measure', 'Stone top measured after cabinets', 'Measurements', true),
            ('furniture', 'curtain_install', 'Curtain installation', 'Site receipt', true),
            ('furniture', 'loose_furniture', 'Loose furniture delivery', 'Site receipt', true),
            ('appliances', 'appliance_delivery', 'Appliance delivery', 'Site receipt', true),
            ('appliances', 'appliance_install', 'Appliance installation', 'Photos', true),
            ('appliances', 'power_test', 'Power test of every appliance', 'Test tick', true),
            ('soft_furnishing', 'linen', 'Bed linen', 'Site receipt', true),
            ('soft_furnishing', 'amenities', 'Amenities', 'Site receipt', true),
            ('soft_furnishing', 'styling', 'Styling', 'Photos', true),
            ('soft_furnishing', 'photoshoot', 'Photoshoot', 'Photos', true),
            ('handover', 'walk_through', 'Customer walk-through', 'Snag photos', false),
            ('handover', 'snags_rectified', 'Snag list rectified within 7 days', 'Snag photos', false),
            ('handover', 'handover_signed', 'Handover form signed by the customer', 'Signed handover', false),
            ('handover', 'keys_returned', 'Keys returned to the customer', null, true),
            ('handover', 'deposit_refund', 'Renovation deposit refunded', 'Refund proof', true)
          ) as i(stage, item_key, title, evidence, skippable)
          where i.stage = st
        loop
          item_seq := item_seq + 10;
          insert into public.project_checklist_template_items
            (template_id, seq, title, section_id, requires_review, crew_visible, company_id, item_key, evidence_hint, skippable)
          values (tpl_id, item_seq, it.title, sec_id, 0, 1, co.id, it.item_key, it.evidence, it.skippable);
        end loop;
      end loop;

      insert into public.project_types (slug, name, stage_keys, checklist_template_id, sort_order, company_id)
      values (ty.slug, ty.name, ty.stage_keys, tpl_id, type_order, co.id);
    end loop;
  end loop;
end $$;
