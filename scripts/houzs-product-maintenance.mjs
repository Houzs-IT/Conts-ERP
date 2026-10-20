// Builds migrations-pg/0129_engine_houzs_product_maintenance.sql: Houzs Century's furniture product maintenance
// (bedframe / sofa variant pools, special add-ons, fabric library, colours and the fabric converter), copied into
// the engine's scm tables for The Conts. Owner decision 20 Oct 2026 (CLAUDE.md, engine section). Sofa combo
// pricing and brandings are deliberately NOT copied.
//
//   node scripts/houzs-product-maintenance.mjs <houzs.json> <conts-master-config.json>
//
// <houzs.json>: the read-only extract of Houzs company 1 (Houzs Century) taken from the local masked snapshot of
//   Houzs production (database houzs_local on this machine, restored 16 Oct 2026, newest edit 9 Oct 2026). Never
//   Houzs's live database. Shape: { config, special_addons, fabric_library, fabric_colours, fabric_trackings,
//   fabric_tier_addon_config, compartment_library }.
// <conts-master-config.json>: the Conts production master maintenance config as read on 20 Oct 2026 (the 2990
//   baseline). Pool entries Conts has and Houzs does not are kept; entries both have take Houzs's price, and every
//   such difference is printed so the PR can list it, and written into the new version's note.
// <conts-seed-trackings.json>: the Conts production converter rows ({id, supplier_code}) as read on 20 Oct 2026 (the 2990
//   seed CG- / EZ- / BF-). A seed row whose supplier code IS a Houzs fabric code (zero-padding aside) is the same fabric
//   twice; the lead decided (20 Oct 2026) to keep the Houzs row and deactivate, never delete, the seed row.
import { readFileSync, writeFileSync } from 'node:fs';

const [houzsPath, contsPath, seedPath] = process.argv.slice(2);
if (!houzsPath || !contsPath || !seedPath) { console.error('usage: node scripts/houzs-product-maintenance.mjs <houzs.json> <conts-master-config.json> <conts-seed-trackings.json>'); process.exit(1); }
const contsSeed = JSON.parse(readFileSync(seedPath, 'utf8'));
const H = JSON.parse(readFileSync(houzsPath, 'utf8'));
const contsConfig = JSON.parse(readFileSync(contsPath, 'utf8'));

const EFFECTIVE = '2026-10-20';
const lit = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const arr = (a) => `array[${a.map(lit).join(', ')}]::text[]`;
const json = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;

// ---- master config: Houzs pools, minus brandings (owner: skip) and minus compartment photos (Houzs's bucket).
const houzs = structuredClone(H.config.config);
delete houzs.brandings;
for (const m of Object.values(houzs.sofaCompartmentMeta ?? {})) delete m.imageKey;

const keyOf = (e) => (typeof e === 'string' ? e : e?.value);
const priceOf = (e) => (typeof e === 'string' ? undefined : e?.priceSen ?? e?.price);
const report = { keptContsOnly: [], priceTakenFromHouzs: [] };
for (const [k, contsPool] of Object.entries(contsConfig)) {
  if (!Array.isArray(contsPool) || k === 'brandings') continue;
  const pool = houzs[k] ?? [];
  const have = new Map(pool.map((e) => [keyOf(e), e]));
  for (const e of contsPool) {
    const h = have.get(keyOf(e));
    if (!h) { pool.push(e); report.keptContsOnly.push(`${k}: ${keyOf(e)}`); continue; }
    if (priceOf(h) !== priceOf(e)) report.priceTakenFromHouzs.push(`${k} ${keyOf(e)}: ${priceOf(e)} -> ${priceOf(h)}`);
  }
  houzs[k] = pool;
}

