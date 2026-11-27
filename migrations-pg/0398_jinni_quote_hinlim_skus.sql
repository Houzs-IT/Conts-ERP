-- REVERSAL: delete from scm.supplier_binding_price_history where notes like 'jinni-quotes 2026-11-27%';
--   delete from scm.supplier_material_bindings where notes like 'jinni-quotes 2026-11-27%';
--   delete from scm.mfg_products where code in ('FUR-HLM-144078','FUR-HLM-151037','FUR-HLM-241503','FUR-HLM-241703','FUR-HLM-336046')
--     and nothing (SO / PO / DO / stock line) names its code;
--   delete from scm.product_models where company_id = 1 and model_code in (the same codes) and no SKU points at it.
-- Five Hin Lim SKUs that Jin Ni's unit quotations name (Google sheet "JINNI UNIT PROGRESS", owner 27 Nov 2026: codes we do not
-- have must be opened). They are on the Houzs Century CRM product list but marked OBSOLETE there, so 0346 (SALES rows only)
-- left them out. Same shape as 0346: code FUR-HLM-<Hin Lim code>, group FURNITURE, Active, company 1, cost = Houzs Century
-- Cost Price, main supplier HIN LIM (400-H004) with supplier_sku = Hin Lim code. Safe to run again (keyed on code).

set local search_path = scm, public, extensions;

create temp table hlm_rows on commit drop as
select x.*, (select s.id from scm.suppliers s where s.company_id = 1
               and (s.id = 'f98aa7d5-2bf3-4543-b0ff-cbbc4c5f9360'::uuid or upper(s.code) = '400-H004')
             order by (s.id = 'f98aa7d5-2bf3-4543-b0ff-cbbc4c5f9360'::uuid) desc limit 1) as supplier_id
  from jsonb_to_recordset($hlm$[
{
"id": "mfg-3e9be952e146",
"code": "FUR-HLM-144078",
"name": "STARK 750X1200 DINING TABLE 109/169",
"sub_category": "DINING",
"uom": "PCS",
"cost": 21950,
"m3": 126,
"branding": "NESTHOUZ",
"description": "Size: L1200 W750 H750 T18\nColour: TABLE LEG: 109 COCOA; TABLE TOP: 169 COCOA\nMaterial: TABLE LEG: MALAYSIAN OAK; TABLE TOP: MDF+MELAMINE\nAssembly: KD (KNOCK DOWN)\nPack: 1PC/CTN\nCarton: 144078= L1260 W800 H125\nGross weight: 21.8 kg\nNett weight: 19.2 kg\nCubic: 0.126 m3\nHin Lim code: 144078",
"supplier_sku": "144078"
},
{
"id": "mfg-3e1813a21315",
"code": "FUR-HLM-151037",
"name": "VOLOS SIDE TABLE WITH 2 DRAWER 808/172",
"sub_category": "TABLES",
"uom": "PCS",
"cost": 17600,
"m3": 47,
"branding": "NUHOOM",
"description": "Size: L480 W400 H500\nColour: TABLE LEG: 808 GOLD; TABLE TOP: 172 BLACK\nMaterial: TABLE LEG: METAL; TABLE TOP: LAMINATED BOARD\nAssembly: KD (KNOCK DOWN)\nPack: 1PC/CTN\nCarton: 151037= L575 W455 H180\nGross weight: 22.8 kg\nNett weight: 21.8 kg\nCubic: 0.0471 m3\nHin Lim code: 151037",
"supplier_sku": "151037"
},
{
"id": "mfg-46a1f88b8a4d",
"code": "FUR-HLM-241503",
"name": "JOLLIN DINING CHAIR 109/6205/6203",
"sub_category": "DINING",
"uom": "PCS",
"cost": 14450,
"m3": 95,
"branding": "NESTHOUZ",
"description": "Size: W540 D565 H850 SH460\nColour: CHAIR LEG: 109 COCOA; CHAIR BACK: /6205 NAVY; CHAIR SEAT: 6203 LIGHT BLUE\nMaterial: CHAIR LEG: MALAYSIAN OAK; CHAIR BACK: BENTWOOD; CHAIR FABRIC: DOUBLET FABRIC\nAssembly: SEMI KD (SEMI BUILT UP)\nPack: 2PCS/CTN\nCarton: 241503= L676 W556 H507\nGross weight: 9.45 kg\nNett weight: 8.5 kg\nCubic: 0.0952795 m3\nHin Lim code: 241503",
"supplier_sku": "241503"
},
{
"id": "mfg-fc0d1b79d28a",
"code": "FUR-HLM-241703",
"name": "ASTRID DINING CHAIR 80038 (#)",
"sub_category": "DINING",
"uom": "PCS",
"cost": 17350,
"m3": 143,
"branding": "LUOOMA",
"description": "Size: W500 D520 H810\nColour: CHAIR LEG: 80038 CHESTNUT; CHAIR SEAT: 80038 CHESTNUT\nMaterial: CHAIR LEG: METAL+COMPO FABRIC; CHAIR SEAT: COMPO FABRIC\nAssembly: SEMI KD (SEMI BUILT UP)\nPack: 2PCS/CTN\nCarton: 241703= L850 W601 H560\nGross weight: 7.8 kg\nNett weight: 6.7 kg\nCubic: 0.143038 m3\nHin Lim code: 241703",
"supplier_sku": "241703"
},
{
"id": "mfg-df7086c758a4",
"code": "FUR-HLM-336046",
"name": "VOLOS 1.8M TV CABINET 808/172",
"sub_category": "LOOSE_STORAGE",
"uom": "PCS",
"cost": 26750,
"m3": 86,
"branding": "NUHOOM",
"description": "Size: W1800 D400 H443\nColour: CABINET LEG: 808 GOLD; CABINET BODY: 172 BLACK\nMaterial: CABINET LEG: METAL; CABINET BODY: LAMINATED BOARD\nAssembly: KD (KNOCK DOWN)\nPack: 1PC/CTN\nCarton: 336046= L2062 W453 H92\nGross weight: 31 kg\nNett weight: 29 kg\nCubic: 0.08593591 m3\nHin Lim code: 336046",
"supplier_sku": "336046"
}
]$hlm$::jsonb)
  as x(id text, code text, name text, sub_category text, uom text, cost integer, m3 integer, branding text, description text,
       supplier_sku text)
 where exists (select 1 from public.companies where id = 1);

