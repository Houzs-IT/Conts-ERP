// Renovation sales documents (phase 2) end to end, on an in-memory Postgres (PGlite) built from migrations-pg.
// Runs the engine's own renovation libraries (engine/backend/src/scm/lib/renovation-*.ts) over postgres.js, the
// production driver, with the production options: quotation -> R2 -> accept -> convert -> PO split -> bill ->
// VO -> bill -> negative VO -> credit note, plus PO payment schedule, templates and every refusal on the way.
// No staging, no production, no secrets: the database lives and dies in this process.
//
// Run: node scripts/api-checks/renovation-sales.mjs
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.RENO_CHECK_PORT ?? 55437);

const out = await build({
  stdin: {
    contents: ['db', 'quotation', 'so', 'po-split', 'billing', 'vo', 'po-schedule', 'terms', 'validate', 'doc-lines', 'hooks']
      .map((f) => `export * from './engine/backend/src/scm/lib/renovation-${f}.ts';`).join('\n')
      + `\nexport * from './engine/backend/src/scm/shared/renovation-money.ts';`,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
});
const tmp = mkdtempSync(join(tmpdir(), 'reno-check-'));
writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
const M = await import(pathToFileURL(join(tmp, 'm.mjs')).href);

let fails = 0;
let passes = 0;
const check = (name, ok, detail = '') => {
  if (ok) passes++; else fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
};
const refusal = async (name, code, fn) => {
  try { await fn(); check(name, false, 'expected a refusal, got success'); }
  catch (e) { check(name, e instanceof M.RenoError && e.code === code, e instanceof M.RenoError ? `${e.status} ${e.code}` : String(e.message ?? e).slice(0, 200)); }
};
const RM = (n) => Math.round(n * 100);

/* ---------- database ---------- */
const { PGlite } = await import('@electric-sql/pglite');
const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
const pg = new PGlite({ extensions: { pg_trgm } });
for (const r of ['pos_app', 'service_role', 'anon', 'authenticated']) {
  await pg.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${r}') then create role ${r}; end if; end $$;`);
}
await pg.exec('create schema if not exists extensions');
const migrations = readdirSync(join(root, 'migrations-pg')).filter((f) => f.endsWith('.sql')).sort();
const failed = [];
for (const f of migrations) {
  try { await pg.exec(`begin;\n${readFileSync(join(root, 'migrations-pg', f), 'utf8')}\ncommit;`); }
  catch (e) { await pg.exec('rollback;').catch(() => {}); failed.push(`${f}: ${String(e.message).slice(0, 120)}`); }
}
check(`all ${migrations.length} migrations apply on PGlite`, failed.length === 0, failed.join(' | '));
// Phase 1 adds the WORKS category; stand in for it so the supply-by-owner labour rule can be exercised.
await pg.exec(`alter type scm.mfg_product_category add value if not exists 'WORKS'`);

const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
const { default: postgres } = await import('postgres');
const server = new PGLiteSocketServer({ db: pg, port: PORT });
await server.start();
// engine/backend/src/db/pg.ts options: no prepared statements, no type fetch, bigint as number.
const sql = postgres(`postgres://postgres@127.0.0.1:${PORT}/postgres`, {
  max: 1, prepare: false, fetch_types: false,
  types: { bigint: { to: 20, from: [20], parse: (x) => Number(x), serialize: (x) => String(x) } },
});
const db = M.renoDbOf(sql);
const tx = (fn) => M.inRenoTx(sql, (d) => fn(d));

/* ---------- seed ---------- */
const STAFF = '00000000-0000-4000-8000-000000000001';
const actor = { name: 'Check Runner', staffId: STAFF, companyId: 1, docPrefix: 'HC-' };
const [proj] = await db.q(`insert into public.projects (name, stage) values ('TEST AVA B31-09', 'design') returning id`);
const [proj2] = await db.q(`insert into public.projects (name, stage) values ('TEST vector 100k', 'design') returning id`);
const [proj3] = await db.q(`insert into public.projects (name, stage) values ('TEST vector credit', 'design') returning id`);
const [supA] = await db.q(`insert into scm.suppliers (code, name) values ('TS-CARP', 'TEST Carpentry Factory') returning id`);
const [supB] = await db.q(`insert into scm.suppliers (code, name) values ('TS-ELEC', 'TEST Electrician') returning id`);
for (const [code, name, cat] of [
  ['RN-WARDROBE', 'Wardrobe (generic)', 'ACCESSORY'], ['RN-ADDON', 'Carpentry add-on', 'ACCESSORY'], ['RN-ELECTRICAL', 'Electrical works', 'WORKS'],
  ['RN-LIGHT', 'Light fitting', 'ACCESSORY'], ['RN-CURTAIN', 'Curtain', 'CARPET'], ['RN-SERVICE', 'Service', 'SERVICE'], ['RN-BIG', 'Lump contract line', 'SERVICE'],
]) {
  // phase 1 (0061): a WORKS product must name its trade; 0064 already seeds RN-ELECTRICAL
  await db.q(`insert into scm.mfg_products (id, code, name, category, sub_category, company_id) values ($1, $2, $3, $4::scm.mfg_product_category, $5, 1) on conflict (id) do nothing`,
    [`mfg-${code.toLowerCase()}`, code, name, cat, cat === 'WORKS' ? 'ELECTRICAL' : null]);
}
await db.q(`insert into scm.acc_item_group_accounts (company_id, group_code, purchase_account, sales_account, sales_return_account, purchase_return_account)
            values (1, 'RENOVATION', '600-0000', '500-0000', '510-0000', '610-0000')`);
const [brand] = await db.q(`select id from public.project_brands where name = 'Dream Crafter'`);
check('Dream Crafter letterhead seeded', Boolean(brand));
const [prof] = await db.q(`select bank_line, array_length(terms_lines, 1) as n from scm.reno_brand_profiles where brand_id = $1`, [brand.id]);
check('letterhead has bank line and 4 terms lines', prof?.bank_line?.includes('HLBB') && Number(prof.n) === 4);
const brands = await M.listBrandProfiles(db, 1);
const dc = brands.find((b) => b.name === 'Dream Crafter');
check('brand profile lines come back as arrays (the production driver fetches no array types)', Array.isArray(dc?.companyLines) && dc.companyLines.length === 4 && Array.isArray(dc.termsLines) && dc.termsLines.length === 4);
const terms = await M.listTermTemplates(db, 1);
check('3 payment-term templates seeded (2 customer, 1 PO)', terms.length === 3 && terms.filter((t) => t.kind === 'PO').length === 1,
  terms.map((t) => `${t.kind}:${t.name}`).join(', '));
const def = terms.find((t) => t.kind === 'CUSTOMER' && t.isDefault);
check('default customer terms are 30/30/35/5 with stage + trigger', def && def.lines.map((l) => l.pctBp).join('/') === '3000/3000/3500/500'
  && def.lines[0].trigger === 'so_confirmed' && def.lines[3].stageCode === 'handover');

/* ---------- quotation ---------- */
const N = (x) => { const r = M.normaliseSections(x); if (!r.ok) throw new Error(r.problems.join('; ')); return r.value; };
const sectionsA = () => N([
  { heading: 'CARPENTRY WORK', bandColor: '#4a90d9', lines: [
    { kind: 'ITEM', itemCode: 'RN-WARDROBE', description: 'SWING DOOR WARDROBE (1 EP) @ MASTER', room: 'MASTER', qty: 1, unitPriceSen: RM(5323), supplierId: supA.id, unitCostSen: RM(3000) },
    { kind: 'DETAIL', description: 'W : 8.2 FT X D : 2 FT X H : 9.5 FT' },
    { kind: 'CHILD', itemCode: 'RN-ADDON', description: 'SOFT CLOSE DRAWER', qty: 4, unitPriceSen: RM(90), supplierId: supA.id, unitCostSen: RM(40) },
  ] },
  { heading: 'LIGHTING & FAN (INSTALL ONLY, SUPPLY BY OWNER)', lines: [
    { kind: 'ITEM', itemCode: 'RN-ELECTRICAL', description: 'CEILING LIGHT INSTALL', qty: 27, unitPriceSen: RM(20), supplyByOwner: true, supplierId: supB.id, unitCostSen: RM(10) },
    { kind: 'ITEM', itemCode: 'RN-LIGHT', description: 'RECESSED MAGNETIC TRACK', qty: 1, measure: '20', measureUom: 'FT', unitPriceSen: RM(15), supplyByOwner: true, supplierId: supB.id, unitCostSen: RM(8) },
    { kind: 'ITEM', itemCode: 'RN-ELECTRICAL', description: 'LED STRIP 42.6FT', qty: 1, measure: '42.6', measureUom: 'FT', unitPriceSen: RM(35), amountOverrideSen: RM(1065), supplierId: supB.id, unitCostSen: RM(15) },
  ] },
  { heading: 'CURTAIN WORK (SG PLEAT DOUBLE LAYER) 35.9 FT', lumpSumSen: RM(3231), lines: [
    { kind: 'ITEM', itemCode: 'RN-CURTAIN', description: 'CURTAIN', qty: 1, supplierId: supA.id, unitCostSen: RM(1500) },
    { kind: 'DETAIL', description: 'MASTER 10 FT' },
  ] },
  { heading: 'ADD ON', lines: [
    { kind: 'ITEM', itemCode: 'RN-SERVICE', description: 'DEFECT CHECK (WAIVED)', qty: 1, unitPriceSen: RM(-550), highlight: 'PINK' },
    { kind: 'ITEM', itemCode: 'RN-SERVICE', description: 'FOC DESIGN', qty: 1, unitPriceSen: RM(800), isFoc: true },
    { kind: 'ITEM', itemCode: 'RN-ADDON', description: 'NO SUPPLIER YET', qty: 1, unitPriceSen: RM(100), unitCostSen: RM(50) },
  ] },
]);
// Expected: 5323 + 360 + 540 + 300 + 1065 + 3231 - 550 + 0 + 100 = 10369, document discount 69 -> 10300.
const qa = await tx((d) => M.createQuotation(d, actor, {
  projectId: proj.id, brandId: brand.id, sections: sectionsA(),
  header: { customerName: 'MR FOO', attention: 'MR FOO', building: 'AVA', unitNo: 'B31-09', preparedBy: 'MK', docDiscountSen: RM(69), docDiscountLabel: 'SHOWROOM DISCOUNT' },
}));
check('quotation numbered QT-YYMM-NNN', /^QT-\d{4}-\d{3}$/.test(qa.quoteNo), qa.quoteNo);
let q = await M.getQuotation(db, qa.id, 1);
check('quotation totals: final = lines - document discount', q.revision.totals.finalSen === RM(10300), `${q.revision.totals.finalSen}`);
check('override flagged on screen', q.revision.totals.overriddenLines === 1);
check('child line points at its item', q.revision.sections[0].lines[2].parentId === q.revision.sections[0].lines[0].id);
check('default instalments copied (4)', q.revision.instalments.length === 4);
check('measure reads back as 42.6', q.revision.sections[1].lines[2].measure === '42.6');
await refusal('stale version refused', 'stale_version', () => tx((d) => M.saveRevision(d, actor, qa.id, { version: q.quotation.version + 5, header: { preparedBy: 'X' } })));
const saved = await tx((d) => M.saveRevision(d, actor, qa.id, { version: q.quotation.version, header: { preparedBy: 'MK2' } }));
check('save bumps version', saved.version === q.quotation.version + 1);
let st = await tx((d) => M.setQuotationStatus(d, actor, qa.id, 'SENT', saved.version));
await refusal('sent quotation not editable', 'not_editable', () => tx((d) => M.saveRevision(d, actor, qa.id, { version: st.version, header: { preparedBy: 'X' } })));
const r2 = await tx((d) => M.newRevision(d, actor, qa.id, st.version));
check('revision 2 numbered -R2', r2.docNo === `${qa.quoteNo}-R2`, r2.docNo);
q = await M.getQuotation(db, qa.id, 1, 1);
check('R1 frozen and read-only', Boolean(q.revision.frozenAt) && q.editable === false);
q = await M.getQuotation(db, qa.id, 1);
check('R2 is a draft copy with the same total', q.quotation.status === 'DRAFT' && q.revision.totals.finalSen === RM(10300) && q.editable);
st = await tx((d) => M.setQuotationStatus(d, actor, qa.id, 'SENT', q.quotation.version));
await refusal('cannot jump SENT -> ... wrong transition', 'bad_transition', () => tx((d) => M.setQuotationStatus(d, actor, qa.id, 'SENT', st.version)));
st = await tx((d) => M.setQuotationStatus(d, actor, qa.id, 'ACCEPTED', st.version));
const list = await M.listQuotations(db, 1, { projectId: proj.id });
check('list shows the quotation with its total', list.length === 1 && list[0].totalSen === RM(10300) && list[0].docNo === r2.docNo);

/* ---------- template ---------- */
const tpl = await tx((d) => M.createTemplate(d, actor, { name: 'TEST Skyline Type A', fromRevisionId: q.revision.id }));
const tq = await tx((d) => M.createQuotation(d, actor, { projectId: proj2.id, templateId: tpl.id, header: { customerName: 'TEMPLATE CHECK' } }));
const tqv = await M.getQuotation(db, tq.id, 1);
check('quotation from package template carries its lines and discount', tqv.revision.totals.finalSen === RM(10300), `${tqv.revision.totals.finalSen}`);
await refusal('template names are unique', 'name_taken', () => tx((d) => M.createTemplate(d, actor, { name: 'test skyline type a' })));

/* ---------- convert ---------- */
await refusal('draft quotation cannot convert', 'not_accepted', () => tx((d) => M.convertQuotationToSo(d, actor, tq.id, { version: tqv.quotation.version })));
const conv = await tx((d) => M.convertQuotationToSo(d, actor, qa.id, { version: st.version }));
check('SO numbered with the company prefix', /^HC-SO-\d{4}-\d{3}$/.test(conv.docNo), conv.docNo);
check('contract sum = accepted quotation total', conv.contractSen === RM(10300));
const items = await db.q(`select item_code, qty, unit_price_sen, discount_sen, total_sen, item_group, description2 from scm.mfg_sales_order_items where doc_no = $1 order by line_no`, [conv.docNo]);
check('every SO row keeps total = qty x price - discount', items.every((i) => i.qty * i.unit_price_sen - i.discount_sen === i.total_sen));
check('SO rows: 9 priced lines + 1 lump-sum row + 1 discount row', items.length === 11, `${items.length}`);
check('lump-sum row and discount row present', items.some((i) => i.item_code === 'RENO-ADJUST' && i.total_sen === RM(3231)) && items.some((i) => i.item_code === 'RENO-DISCOUNT' && i.total_sen === RM(-69)));
check('measured row mirrored as qty 1 with description', items.some((i) => i.description2 === '20 FT @ RM15.00' && i.total_sen === RM(300)));
check('all rows in item group RENOVATION', items.every((i) => i.item_group === 'RENOVATION'));
const [soh] = await db.q(`select status::text, so_kind, local_total_sen, project_id from scm.mfg_sales_orders where doc_no = $1`, [conv.docNo]);
check('SO header: renovation kind, RENO_CONFIRMED, total', soh.status === 'RENO_CONFIRMED' && soh.so_kind === 'RENOVATION' && soh.local_total_sen === RM(10300));
let contract = await M.readContract(db, conv.docNo, 1);
check('contract structure copied with so_item_id on priced lines', contract.sections.flatMap((s) => s.lines).filter((l) => l.kind === 'ITEM' || l.kind === 'CHILD').every((l) => l.soItemId));
check('contract totals: original = revised', contract.totals.originalContractSen === RM(10300) && contract.totals.revisedContractSen === RM(10300));
await refusal('converted quotation cannot convert again', 'already_converted', () => tx((d) => M.convertQuotationToSo(d, actor, qa.id, { version: st.version + 1 })));
const qlocked = await M.getQuotation(db, qa.id, 1);
check('quotation locked after convert', Boolean(qlocked.quotation.lockedAt) && qlocked.quotation.convertedSoDocNo === conv.docNo);
const other = await tx((d) => M.createQuotation(d, actor, { projectId: proj.id, sections: N([{ heading: 'X', lines: [{ kind: 'ITEM', itemCode: 'RN-SERVICE', unitPriceSen: 100 }] }]) }));
let ov = await M.getQuotation(db, other.id, 1);
let os = await tx((d) => M.setQuotationStatus(d, actor, other.id, 'SENT', ov.quotation.version));
os = await tx((d) => M.setQuotationStatus(d, actor, other.id, 'ACCEPTED', os.version));
await refusal('one live renovation SO per project', 'project_has_contract', () => tx((d) => M.convertQuotationToSo(d, actor, other.id, { version: os.version })));
await refusal('lines without a product block convert', 'lines_without_sku', async () => {
  const x = await tx((d) => M.createQuotation(d, actor, { projectId: proj3.id, sections: N([{ heading: 'X', lines: [{ kind: 'ITEM', description: 'free text', unitPriceSen: 100 }] }]) }));
  const xv = await M.getQuotation(db, x.id, 1);
  let xs = await tx((d) => M.setQuotationStatus(d, actor, x.id, 'SENT', xv.quotation.version));
  xs = await tx((d) => M.setQuotationStatus(d, actor, x.id, 'ACCEPTED', xs.version));
  await tx((d) => M.convertQuotationToSo(d, actor, x.id, { version: xs.version }));
});

/* ---------- SO -> PO ---------- */
let pv = await M.previewPoSplit(db, conv.docNo, 1);
check('PO split groups by supplier (2 suppliers)', pv.groups.length === 2, pv.groups.map((g) => `${g.supplierName}:${g.lines.length}`).join(', '));
check('supply-by-owner goods skipped, labour kept', pv.skipped.some((l) => l.description === 'RECESSED MAGNETIC TRACK') && pv.groups.some((g) => g.lines.some((l) => l.description === 'CEILING LIGHT INSTALL')));
check('line with cost and no supplier blocks', pv.blocked.length === 1 && pv.blocked[0].description === 'NO SUPPLIER YET');
check('waived / FOC lines with no supplier and no cost are in-house', pv.skipped.some((l) => l.description === 'DEFECT CHECK (WAIVED)'));
check('measured line costed measure x unit cost (42.6 x 15 = 639)', pv.groups.flatMap((g) => g.lines).some((l) => l.description === 'LED STRIP 42.6FT' && l.amountSen === RM(639)));
await refusal('raise refuses while a line has no supplier', 'lines_without_supplier', () => tx((d) => M.raisePos(d, actor, conv.docNo, {})));
const blockedLine = contract.sections.flatMap((s) => s.lines).find((l) => l.description === 'NO SUPPLIER YET');
await tx((d) => M.patchContract(d, actor, conv.docNo, { version: contract.header.version, lines: [{ id: blockedLine.id, supplierId: supA.id }] }));
const raised = await tx((d) => M.raisePos(d, actor, conv.docNo, {}));
check('one PO per supplier', raised.created.length === 2 && raised.created.every((p) => /^HC-PO-\d{4}-\d{3}$/.test(p.poNumber)), raised.created.map((p) => p.poNumber).join(', '));
const poLines = await db.q(`select pi.so_item_id, pi.qty, pi.unit_price_sen, pi.line_total_sen from scm.purchase_order_items pi
  join scm.purchase_orders po on po.id = pi.purchase_order_id where po.notes = $1`, [`Renovation contract ${conv.docNo}`]);
check('every PO line keeps so_item_id', poLines.length > 0 && poLines.every((l) => l.so_item_id));
check('PO line totals = qty x cost', poLines.every((l) => l.qty * l.unit_price_sen === l.line_total_sen));
const [picked] = await db.q(`select count(*)::int as n from scm.mfg_sales_order_items where doc_no = $1 and po_qty_picked > 0`, [conv.docNo]);
check('SO lines show as picked onto POs', Number(picked.n) === poLines.length, `${picked.n} vs ${poLines.length}`);
await refusal('nothing left to order', 'nothing_to_order', () => tx((d) => M.raisePos(d, actor, conv.docNo, {})));
await refusal('supplier cannot change once on a PO', 'line_on_po', async () => {
  contract = await M.readContract(db, conv.docNo, 1);
  await tx((d) => M.patchContract(d, actor, conv.docNo, { version: contract.header.version, lines: [{ id: blockedLine.id, supplierId: supB.id }] }));
});

/* ---------- PO payment schedule ---------- */
const poA = raised.created.find((p) => p.supplierId === supA.id);
let sch = await M.readPoSchedule(db, poA.id, 1);
check('default PO schedule 30/65/5 adds to the PO total', sch.instalments.map((i) => i.pctBp).join('/') === '3000/6500/500' && sch.totals.scheduledSen === poA.totalSen);
check('mobilise payable, completion and retention not yet', sch.instalments[0].payable && !sch.instalments[1].payable && !sch.instalments[2].payable);
check('project not handed over (phase 3 project_handovers) keeps retention closed', sch.handover === 'not_handed_over' && !sch.instalments[2].payable, sch.handover);
await refusal('completion not payable before receipt', 'not_payable', () => tx((d) => M.recordPoPayment(d, actor, sch.instalments[1].id, { amountSen: 100 })));
await refusal('cannot overpay an instalment', 'over_payment', () => tx((d) => M.recordPoPayment(d, actor, sch.instalments[0].id, { amountSen: sch.instalments[0].amountSen + 1 })));
await tx((d) => M.recordPoPayment(d, actor, sch.instalments[0].id, { amountSen: sch.instalments[0].amountSen, note: 'mobilise' }));
await refusal('schedule frozen once paid', 'schedule_has_payments', () => tx((d) => M.savePoSchedule(d, actor, poA.id, [{ seq: 1, label: 'All', pctBp: 10000, payableOn: 'MANUAL' }])));
await db.q(`update scm.purchase_order_items set received_qty = qty where purchase_order_id = $1`, [poA.id]);
sch = await M.readPoSchedule(db, poA.id, 1);
check('completion payable once fully received', sch.instalments[1].payable && sch.instalments[0].outstandingSen === 0);
await db.q(`insert into public.project_handovers (project_id, customer_signer_name, customer_signature_r2_key) values ($1, 'MR FOO', 'renovation/check/sig.png')`, [proj.id]);
sch = await M.readPoSchedule(db, poA.id, 1);
check('handover signed on the project makes retention payable', sch.handover === 'handed_over' && sch.instalments[2].payable, sch.handover);
await tx((d) => M.releasePoInstalment(d, actor, sch.instalments[2].id, 'Handover signed, snag list closed'));
sch = await M.readPoSchedule(db, poA.id, 1);
check('retention payable after manual release', sch.instalments[2].payable);

/* ---------- billing on the AVA contract ---------- */
let bv = await M.billingView(db, conv.docNo, 1);
check('billing view: 4 instalments, next is 1', bv.instalments.length === 4 && bv.nextSeq === 1);
check('instalment 1 = 30% of 10,300 = 3,090', bv.instalments[0].amountSen === RM(3090));
await refusal('stale amount refused', 'stale_amount', () => tx((d) => M.billInstalment(d, actor, conv.docNo, bv.instalments[0].id, { expectedAmountSen: 1 })));
await refusal('instalments billed in order', 'not_next', () => tx((d) => M.billInstalment(d, actor, conv.docNo, bv.instalments[2].id, { expectedAmountSen: bv.instalments[2].amountSen })));
const b1 = await tx((d) => M.billInstalment(d, actor, conv.docNo, bv.instalments[0].id, { expectedAmountSen: RM(3090), invoiceDate: '2026-10-09' }));
check('instalment 1 raised a sales invoice', b1.kind === 'INVOICE' && /^HC-SI-2610-\d{3}$/.test(b1.invoiceNumber), b1.invoiceNumber);
const [si] = await db.q(`select si.total_sen, si.so_doc_no, si.status::text as status, i.item_code, i.item_group from scm.sales_invoices si join scm.sales_invoice_items i on i.sales_invoice_id = si.id where si.invoice_number = $1`, [b1.invoiceNumber]);
check('invoice: SO-linked, SENT, one RENO-PROGRESS line in RENOVATION', si.so_doc_no === conv.docNo && si.status === 'SENT' && si.item_code === 'RENO-PROGRESS' && si.item_group === 'RENOVATION' && si.total_sen === RM(3090));
await refusal('already billed', 'already_billed', () => tx((d) => M.billInstalment(d, actor, conv.docNo, bv.instalments[0].id, { expectedAmountSen: RM(3090) })));
await db.q(`update scm.sales_invoices set paid_sen = $2 where invoice_number = $1`, [b1.invoiceNumber, RM(1000)]);
bv = await M.billingView(db, conv.docNo, 1);
check('billing view shows billed and received', bv.billedSen === RM(3090) && bv.receivedSen === RM(1000) && bv.nextSeq === 2);

/* ---------- VO on the AVA contract: add + full omit + partial omit, PO flags ---------- */
contract = await M.readContract(db, conv.docNo, 1);
const wardrobe = contract.sections[0].lines[0];
const drawer = contract.sections[0].lines[2];
const vo = await tx((d) => M.createVo(d, actor, conv.docNo, { title: 'Add skim, drop wardrobe' }));
check('VO numbered VO-<SO>-01', vo.voNo === `VO-${conv.docNo}-01`, vo.voNo);
let vov = await M.readVo(db, vo.id, 1);
const voSections = M.normaliseSections([{ heading: 'ADD ON', lines: [
  { kind: 'ITEM', itemCode: 'RN-SERVICE', description: 'WALL SKIM', qty: 1, unitPriceSen: RM(300) },
  { kind: 'ITEM', voChange: 'OMIT', omitTargetLineId: wardrobe.id },
  { kind: 'ITEM', voChange: 'OMIT', omitTargetLineId: drawer.id, omitQty: 1 },
] }], 'vo');
check('VO body validates', voSections.ok, voSections.ok ? '' : voSections.problems.join('; '));
const savedVo = await tx((d) => M.saveVo(d, actor, vo.id, { version: vov.version, sections: voSections.value }));
check('VO net = +300 - 5323 - 90', savedVo.netSen === RM(300 - 5323 - 90), `${savedVo.netSen}`);
await refusal('omitting a line twice refused', 'omit_twice', () => tx((d) => M.saveVo(d, actor, vo.id, { version: savedVo.version, sections: M.normaliseSections([{ heading: 'x', lines: [
  { kind: 'ITEM', voChange: 'OMIT', omitTargetLineId: wardrobe.id }, { kind: 'ITEM', voChange: 'OMIT', omitTargetLineId: wardrobe.id }] }], 'vo').value })));
vov = await M.readVo(db, vo.id, 1);
const sentVo = await tx((d) => M.setVoStatus(d, actor, vo.id, 'SENT', vov.version));
const applied = await tx((d) => M.applyVo(d, actor, vo.id, { version: sentVo.version, signedName: 'MR FOO' }));
check('VO applied: revised contract = 10,300 - 5,113', applied.revisedContractSen === RM(10300 - 5113), `${applied.revisedContractSen}`);
check('omitted lines that were on POs are flagged (2)', applied.flags === 2, `${applied.flags}`);
const flags = await M.listPoFlags(db, conv.docNo);
check('flags: one CANCEL, one AMEND to qty 3', flags.some((f) => f.action === 'CANCEL') && flags.some((f) => f.action === 'AMEND' && f.newQty === 3));
const [amd] = await db.q(`select status::text as status, resolution, (select count(*)::int from scm.so_amendment_lines l where l.amendment_id = a.id) as n from scm.so_amendments a where amendment_no = $1`, [vo.voNo]);
check('engine amendment recorded (SENT, RENOVATION_VO, 3 lines)', amd?.status === 'SENT' && amd.resolution === 'RENOVATION_VO' && Number(amd.n) === 3, JSON.stringify(amd));
const [rev] = await db.q(`select count(*)::int as n from scm.so_revisions where so_doc_no = $1`, [conv.docNo]);
check('SO snapshot frozen before the change', Number(rev.n) === 1);
contract = await M.readContract(db, conv.docNo, 1);
check('contract shows the VO section and the omitted wardrobe', contract.sections.some((s) => s.voId === vo.id) && contract.sections[0].lines[0].omittedByVoId === vo.id);
check('contract VO total', contract.totals.voTotalSen === RM(-5113));
const [drawerItem] = await db.q(`select qty, total_sen from scm.mfg_sales_order_items where id = $1`, [drawer.soItemId]);
check('partly omitted line repriced (3 x 90)', drawerItem.qty === 3 && drawerItem.total_sen === RM(270));
const appliedVo = await M.readVo(db, vo.id, 1);
check('approved VO keeps its net and amendment link', appliedVo.status === 'APPROVED' && appliedVo.totals.netSen === RM(-5113) && Boolean(appliedVo.amendmentId));
await refusal('approved VO cannot be edited', 'not_editable', () => tx((d) => M.saveVo(d, actor, vo.id, { version: appliedVo.version, sections: [] })));
bv = await M.billingView(db, conv.docNo, 1);
check('next instalment catches up: 60% x 5,187 - 3,090 = 22.20', bv.instalments[1].amountSen === Math.round(RM(5187) * 0.6) - RM(3090), `${bv.instalments[1].amountSen}`);

/* ---------- the spec's vector: 100k on 15/50/30/5, VO +10k after #2 ---------- */
const plan = [{ seq: 1, label: '1ST', pctBp: 1500 }, { seq: 2, label: '2ND', pctBp: 5000 }, { seq: 3, label: '3RD', pctBp: 3000 }, { seq: 4, label: '4TH', pctBp: 500 }];
const inst = (rows) => { const r = M.normaliseInstalments(rows); if (!r.ok) throw new Error(r.problems.join('; ')); return r.value; };
async function contractOf(projectId, lines) {
  const x = await tx((d) => M.createQuotation(d, actor, { projectId, sections: N([{ heading: 'WORKS', lines }]), instalments: inst(plan), header: { customerName: 'VECTOR' } }));
  const xv = await M.getQuotation(db, x.id, 1);
  let xs = await tx((d) => M.setQuotationStatus(d, actor, x.id, 'SENT', xv.quotation.version));
  xs = await tx((d) => M.setQuotationStatus(d, actor, x.id, 'ACCEPTED', xs.version));
  return (await tx((d) => M.convertQuotationToSo(d, actor, x.id, { version: xs.version }))).docNo;
}
async function billNext(docNo, opts = {}) {
  const v = await M.billingView(db, docNo, 1);
  const n = v.instalments.find((i) => i.isNext);
  return tx((d) => M.billInstalment(d, actor, docNo, n.id, { expectedAmountSen: n.amountSen, ...opts }));
}
async function approveVo(docNo, sections) {
  const v = await tx((d) => M.createVo(d, actor, docNo, {}));
  const r = await M.readVo(db, v.id, 1);
  const s = await tx((d) => M.saveVo(d, actor, v.id, { version: r.version, sections: M.normaliseSections(sections, 'vo').value }));
  return tx((d) => M.applyVo(d, actor, v.id, { version: s.version }));
}
const vec = await contractOf(proj2.id, [{ kind: 'ITEM', itemCode: 'RN-BIG', qty: 1, unitPriceSen: RM(100000) }]);
const v1 = await billNext(vec);
const v2 = await billNext(vec);
check('vector #1 = 15,000 and #2 = 50,000', v1.amountSen === RM(15000) && v2.amountSen === RM(50000), `${v1.amountSen} ${v2.amountSen}`);
await approveVo(vec, [{ heading: 'VO', lines: [{ kind: 'ITEM', itemCode: 'RN-SERVICE', qty: 1, unitPriceSen: RM(10000) }] }]);
const v3 = await billNext(vec);
const v4 = await billNext(vec);
check('vector: VO +10k after #2 -> #3 = 39,500', v3.amountSen === RM(39500), `${v3.amountSen}`);
check('vector: #4 = 5,500', v4.amountSen === RM(5500), `${v4.amountSen}`);
const vbv = await M.billingView(db, vec, 1);
check('vector: billed = revised contract 110,000', vbv.billedSen === RM(110000) && vbv.revisedContractSen === RM(110000) && vbv.nextSeq === null);

/* ---------- negative instalment -> credit note ---------- */
const neg = await contractOf(proj3.id, [
  { kind: 'ITEM', itemCode: 'RN-BIG', qty: 1, unitPriceSen: RM(80000) },
  { kind: 'ITEM', itemCode: 'RN-SERVICE', description: 'OPTIONAL WORKS', qty: 1, unitPriceSen: RM(20000) },
]);
for (let i = 0; i < 3; i++) await billNext(neg);
const negContract = await M.readContract(db, neg, 1);
const optional = negContract.sections[0].lines.find((l) => l.description === 'OPTIONAL WORKS');
await approveVo(neg, [{ heading: 'VO', lines: [{ kind: 'ITEM', voChange: 'OMIT', omitTargetLineId: optional.id }] }]);
const nbv = await M.billingView(db, neg, 1);
check('VO -20k after #3 -> #4 = -15,000', nbv.instalments[3].amountSen === RM(-15000), `${nbv.instalments[3].amountSen}`);
await refusal('negative instalment needs confirmation', 'credit_note_needs_confirm', () => billNext(neg));
const cn = await billNext(neg, { confirmCreditNote: true });
check('credit note raised for 15,000', cn.kind === 'CREDIT_NOTE' && cn.amountSen === RM(-15000) && /^HC-CN-\d{4}-\d{3}$/.test(cn.noteNumber), cn.noteNumber);
const [cnl] = await db.q(`select n.total_sen, n.status, n.so_doc_no, l.account_code from scm.acc_credit_notes n join scm.acc_credit_note_lines l on l.note_id = n.id where n.id = $1`, [cn.creditNoteId]);
check('credit note to the RENOVATION sales-return account', cnl.account_code === '510-0000' && Number(cnl.total_sen) === RM(15000) && cnl.so_doc_no === neg);

/* ---------- contract status ---------- */
await tx((d) => M.setContractStatus(d, actor, vec, 'RENO_IN_PROGRESS'));
await refusal('an in-progress contract cannot be cancelled', 'bad_transition', () => tx((d) => M.setContractStatus(d, actor, vec, 'CANCELLED')));
await tx((d) => M.setContractStatus(d, actor, vec, 'RENO_COMPLETED'));
await tx((d) => M.setContractStatus(d, actor, vec, 'CLOSED'));
const [vecSo] = await db.q(`select status::text as status from scm.mfg_sales_orders where doc_no = $1`, [vec]);
check('contract walks Confirmed -> In progress -> Completed -> Closed', vecSo.status === 'CLOSED');
await refusal('closed contract takes no VO', 'contract_not_live', () => tx((d) => M.createVo(d, actor, vec, {})));
await refusal('cancel refused once billed (from confirmed)', 'has_bills', () => tx((d) => M.setContractStatus(d, actor, neg, 'CANCELLED')));

/* ---------- audit trail ---------- */
const [aud] = await db.q(`select count(*)::int as n from scm.mfg_so_audit_log where so_doc_no = $1`, [conv.docNo]);
check('SO audit log written', Number(aud.n) >= 5, `${aud.n}`);

console.log(`\n${passes} passed, ${fails} failed`);
await sql.end();
await server.stop();
await pg.close();
process.exit(fails ? 1 : 0);
