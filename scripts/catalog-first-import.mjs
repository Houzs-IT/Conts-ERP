// First import of the renovation catalog into the engine (schemas scm/public): units, sub-categories, suppliers,
// SKUs, each SKU's supplier link and its cost. Data: docs/catalog-import/catalog-data.json, built from the owner's
// supplier PDFs (docs/catalog-import/README.md says how, and catalog-review.xlsx is the same rows for review).
//
//   node scripts/catalog-first-import.mjs --dry-run                           target from DATABASE_URL in .dev.vars
//   node scripts/catalog-first-import.mjs --env-file=.dev.vars.production --dry-run
//   node scripts/catalog-first-import.mjs --prompt --dry-run                  ask for the connection string (hidden)
//   node scripts/catalog-first-import.mjs --prompt                            apply, after the project ref is typed back
//   DATABASE_URL=postgres://pos_app:local@127.0.0.1:55441/postgres node scripts/catalog-first-import.mjs   local PGlite
//
// --dry-run reads only and prints every row it would create, link or price. A real run writes in ONE transaction and
// leaves a note of what it did in docs/catalog-import/runs/.
// RE-RUN: safe. Units, sub-categories, suppliers and SKUs are matched on their code and never changed once they exist;
// a supplier link is added only where that supplier has none for the SKU; a cost history row only where none exists for
// that supplier, SKU and date. An existing SKU keeps its cost and supplier link - the run lists them instead.
// Only the Conts engine database: production and staging are named below, plus localhost. Anything else is refused.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const DRY = process.argv.includes('--dry-run');
const PROMPT = process.argv.includes('--prompt');
const QUIET = process.argv.includes('--quiet');
const dataFile = arg('data') ?? join(root, 'docs/catalog-import/catalog-data.json');
const RUN_TAG = 'catalog-first-import 2026-10';
// The Conts Supabase projects (CLAUDE.md). The engine shares them with Property OS (schemas scm/public).
const CONTS_REFS = { cweomoenhsjvsxfsmiiw: 'PRODUCTION', ecgyrmblqfxvbfjlqkdq: 'staging' };

async function readLine(question, hidden) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    stdout.write(question + '\n');
    let text = ''; for await (const c of stdin) text += c;
    return text.split(/\r?\n/)[0].trim();
  }
  if (!hidden) {
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: stdin, output: stdout });
    try { return (await rl.question(question)).trim(); } finally { rl.close(); }
  }
  return new Promise((resolve, reject) => {
    stdout.write(question); stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let v = '';
    const done = (fn) => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', on); stdout.write('\n'); fn(); };
    const on = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(() => resolve(v.trim()));
        if (ch === '\u0003') return done(() => reject(new Error('Cancelled. Nothing was written.')));
        if (ch === '\u007f' || ch === '\b') v = v.slice(0, -1); else if (ch >= ' ') v += ch;
      }
    };
    stdin.on('data', on);
  });
}

let url;
if (PROMPT) url = await readLine('Paste the database connection string (nothing will show), then press Enter: ', true);
else {
  const envFile = arg('env-file') ?? '.dev.vars';
  let vars = ''; try { vars = readFileSync(envFile, 'utf8'); } catch { /* none */ }
  url = process.env.DATABASE_URL ?? vars.match(/^DATABASE_URL="([^"]+)"/m)?.[1];
}
if (!url) { console.error('DATABASE_URL not set (environment, --env-file or --prompt). Nothing was written.'); process.exit(1); }
const ref = url.match(/postgres\.([a-z0-9]{20})\b/)?.[1] ?? url.match(/db\.([a-z0-9]{20})\.supabase\.co/)?.[1] ?? null;
const local = /@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
if (!local && !(ref && CONTS_REFS[ref])) {
  console.error(`Refused: ${ref ? `project ${ref}` : 'this host'} is not a Conts database (production, staging or localhost). Nothing was written.`);
  process.exit(1);
}
const targetLabel = local ? `local database (${url.replace(/\/\/[^@]*@/, '//***@')})` : `${CONTS_REFS[ref]} project ${ref}`;
console.log(`Target: ${targetLabel}${DRY ? '  (dry run - nothing is written)' : ''}`);