insert into scm.product_models (company_id, model_code, name, category)
select 1, r.code, r.name, 'FURNITURE'::scm.mfg_product_category from hlm_rows r
on conflict (company_id, model_code, category) do nothing;

insert into scm.mfg_products
    (id, company_id, code, name, category, category_group, sub_category, uom, status, cost_price_sen, unit_m3_milli,
     branding, description, model_id)
select r.id, 1, r.code, r.name, 'FURNITURE'::scm.mfg_product_category, 'FURNITURE', r.sub_category, r.uom, 'ACTIVE',
       r.cost, r.m3, r.branding, r.description, m.id
  from hlm_rows r
  left join scm.product_models m on m.company_id = 1 and m.model_code = r.code and m.category = 'FURNITURE'
on conflict (company_id, code) do nothing;

insert into scm.supplier_material_bindings
    (company_id, supplier_id, material_kind, item_code, material_name, supplier_sku, unit_price_sen, price_valid_from,
     is_main_supplier, notes)
select 1, r.supplier_id, 'mfg_product', r.code, r.name, r.supplier_sku, r.cost, case when r.cost > 0 then date '2026-11-27' end,
       not exists (select 1 from scm.supplier_material_bindings b where b.company_id = 1 and b.material_kind = 'mfg_product'
                                                                  and b.item_code = r.code and b.is_main_supplier),
       'jinni-quotes 2026-11-27: main supplier, cost from the Houzs Century CRM product list'
  from hlm_rows r
 where not exists (select 1 from scm.supplier_material_bindings b where b.company_id = 1 and b.material_kind = 'mfg_product'
                                                                  and b.item_code = r.code and b.supplier_id = r.supplier_id);

insert into scm.supplier_binding_price_history
    (company_id, supplier_id, material_kind, item_code, unit_price_sen, is_main_supplier, effective_from, notes, created_by, applied_at)
select 1, r.supplier_id, 'mfg_product', r.code, r.cost, true, date '2026-11-27', 'jinni-quotes 2026-11-27: Houzs Century Cost Price', 'jinni-quotes 2026-11-27', now()
  from hlm_rows r
 where r.cost > 0
   and not exists (select 1 from scm.supplier_binding_price_history h where h.company_id = 1 and h.supplier_id = r.supplier_id
                     and h.material_kind = 'mfg_product' and h.item_code = r.code and h.effective_from = date '2026-11-27');