// ---- fabrics: active rows only. Inactive Houzs rows are renamed or merged spellings kept so Houzs's old orders still
// resolve; Conts has none of those orders.
const lib = H.fabric_library.filter((r) => r.active);
const libIds = new Set(lib.map((r) => r.id));
const colours = H.fabric_colours.filter((r) => r.active && libIds.has(r.fabric_id));
const trackings = H.fabric_trackings.filter((r) => r.is_active);
const addons = H.special_addons;
const unpad = (c) => String(c ?? '').trim().toUpperCase().replace(/-0*(\d+)$/, '-$1');
const houzsByCode = new Map(trackings.map((r) => [unpad(r.fabric_code), r.fabric_code]));
const duplicateSeed = contsSeed.filter((r) => houzsByCode.has(unpad(r.supplier_code))).map((r) => ({ ...r, houzs: houzsByCode.get(unpad(r.supplier_code)) }));
const newCompartments = H.compartment_library; // existing Conts ids are kept by on conflict do nothing

const CO = `(select id from public.companies where code = 'HOUZS')`;
const chunk = (rows, n = 200) => Array.from({ length: Math.ceil(rows.length / n) }, (_, i) => rows.slice(i * n, i * n + n));

const out = [];
out.push(`-- REVERSAL: delete from scm.maintenance_config_history where id = 'mch-houzs-20261020'; delete from scm.special_addons_history where id = 'sah-houzs-20261020';
--   delete from scm.special_addons s where s.code in (<codes below>) and s.created_by is null and s.company_id = ${CO.replace(/\n/g, ' ')};
--   delete from scm.fabric_trackings / fabric_colours / fabric_library rows whose ids are listed below, when no document line names them.
-- Houzs Century's furniture product maintenance, copied for The Conts (owner, 20 Oct 2026; CLAUDE.md engine section):
-- bedframe and sofa variant pools, Products maintenance pools (bedframe / mattress sizes, sofa compartments,
-- supplier categories), special add-ons with their RM cost, the fabric library with its colours and the fabric
-- converter (scm.fabric_trackings: our fabric code <- supplier code). NOT copied: brandings, sofa combo pricing
-- (owner: Conts sets its own combos), SKUs and models, stock figures.
--
-- Source: Houzs company 1 in the masked snapshot of Houzs production restored on this machine on 16 Oct 2026
-- (newest maintenance edit in it: 9 Oct 2026; master config row ${H.config.id}, effective ${H.config.effective_from}).
-- Generated by scripts/houzs-product-maintenance.mjs; edit that script, not this file.
--
-- Merging with what Conts already has: a NEW master config row is appended (effective ${EFFECTIVE}); the history
-- screen keeps the old one. It starts from the Conts row in force, so keys this file does not set (brandings, a
-- later edit's extra keys) survive; the pools it sets are Houzs's pools plus any entry only Conts had. Table rows use
-- on conflict do nothing: a Conts row with the same key is kept as it is. Fabric stock figures (balance, usage,
-- outstanding PO) start at zero: they were Houzs's warehouse.
set local search_path = scm, public;
`);

out.push(`-- 1. Master maintenance config: one appended, effective-dated row.
insert into scm.maintenance_config_history (id, scope, config, effective_from, notes, company_id)
select 'mch-houzs-20261020', 'master',
  coalesce((select m.config from scm.maintenance_config_history m
             where m.company_id = c.id and m.scope = 'master' and m.effective_from <= date '${EFFECTIVE}'
             order by m.effective_from desc, m.created_at desc limit 1), '{}'::jsonb)
  || ${json(houzs)},
  date '${EFFECTIVE}',
  ${lit(`Houzs Century bedframe / sofa maintenance copied in (owner, 20 Oct 2026). Source: Houzs snapshot 16 Oct 2026, config ${H.config.id}. Houzs price taken where Conts had another, sen, Conts -> Houzs: ${report.priceTakenFromHouzs.join('; ')}.`)},
  c.id
from public.companies c
where c.code = 'HOUZS' and not exists (select 1 from scm.maintenance_config_history where id = 'mch-houzs-20261020');
`);

