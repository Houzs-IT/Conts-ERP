-- REVERSAL: drop index scm.uq_smb_one_main; (the demotions below are not restored; the demoted bindings are listed by the NOTICE when this runs).
-- One main supplier per SKU (spec 2026-10-09 section 3, "Binding"): the main binding pre-fills a document line's
-- supplier and cost, and the SO -> PO split groups by it, so two "main" bindings for one SKU would split a PO
-- arbitrarily. Until now only the single-binding routes kept it to one (the batch create did not demote, and
-- idx_smb_main_per_material is not unique).
--
-- Guard: where a SKU already has more than one main binding in a company, keep the most recently updated one
-- and demote the rest (each demoted binding is printed). Then the unique partial index makes it a rule.
set local search_path = scm, public, extensions;

do $$
declare r record;
begin
  for r in
    select id, company_id, material_kind, item_code, supplier_id from (
      select b.*, row_number() over (partition by company_id, material_kind, item_code
                                     order by updated_at desc, created_at desc, id) as rn
        from scm.supplier_material_bindings b
       where is_main_supplier
    ) x where rn > 1
  loop
    raise notice 'demoting extra main binding % (company %, % %, supplier %)', r.id, r.company_id, r.material_kind, r.item_code, r.supplier_id;
    update scm.supplier_material_bindings set is_main_supplier = false, updated_at = now() where id = r.id;
  end loop;
end $$;

create unique index uq_smb_one_main on scm.supplier_material_bindings (company_id, material_kind, item_code)
  where is_main_supplier;