const data = JSON.parse(readFileSync(dataFile, 'utf8'));
const sen = (rm) => (rm == null ? null : Math.round(Number(rm) * 100));
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, connection: { application_name: 'catalog-first-import' } });

try {
  const companies = await sql`select id, code, name from public.companies where code = 'HOUZS'`;
  // Conts's own company row carries the internal code HOUZS (migration 0046); 0064 and 0085 select it the same way.
  if (companies.length !== 1) throw new Error(`expected one company with code HOUZS, found ${companies.length}`);
  const company = companies[0];
  console.log(`Company: id ${company.id}, ${company.name}`);

  const groups = new Set((await sql`select code from scm.product_category_groups`).map((r) => r.code));
  const subs = new Map((await sql`select group_code, code from scm.product_sub_categories`).map((r) => [r.code, r.group_code]));
  const uoms = new Set((await sql`select code from scm.product_uoms`).map((r) => r.code));
  const suppliers = await sql`select id, code, name from scm.suppliers where company_id = ${company.id}`;
  const products = await sql`select code, name, category::text, sub_category, uom, cost_price_sen from scm.mfg_products where company_id = ${company.id}`;
  const prodByCode = new Map(products.map((p) => [p.code, p]));
  const prodByName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]));

  // --- plan
  const newUoms = data.new_uoms.filter((u) => !uoms.has(u.code));
  const newSubs = data.new_sub_categories.filter((s) => !subs.has(s.code));
  for (const s of data.new_sub_categories) {
    if (subs.has(s.code) && subs.get(s.code) !== s.group) throw new Error(`sub-category ${s.code} exists under ${subs.get(s.code)}, not ${s.group}`);
  }
  const allSubs = new Map([...subs, ...data.new_sub_categories.map((s) => [s.code, s.group])]);
  const allUoms = new Set([...uoms, ...data.new_uoms.map((u) => u.code)]);
  for (const k of data.skus) {
    if (!groups.has(k.category)) throw new Error(`${k.code}: category ${k.category} does not exist`);
    if (allSubs.get(k.sub_category) !== k.category) throw new Error(`${k.code}: sub-category ${k.sub_category} is not under ${k.category}`);
    if (!allUoms.has(k.uom)) throw new Error(`${k.code}: unit ${k.uom} does not exist`);
  }
  const supplierPlan = Object.entries(data.suppliers).map(([key, s]) => {
    const byCode = suppliers.find((x) => x.code.toUpperCase() === s.code.toUpperCase());
    const byName = suppliers.find((x) => x.name.trim().toUpperCase() === s.name.toUpperCase());
    const hit = byCode ?? byName;
    return { key, ...s, existing: hit ?? null, matchedBy: byCode ? 'code' : byName ? 'name' : null };
  });
  const supKey = Object.fromEntries(supplierPlan.map((s) => [s.key, s]));
  const skuNew = data.skus.filter((k) => !prodByCode.has(k.code));
  const skuExisting = data.skus.filter((k) => prodByCode.has(k.code));
  const nameClash = skuNew.filter((k) => prodByName.has(k.name.trim().toLowerCase()));

  // Links and cost rows that already exist (only possible for suppliers that already exist).
  const existingSupIds = supplierPlan.filter((s) => s.existing).map((s) => s.existing.id);
  const codes = data.skus.map((k) => k.code);
  const links = existingSupIds.length
    ? await sql`select supplier_id, item_code from scm.supplier_material_bindings
                 where company_id = ${company.id} and material_kind = 'mfg_product' and item_code in ${sql(codes)} and supplier_id in ${sql(existingSupIds)}`
    : [];
  const mains = new Set((await sql`select item_code from scm.supplier_material_bindings
                                   where company_id = ${company.id} and material_kind = 'mfg_product' and is_main_supplier and item_code in ${sql(codes)}`).map((r) => r.item_code));
  const linked = new Set(links.map((l) => `${l.supplier_id}|${l.item_code}`));
  const linkPlan = data.skus.filter((k) => {
    const s = supKey[k.supplier];
    return !(s.existing && linked.has(`${s.existing.id}|${k.code}`));
  });
  const pricePlan = linkPlan.filter((k) => k.cost_rm != null);

  // --- report
  const line = (s) => { if (!QUIET) console.log(s); };
  console.log('\nPLAN');
  console.log(`  units to add:          ${newUoms.length}  ${newUoms.map((u) => u.code).join(', ')}`);
  console.log(`  sub-categories to add: ${newSubs.length}  ${newSubs.map((s) => `${s.group} > ${s.code}`).join(', ')}`);
  console.log(`  suppliers to create:   ${supplierPlan.filter((s) => !s.existing).length} of ${supplierPlan.length}`);
  for (const s of supplierPlan) {
    console.log(`    ${s.existing ? `EXISTS (matched by ${s.matchedBy}: ${s.existing.code} / ${s.existing.name}) - used as is` : 'CREATE'}  ${s.code}  ${s.name}`);
  }
  console.log(`  SKUs to create:        ${skuNew.length} of ${data.skus.length}  (${skuNew.filter((k) => k.cost_rm != null).length} with cost, ${skuNew.filter((k) => k.cost_rm == null).length} price needed)`);
  console.log(`  SKUs already there:    ${skuExisting.length}  (left unchanged)`);
  console.log(`  supplier links to add: ${linkPlan.length}  (main supplier on ${linkPlan.filter((k) => !mains.has(k.code)).length})`);
  console.log(`  cost history rows:     ${pricePlan.length}`);
  if (nameClash.length) {
    console.log(`\n  WARNING ${nameClash.length} new SKU(s) have the same name as an existing SKU with another code - check before applying:`);
    for (const k of nameClash) console.log(`    ${k.code}  "${k.name}"  vs existing ${prodByName.get(k.name.trim().toLowerCase()).code}`);
  }
  if (skuExisting.length) {
    console.log('\n  Existing SKU codes (skipped):');
    for (const k of skuExisting) console.log(`    ${k.code}  "${prodByCode.get(k.code).name}"`);
  }
  line('\n  SKU                       ACTION  CATEGORY > SUB             UOM    SUPPLIER        COST (RM)  NAME');
  for (const k of data.skus) {
    const act = prodByCode.has(k.code) ? 'skip' : 'create';
    const link = linkPlan.includes(k) ? (mains.has(k.code) ? '+link' : '+main') : '';
    line(`  ${k.code.padEnd(25)} ${act.padEnd(7)} ${`${k.category} > ${k.sub_category}`.padEnd(26)} ${k.uom.padEnd(6)} ${`${supKey[k.supplier].code} ${link}`.padEnd(15)} ${(k.cost_rm == null ? 'price needed' : k.cost_rm.toFixed(2)).padStart(12)}  ${k.name}`);
  }

  const note = {
    tag: RUN_TAG, at: new Date().toISOString(), target: targetLabel, dryRun: DRY, company: { id: Number(company.id), name: company.name }, data: dataFile.replace(root, '.'),
    counts: {
      unitsAdded: newUoms.length, subCategoriesAdded: newSubs.length, suppliersCreated: supplierPlan.filter((s) => !s.existing).length,
      skusCreated: skuNew.length, skusSkipped: skuExisting.length, linksAdded: linkPlan.length, costRows: pricePlan.length,
    },
    unitsAdded: newUoms.map((u) => u.code), subCategoriesAdded: newSubs.map((s) => s.code),
    suppliers: supplierPlan.map((s) => ({ code: s.code, name: s.name, action: s.existing ? `existing (${s.matchedBy})` : 'created' })),
    skusSkipped: skuExisting.map((k) => k.code), nameWarnings: nameClash.map((k) => k.code),
  };

  if (DRY) { console.log('\nDry run: nothing was written.'); await sql.end(); process.exit(0); }

  if (!local) {
    const typed = await readLine(`\nThis writes to ${targetLabel}. Type the project ref to continue: `, false);
    if (typed !== ref) { console.error('That is not the project ref. Nothing was written.'); await sql.end(); process.exit(1); }
  }

  const ids = {};
  await sql.begin(async (tx) => {
    for (const u of newUoms) {
      await tx`insert into scm.product_uoms (code, label, print_label, measure, builtin, sort_order)
               values (${u.code}, ${u.label}, ${u.print_label}, ${u.measure}, false, 200) on conflict (code) do nothing`;
    }
    for (const s of newSubs) {
      await tx`insert into scm.product_sub_categories (group_code, code, label, sort_order)
               values (${s.group}, ${s.code}, ${s.label}, 200) on conflict do nothing`;
    }
    for (const s of supplierPlan) {
      if (s.existing) { ids[s.key] = s.existing.id; continue; }
      const [row] = await tx`insert into scm.suppliers (company_id, code, name, registration_no, tin_number, address1, address2, phone, email, notes, status)
        values (${company.id}, ${s.code}, ${s.name}, ${s.registration_no ?? null}, ${s.tin_number ?? null}, ${s.address1 ?? null}, ${s.address2 ?? null},
                ${s.phone ?? null}, ${s.email ?? null}, ${`${s.note} Created by ${RUN_TAG} from ${s.src}.`}, 'ACTIVE')
        on conflict (company_id, code) do update set code = excluded.code returning id`;
      ids[s.key] = row.id;
    }
    // id like the API's ('mfg-' + 12 hex), derived from the code so a re-run computes the same one.
    const rows = skuNew.map((k) => ({
      id: `mfg-${createHash('sha256').update(`${company.id}|${k.code}`).digest('hex').slice(0, 12)}`,
      code: k.code, name: k.name, category: k.category, sub_category: k.sub_category, uom: k.uom, description: k.description || null,
      branding: data.suppliers[k.supplier].name, cost: sen(k.cost_rm) ?? 0,
      // Works and Service need no photo; the other groups are held Inactive by the photo rule (migration 0062) anyway.
      status: ['WORKS', 'SERVICE'].includes(k.category) ? 'ACTIVE' : 'INACTIVE',
    }));
    if (rows.length) {
      const j = JSON.stringify(rows);
      // Every SKU belongs to a model of its own (model_code = SKU code), as the API's create paths do.
      await tx`insert into scm.product_models (company_id, model_code, name, category, branding)
        select ${company.id}, x.code, x.name, x.category::scm.mfg_product_category, x.branding
          from jsonb_to_recordset(${j}::text::jsonb) as x(code text, name text, category text, branding text)
        on conflict (company_id, model_code, category) do nothing`;
      await tx`insert into scm.mfg_products (id, company_id, code, name, category, sub_category, uom, status, cost_price_sen, description, branding, model_id)
        select x.id, ${company.id}, x.code, x.name, x.category::scm.mfg_product_category, x.sub_category, x.uom, x.status::scm.mfg_product_status,
               x.cost, x.description, x.branding, m.id
          from jsonb_to_recordset(${j}::text::jsonb) as x(id text, code text, name text, category text, sub_category text, uom text, status text,
                                                    cost integer, description text, branding text)
          left join scm.product_models m on m.company_id = ${company.id} and m.model_code = x.code and m.category::text = x.category
        on conflict (company_id, code) do nothing`;
    }
    const links = linkPlan.map((k) => ({
      supplier_id: ids[k.supplier], item_code: k.code, material_name: k.name, supplier_sku: k.supplier_item_code || '',
      price: sen(k.cost_rm) ?? 0, valid_from: k.cost_rm != null ? k.price_date : null,
      notes: k.cost_rm != null
        ? `${RUN_TAG}: ${k.price_type}, ${k.price_source}`
        : `${RUN_TAG}: PRICE NEEDED - no price in ${k.item_source}`,
    }));
    if (links.length) {
      const j = JSON.stringify(links);
      // At most one main supplier per SKU (uq_smb_one_main): main only where the SKU has none yet.
      await tx`insert into scm.supplier_material_bindings
          (company_id, supplier_id, material_kind, item_code, material_name, supplier_sku, unit_price_sen, price_valid_from, is_main_supplier, notes)
        select ${company.id}, x.supplier_id, 'mfg_product', x.item_code, x.material_name, x.supplier_sku, x.price, x.valid_from,
               not exists (select 1 from scm.supplier_material_bindings b where b.company_id = ${company.id} and b.material_kind = 'mfg_product'
                                                                            and b.item_code = x.item_code and b.is_main_supplier),
               x.notes
          from jsonb_to_recordset(${j}::text::jsonb) as x(supplier_id uuid, item_code text, material_name text, supplier_sku text, price integer, valid_from date, notes text)
         where not exists (select 1 from scm.supplier_material_bindings b where b.company_id = ${company.id} and b.material_kind = 'mfg_product'
                                                                           and b.item_code = x.item_code and b.supplier_id = x.supplier_id)`;
      const priced = links.filter((l) => l.valid_from);
      if (priced.length) {
        await tx`insert into scm.supplier_binding_price_history
            (company_id, supplier_id, material_kind, item_code, unit_price_sen, is_main_supplier, effective_from, notes, created_by, applied_at)
          select ${company.id}, x.supplier_id, 'mfg_product', x.item_code, x.price, b.is_main_supplier, x.valid_from, x.notes, ${RUN_TAG}, now()
            from jsonb_to_recordset(${JSON.stringify(priced)}::text::jsonb) as x(supplier_id uuid, item_code text, price integer, valid_from date, notes text)
            join scm.supplier_material_bindings b on b.company_id = ${company.id} and b.material_kind = 'mfg_product'
                                                 and b.item_code = x.item_code and b.supplier_id = x.supplier_id
           where not exists (select 1 from scm.supplier_binding_price_history h where h.company_id = ${company.id} and h.supplier_id = x.supplier_id
                                                                                 and h.material_kind = 'mfg_product' and h.item_code = x.item_code
                                                                                 and h.effective_from = x.valid_from)`;
      }
    }
  });

  const [after] = await sql`select
      (select count(*)::int from scm.mfg_products p where p.company_id = ${company.id} and p.code in ${sql(codes)}) as skus,
      (select count(*)::int from scm.supplier_material_bindings b where b.company_id = ${company.id} and b.item_code in ${sql(codes)}) as links,
      (select count(*)::int from scm.supplier_material_bindings b where b.company_id = ${company.id} and b.item_code in ${sql(codes)} and b.unit_price_sen > 0) as priced_links,
      (select count(*)::int from scm.supplier_binding_price_history h where h.company_id = ${company.id} and h.item_code in ${sql(codes)}) as cost_rows`;
  note.after = after;
  console.log(`\nDone. In the database now for this catalog: ${after.skus} SKUs, ${after.links} supplier links (${after.priced_links} with a cost), ${after.cost_rows} cost history rows.`);
  const dir = join(root, 'docs/catalog-import/runs');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${note.at.replace(/[:.]/g, '-')}-${local ? 'local' : CONTS_REFS[ref].toLowerCase()}.json`);
  writeFileSync(file, JSON.stringify(note, null, 1));
  console.log(`Import note: ${file.replace(root + '\\', '').replace(root + '/', '')}`);
} catch (e) {
  console.error(`Stopped: ${e.message}. Nothing was written (the run is one transaction).`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