out.push(`-- 2. Special add-ons (Bedframe / Sofa Specials). cost_price_sen is the RM cost the Maintenance screen edits.
insert into scm.special_addons (code, label, so_description, categories, selling_price_sen, cost_price_sen, option_groups, active, sort_order, company_id)
select v.*, ${CO} from (values
${addons.map((a) => `  (${lit(a.code)}, ${lit(a.label)}, ${lit(a.so_description)}, ${arr(a.categories)}, ${a.selling_price_sen}, ${a.cost_price_sen}, ${json(a.option_groups)}, ${a.active}, ${a.sort_order})`).join(',\n')}
) v(code, label, so_description, categories, selling_price_sen, cost_price_sen, option_groups, active, sort_order)
on conflict (company_id, code) do nothing;

insert into scm.special_addons_history (id, addons, effective_from, notes, company_id)
select 'sah-houzs-20261020', ${json(addons.map((a) => ({ code: a.code, label: a.label, soDescription: a.so_description, categories: a.categories, sellingPriceSen: a.selling_price_sen, costPriceSen: a.cost_price_sen, optionGroups: a.option_groups, active: a.active, sortOrder: a.sort_order })))},
  date '${EFFECTIVE}', 'Houzs Century special add-ons copied in (owner, 20 Oct 2026).', ${CO}
where not exists (select 1 from scm.special_addons_history where id = 'sah-houzs-20261020');
`);

out.push(`-- 3. Sofa compartment catalogue rows Conts does not have yet (POS module art + default price).
insert into scm.compartment_library (id, comp_group, label, width_cm, depth_cm, cushions, default_price, art_filename, is_accessory, sort_order, company_id)
select v.id, v.comp_group::scm.comp_group, v.label, v.width_cm, v.depth_cm, v.cushions, v.default_price, v.art_filename, v.is_accessory, v.sort_order, ${CO} from (values
${newCompartments.map((r) => `  (${lit(r.id)}, ${lit(r.comp_group)}, ${lit(r.label)}, ${r.width_cm}, ${r.depth_cm}, ${r.cushions}, ${r.default_price}, ${lit(r.art_filename)}, ${r.is_accessory}, ${r.sort_order})`).join(',\n')}
) v(id, comp_group, label, width_cm, depth_cm, cushions, default_price, art_filename, is_accessory, sort_order)
on conflict (id) do nothing;
`);

out.push(`-- 4. Fabric tier add-on (selling delta per fabric tier). Houzs's is all zero; one row so the editor has it.
insert into scm.fabric_tier_addon_config (id, sofa_tier2_delta, sofa_tier3_delta, bedframe_tier2_delta, bedframe_tier3_delta, company_id)
select 1, ${H.fabric_tier_addon_config.map((r) => [r.sofa_tier2_delta, r.sofa_tier3_delta, r.bedframe_tier2_delta, r.bedframe_tier3_delta].join(', '))[0] ?? '0, 0, 0, 0'}, ${CO}
on conflict (id) do nothing;
`);

out.push(`-- 5. Fabric library (series): ${lib.length} active series.`);
for (const part of chunk(lib)) {
  out.push(`insert into scm.fabric_library (id, label, tier, default_surcharge, active, sort_order, sofa_tier, bedframe_tier, fabric_code, company_id)
select v.*, ${CO} from (values
${part.map((r) => `  (${lit(r.id)}, ${lit(r.label)}, ${lit(r.tier)}, ${r.default_surcharge}, ${r.active}, ${r.sort_order}, ${lit(r.sofa_tier)}, ${lit(r.bedframe_tier)}, ${lit(r.fabric_code)})`).join(',\n')}
) v(id, label, tier, default_surcharge, active, sort_order, sofa_tier, bedframe_tier, fabric_code)
on conflict (id) do nothing;
`);
}

