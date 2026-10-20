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
// --dry-run reads only and prints every row it would create, link or price. A real run executes the SQL parts that
// --emit-sql=<file> writes (scripts/catalog-first-import-sql.mjs; each part one transaction, safe to run again) and
// leaves a note of what it did in docs/catalog-import/runs/ (and one scm.app_config row per part).
//   node scripts/catalog-first-import.mjs --emit-sql=docs/catalog-import/sql/catalog-first-import.sql   no database needed
// RE-RUN: safe. Units, sub-categories, suppliers and SKUs are matched on their code and never changed once they exist;
// a supplier link is added only where that supplier has none for the SKU; a cost history row only where none exists for
// that supplier, SKU and date. An existing SKU keeps its cost and supplier link - the run lists them instead.
// Only the Conts engine database: production and staging are named below, plus localhost. Anything else is refused.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSqlParts, RUN_TAG } from './catalog-first-import-sql.mjs';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const DRY = process.argv.includes('--dry-run');
const PROMPT = process.argv.includes('--prompt');
const QUIET = process.argv.includes('--quiet');
const dataFile = arg('data') ?? join(root, 'docs/catalog-import/catalog-data.json');
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

const EMIT = arg('emit-sql');
if (EMIT) {
  // No database needed: write the import as SQL parts for whoever applies it (Supabase SQL editor / connector).
  const data = JSON.parse(readFileSync(dataFile, 'utf8'));
  const parts = buildSqlParts(data);
  const base = EMIT.replace(/\.sql$/i, '');
  const files = parts.length === 1 ? [`${base}.sql`] : parts.map((p) => `${base}.${p.name}`);
  mkdirSync(dirname(files[0]), { recursive: true });
  parts.forEach((p, i) => writeFileSync(files[i], p.sql));
  for (const [i, f] of files.entries()) console.log(`${f}  ${(Buffer.byteLength(parts[i].sql) / 1024).toFixed(0)} KB  ${parts[i].skus} SKUs`);
  console.log(`${parts.length} part(s), ${data.skus.length} SKUs. Run them in order; each is one transaction and safe to run again.`);
  process.exit(0);
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
    // --confirm-ref=<ref> stands in for typing it, for the one-off GitHub workflow (no terminal there).
    const typed = arg('confirm-ref') ?? await readLine(`\nThis writes to ${targetLabel}. Type the project ref to continue: `, false);
    if (typed !== ref) { console.error('That is not the project ref. Nothing was written.'); await sql.end(); process.exit(1); }
  }

  // The writes are the same SQL that --emit-sql writes (scripts/catalog-first-import-sql.mjs), one transaction per part.
  const parts = buildSqlParts(data);
  for (const p of parts) {
    await sql.unsafe(p.sql);
    console.log(`  applied ${p.name} (${p.skus} SKUs)`);
  }

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
  console.error(`Stopped: ${e.message}. Each part is one transaction: a part that stopped wrote nothing, parts before it stay, and running again continues safely.`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