out.push(`-- 6. Fabric colours: ${colours.length} active colours of those series (the picker on a sales order line).`);
for (const part of chunk(colours)) {
  out.push(`insert into scm.fabric_colours (fabric_id, colour_id, label, swatch_hex, active, sort_order, company_id)
select v.*, ${CO} from (values
${part.map((r) => `  (${lit(r.fabric_id)}, ${lit(r.colour_id)}, ${lit(r.label)}, ${lit(r.swatch_hex)}, ${r.active}, ${r.sort_order})`).join(',\n')}
) v(fabric_id, colour_id, label, swatch_hex, active, sort_order)
on conflict (fabric_id, colour_id) do nothing;
`);
}

out.push(`-- 7. Fabric converter / tracking: ${trackings.length} active fabric codes, ${trackings.filter((r) => r.supplier_code).length} with a supplier code.`);
for (const part of chunk(trackings)) {
  out.push(`insert into scm.fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, sofa_price_tier, bedframe_price_tier, price_sen, supplier, supplier_code, lead_time_days, series, is_active, company_id)
select v.id, v.fabric_code, v.fabric_description, v.fabric_category::scm.fabric_category, v.price_tier::scm.fabric_price_tier,
       v.sofa_price_tier::scm.fabric_price_tier, v.bedframe_price_tier::scm.fabric_price_tier, v.price_sen, v.supplier, v.supplier_code,
       v.lead_time_days, v.series, v.is_active, ${CO}
from (values
${part.map((r) => `  (${lit(r.id)}, ${lit(r.fabric_code)}, ${lit(r.fabric_description)}, ${lit(r.fabric_category)}, ${lit(r.price_tier)}, ${lit(r.sofa_price_tier)}, ${lit(r.bedframe_price_tier)}, ${r.price_sen}, ${lit(r.supplier)}, ${lit(r.supplier_code)}, ${r.lead_time_days}, ${lit(r.series)}, ${r.is_active})`).join(',\n')}
) v(id, fabric_code, fabric_description, fabric_category, price_tier, sofa_price_tier, bedframe_price_tier, price_sen, supplier, supplier_code, lead_time_days, series, is_active)
on conflict (company_id, id) do nothing;
`);
}

out.push(`-- 8. The same fabric twice: ${duplicateSeed.length} Conts seed rows whose supplier code is a Houzs fabric code. The Houzs row stays;
--    the seed row is deactivated, not deleted (lead, 20 Oct 2026), and only while it still names that supplier code and the
--    Houzs row is active, so a later edit by staff is never overridden. The other ${contsSeed.length - duplicateSeed.length} seed rows are left as they are.
update scm.fabric_trackings s set is_active = false
from (values
${duplicateSeed.map((r) => `  (${lit(r.id)}, ${lit(r.supplier_code)}, ${lit(r.houzs)})`).join(',\n')}
) d(seed_id, supplier_code, houzs_code)
where s.company_id = ${CO} and s.id = d.seed_id and s.supplier_code = d.supplier_code and s.is_active
  and exists (select 1 from scm.fabric_trackings h where h.company_id = s.company_id and h.fabric_code = d.houzs_code and h.is_active);
`);

writeFileSync(new URL('../migrations-pg/0129_engine_houzs_product_maintenance.sql', import.meta.url), out.join('\n'));
const counts = {
  configPools: Object.fromEntries(Object.entries(houzs).map(([k, v]) => [k, Array.isArray(v) ? v.length : Object.keys(v).length])),
  special_addons: addons.length, compartment_library: newCompartments.length, fabric_library: lib.length,
  fabric_colours: colours.length, fabric_trackings: trackings.length,
  converter_rows_with_supplier_code: trackings.filter((r) => r.supplier_code).length,
};
console.log(JSON.stringify({ counts, ...report, duplicateSeedDeactivated: duplicateSeed.map((r) => `${r.id} (${r.supplier_code}) -> ${r.houzs}`) }, null, 1));
