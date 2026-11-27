/* One-off (owner, 27 Nov 2026): Jin Ni's unit quotations in the Google sheet "JINNI UNIT PROGRESS" are the truth for her
   SOs - SKU (the quotation's CODE/COLOUR is our Hin Lim code), qty, lines and, where the quotation prints one, the total.
   Data: docs/so-import/jinni-quotes-2026-11-27.json (built from the 18 quotation PDFs; README there).

   Per project, in one transaction, through the same code the screens use (the 18 Nov Notion update, so-notion-update.mts):
     no SO yet           -> quotation -> accepted -> SO; the lines carry no price, one package line carries the total.
     an SO already there -> its live lines are compared with the target. A line is kept when the target has the same
                            wording, qty and amount, or the same SKU, qty and amount. What is left becomes one variation
                            order: lines omitted, lines added, and a "Price adjustment" line so the revised contract equals
                            the target total (the quotation's printed total, else the SO's own total, unchanged).

     npx tsx scripts/so-jinni-update.mts --dry-run                 every change is made and rolled back; prints the plan
     npx tsx scripts/so-jinni-update.mts --confirm-ref=<ref>       write; production needs its project ref typed back
     npx tsx scripts/so-jinni-update.mts --only="ASTRUM R-13-03"

   RE-RUN: safe; an SO that matches its target is skipped. Only the Conts databases (production, staging) or localhost. */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { renoDbOf, type RenoDb, type UnsafeRunner } from '../src/scm/lib/renovation-db';
import { createQuotation, lockQuotation, setQuotationStatus, type RenoActor } from '../src/scm/lib/renovation-quotation';
import { convertQuotationToSo, liveContractOfProject, revisedContractSen } from '../src/scm/lib/renovation-so';
import { applyVo, createVo, saveVo } from '../src/scm/lib/renovation-vo';
import { readSections } from '../src/scm/lib/renovation-doc-lines';
import { normaliseSections, type NormSection } from '../src/scm/lib/renovation-validate';
import { lineAmounts } from '../src/scm/shared/renovation-money';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const DRY = process.argv.includes('--dry-run');
const ONLY = arg('only');
const CONTS_REFS: Record<string, string> = { cweomoenhsjvsxfsmiiw: 'PRODUCTION', ecgyrmblqfxvbfjlqkdq: 'staging' };
const SYSTEM_STAFF = '00000000-0000-4000-8000-000000000001';
const TODAY = new Date().toISOString().slice(0, 10);
const PACKAGE = 'Package price (the quotation prices the whole unit)';

interface DataLine { kind: 'ITEM' | 'TEXT'; itemCode?: string; description: string; qty?: number; unitPriceSen?: number; discountBp?: number; netSen?: number }
interface DataSection { heading: string; lumpSumSen?: number; lines: DataLine[] }
interface DataVersion { file: string; docDate: string | null; lastAmended: string | null; preparedBy: string; to: string; payableSen: number; linesSen: number; sections: DataSection[] }
interface DataProject { project: string; projectId: number | null; versions: DataVersion[] }

const data = JSON.parse(readFileSync(arg('data') ?? join(root, 'docs/so-import/jinni-quotes-2026-11-27.json'), 'utf8')) as { projects: DataProject[] };

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set.');
const host = new URL(url.replace(/^postgres(ql)?:/, 'http:')).hostname;
const ref = Object.keys(CONTS_REFS).find((r) => url.includes(r));
if (!ref && !['127.0.0.1', 'localhost'].includes(host)) throw new Error(`Refusing ${host}: not a Conts database.`);
if (ref === 'cweomoenhsjvsxfsmiiw' && !DRY && arg('confirm-ref') !== ref) throw new Error('Production: pass --confirm-ref=cweomoenhsjvsxfsmiiw to write.');
console.log(`Target: ${ref ? CONTS_REFS[ref] : host}${DRY ? ' (dry run: every change is rolled back)' : ''}`);

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
class Rollback extends Error {}
const rm = (sen: number) => `RM ${(sen / 100).toFixed(2)}`;

function lineInput(l: DataLine) {
  if (l.kind === 'TEXT') return { kind: 'TEXT', description: l.description };
  const qty = l.qty ?? 1;
  const out: Record<string, unknown> = { kind: 'ITEM', itemCode: l.itemCode, description: l.description, qty, unitPriceSen: l.unitPriceSen ?? 0, discountBp: l.discountBp ?? 0 };
  const net = lineAmounts({ kind: 'ITEM', qty, measureMilli: null, measureUom: null, unitPriceSen: l.unitPriceSen ?? 0, discountBp: l.discountBp ?? 0, amountOverrideSen: null, isFoc: false }).netSen;
  if (net !== (l.netSen ?? 0)) out.amountOverrideSen = l.netSen ?? 0;
  return out;
}

function mainCode(v: DataVersion): string {
  const n = new Map<string, number>();
  for (const s of v.sections) for (const l of s.lines) if (l.kind === 'ITEM' && l.itemCode) n.set(l.itemCode, (n.get(l.itemCode) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'RN-PROJECT_MGMT';
}

function norm(input: unknown, mode: 'doc' | 'vo'): NormSection[] {
  const r = normaliseSections(input, mode);
  if (!r.ok) throw new Error(`invalid lines: ${r.problems.slice(0, 5).join('; ')}`);
  return r.value;
}

const words = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');

/* The lines the latest PDF prices, in its sections; a package PDF also carries the package line the import adds.
   A lump-sum section's price sits on the section, not a line: a change there is closed by the adjustment line. */
function targetOf(v: DataVersion): Array<{ heading: string; line: DataLine }> {
  const out: Array<{ heading: string; line: DataLine }> = [];
  for (const s of v.sections) for (const l of s.lines) if (l.kind === 'ITEM') out.push({ heading: s.heading, line: l });
  if (v.payableSen > v.linesSen) {
    out.push({ heading: 'Package', line: { kind: 'ITEM', itemCode: mainCode(v), description: PACKAGE, qty: 1, unitPriceSen: v.payableSen - v.linesSen, netSen: v.payableSen - v.linesSen } });
  }
  return out;
}

interface Live { id: string; itemCode: string | null; description: string; qty: number; netSen: number }

/* Pair live lines with the PDF's: same wording + qty + amount first, then same SKU + qty + amount, then same wording + amount. */
function pair(live: Live[], target: Array<{ heading: string; line: DataLine }>) {
  const left = new Set(live.map((l) => l.id));
  const unmatched: Array<{ heading: string; line: DataLine }> = [];
  const keys: Array<(l: { itemCode: string | null; description: string; qty: number; netSen: number }) => string> = [
    (l) => `${words(l.description)}|${l.qty}|${l.netSen}`,
    (l) => `${l.itemCode}|${l.qty}|${l.netSen}`,
    (l) => `${words(l.description)}|${l.netSen}`,
  ];
  let todo = target;
  for (const key of keys) {
    const pool = new Map<string, string[]>();
    for (const l of live) if (left.has(l.id)) { const k = key(l); pool.set(k, [...(pool.get(k) ?? []), l.id]); }
    const next: typeof target = [];
    for (const t of todo) {
      const ids = pool.get(key({ itemCode: t.line.itemCode ?? null, description: t.line.description, qty: t.line.qty ?? 1, netSen: t.line.netSen ?? 0 }));
      const id = ids?.shift();
      if (id) left.delete(id); else next.push(t);
    }
    todo = next;
  }
  unmatched.push(...todo);
  return { omit: live.filter((l) => left.has(l.id)), add: unmatched };
}

async function createSo(db: RenoDb, actor: RenoActor, p: DataProject) {
  const [first, ...later] = p.versions;
  const sections: Array<{ heading: string; lumpSumSen?: number; lines: Record<string, unknown>[] }> =
    first.sections.map((s) => ({ heading: s.heading, ...(s.lumpSumSen != null ? { lumpSumSen: s.lumpSumSen } : {}), lines: s.lines.map(lineInput) }));
  const docDiscountSen = first.linesSen > first.payableSen ? first.linesSen - first.payableSen : 0;
  if (first.payableSen > first.linesSen) {
    sections.push({ heading: 'Package', lines: [lineInput({ kind: 'ITEM', itemCode: mainCode(first), description: PACKAGE, qty: 1, unitPriceSen: first.payableSen - first.linesSen, netSen: first.payableSen - first.linesSen })] });
  }
  const soDate = first.docDate ?? first.lastAmended ?? TODAY;
  const header = {
    printFormat: docDiscountSen || first.sections.some((s) => s.lines.some((l) => l.discountBp)) ? 'DISCOUNT' : 'AMOUNT',
    attention: first.to, customerName: first.to, preparedBy: first.preparedBy, docDate: soDate, lastAmended: first.lastAmended,
    docDiscountSen, docDiscountLabel: docDiscountSen ? 'Discount as per quotation' : '',
  };
  const q = await createQuotation(db, actor, { projectId: p.projectId, header: header as never, sections: norm(sections, 'doc') });
  let head = await lockQuotation(db, q.id, actor.companyId);
  await setQuotationStatus(db, actor, q.id, 'SENT', head.version);
  head = await lockQuotation(db, q.id, actor.companyId);
  await setQuotationStatus(db, actor, q.id, 'ACCEPTED', head.version);
  head = await lockQuotation(db, q.id, actor.companyId);
  const { docNo, contractSen } = await convertQuotationToSo(db, actor, q.id, { version: head.version, soDate });
  if (contractSen !== first.payableSen) throw new Error(`${docNo}: contract ${contractSen} but the quotation says ${first.payableSen}`);
  const vos: string[] = [];
  for (const v of later) { const r = await bringToPdf(db, actor, docNo, v); if (r.voNo) vos.push(r.voNo); }
  await soScreenFields(db, docNo, p.projectId, actor.companyId);
  return { docNo, vos };
}

/* One VO that turns the SO's live lines into the PDF's. */
async function bringToPdf(db: RenoDb, actor: RenoActor, docNo: string, v: DataVersion) {
  const live: Live[] = (await readSections(db, { kind: 'so', id: docNo })).flatMap((s) => s.lines)
    .filter((l) => (l.kind === 'ITEM' || l.kind === 'CHILD') && !l.omittedByVoId && !l.soItemCancelled)
    .map((l) => ({ id: l.id, itemCode: l.itemCode ?? null, description: l.description ?? '', qty: Number(l.qty ?? 1), netSen: l.netSen }));
  const { omit, add } = pair(live, targetOf(v));
  const addSen = add.reduce((t, a) => t + (a.line.netSen ?? 0), 0);
  const omitSen = omit.reduce((t, l) => t + l.netSen, 0);
  const before = await revisedContractSen(db, docNo);
  const gap = v.payableSen - (before + addSen - omitSen);
  if (!omit.length && !add.length && gap === 0) return { voNo: null, before, omit, add, gap };
  const bySection = new Map<string, Record<string, unknown>[]>();
  for (const a of add) bySection.set(a.heading, [...(bySection.get(a.heading) ?? []), { ...lineInput(a.line), voChange: 'ADD' }]);
  const voSections: Array<{ heading: string; lines: Record<string, unknown>[] }> = [...bySection.entries()].map(([heading, lines]) => ({ heading, lines }));
  if (omit.length) voSections.push({ heading: 'Omitted', lines: omit.map((l) => ({ kind: 'ITEM', voChange: 'OMIT', omitTargetLineId: l.id, description: '' })) });
  if (gap !== 0) voSections.push({ heading: 'Adjustment', lines: [{ ...lineInput({ kind: 'ITEM', itemCode: mainCode(v), description: 'Price adjustment to the revised SO total', qty: 1, unitPriceSen: gap, netSen: gap }), voChange: 'ADD' }] });
  const vo = await createVo(db, actor, docNo, { title: `As per quotation ${v.file}`.slice(0, 200) });
  const [row] = await db.q<{ version: number }>(`select version from scm.reno_variation_orders where id = $1`, [vo.id]);
  const saved = await saveVo(db, actor, vo.id, { version: Number(row.version), docDate: TODAY, sections: norm(voSections, 'vo') });
  const r = await applyVo(db, actor, vo.id, { version: saved.version, signedName: v.to || null, signedAt: v.lastAmended });
  if (r.revisedContractSen !== v.payableSen) throw new Error(`${vo.voNo}: contract ${r.revisedContractSen} but the target is ${v.payableSen}`);
  if (v.lastAmended) await db.q(`update scm.reno_so_contracts set last_amended = $2::date where so_doc_no = $1`, [docNo, v.lastAmended]);
  return { voNo: vo.voNo, before, omit, add, gap };
}

/* The SO screen shows a line's catalog product as Item and the PDF wording in Remarks (as the import did). Only lines
   still carrying the PDF wording change; a new line with no room takes the area its wording names. Rooms already set,
   by the import or by hand, are kept. */
async function soScreenFields(db: RenoDb, docNo: string, projectId: number | null, companyId: number) {
  await db.q(
    `update scm.mfg_sales_order_items i set remark = i.description, description = p.name
       from (select distinct on (code) code, name from scm.mfg_products where company_id = $2 order by code, id) p
      where i.doc_no = $1 and p.code = i.item_code and i.item_code not like 'RENO-%' and i.description is distinct from p.name
        and i.remark is null`,
    [docNo, companyId],
  );
  const lines = await db.q<{ id: string; remark: string | null; description: string | null }>(
    `select id::text as id, remark, description from scm.mfg_sales_order_items where doc_no = $1 and room is null`, [docNo]);
  if (lines.length) {
    const [o] = await db.q<{ rooms: string[] | null }>(`select room_sections as rooms from scm.mfg_sales_orders where doc_no = $1`, [docNo]);
    const rooms = new Set<string>(Array.isArray(o?.rooms) ? o.rooms : []);
    const rows = lines.map((l) => {
      let room = areaOf(l.remark ?? l.description) ?? COMMON;
      if (room === 'BATH?') room = rooms.has('Bathroom 1') ? 'Bathroom 2' : 'Bathroom 1';
      if (room === 'BED?') room = rooms.has('Bedroom 1') ? 'Bedroom 2' : 'Bedroom 1';
      return { id: l.id, room };
    });
    await db.q(`update scm.mfg_sales_order_items i set room = x.room from jsonb_to_recordset($2::text::jsonb) as x(id uuid, room text) where i.id = x.id and i.doc_no = $1`,
      [docNo, JSON.stringify(rows)]);
    for (const r of rows) rooms.add(r.room);
    const sorted = [...rooms].sort((a, b) => roomRank(a) - roomRank(b));
    await db.q(`update scm.mfg_sales_orders set room_sections = $2::text::jsonb where doc_no = $1`, [docNo, JSON.stringify(sorted)]);
  }
  if (projectId == null) return;
  await db.q(
    `update scm.mfg_sales_orders o set city = coalesce(o.city, p.city), postcode = coalesce(o.postcode, p.postcode),
            customer_state = coalesce(o.customer_state, p.state)
       from public.projects p where o.doc_no = $1 and p.id = $2`,
    [docNo, projectId],
  );
}

/* Rooms: the same rule as so-notion-import.mts (Common area, Living hall, Bedroom N, Bathroom N). */
const COMMON = 'Common area';
function areaOne(t: string): string | null {
  let m: RegExpMatchArray | null;
  if (/MASTER\s*(BED\s*)?(ROOM\s*)?(TOILET|BATH)/.test(t)) return 'Bathroom 1';
  if ((m = t.match(/\b(?:TOILET|BATH\s*ROOM|BATH|WASH\s*ROOM|WC)\s*0?([1-9])\b/))) return `Bathroom ${m[1]}`;
  if (/\bMASTER\b/.test(t)) return 'Bedroom 1';
  if ((m = t.match(/\b(?:BED\s*ROOM|BEDRM|ROOM|BR)\s*0?([1-9])\b/))) return `Bedroom ${m[1]}`;
  if (/\b(TOILET|BATH\s*ROOM|WASH\s*ROOM|WC\b)/.test(t)) return 'BATH?';
  if (/\bBED\s*ROOM/.test(t)) return 'BED?';
  if (/\b(LIVING|SOFA|DINING|DININING|FAMILY\s*(HALL|AREA))|\bTV\s*(AREA|WALL)/.test(t)) return 'Living hall';
  return null;
}
function areaMany(t: string): string | null {
  const found = new Set(t.split(/\s*(?:&|\+|,|\bAND\b)\s*/).map(areaOne).filter((a): a is string => a !== null));
  return found.size === 0 ? null : found.size === 1 ? [...found][0]! : COMMON;
}
function areaOf(text: string | null | undefined): string | null {
  const t = String(text ?? '').toUpperCase();
  const at = t.lastIndexOf('@');
  return (at >= 0 ? areaMany(t.slice(at + 1)) : null) ?? areaMany(t);
}
const roomRank = (a: string) => (a === COMMON ? 0 : a === 'Living hall' ? 1 : a.startsWith('Bedroom') ? 2 : 3) * 100 + (Number(a.replace(/\D/g, '')) || 0);

try {
  const [co] = await sql`select id from public.companies where code = 'HOUZS'`;
  const actor: RenoActor = { name: 'SO update from Jin Ni quotations', staffId: SYSTEM_STAFF, companyId: Number(co.id), docPrefix: 'TC-' };
  const codes = [...new Set(data.projects.flatMap((p) => p.versions.flatMap((v) => v.sections.flatMap((s) => s.lines.map((l) => l.itemCode).filter(Boolean)))))] as string[];
  const known = new Set((await sql`select distinct code from scm.mfg_products where company_id = ${actor.companyId} and code = any(${codes})`).map((r) => r.code as string));
  const missing = codes.filter((c) => !known.has(c));
  console.log(`${codes.length} SKU codes used, ${missing.length} missing${missing.length ? `: ${missing.join(', ')}` : ''}`);
  if (missing.length) throw new Error('Open the missing SKUs first; nothing was written.');
  const lost = data.projects.filter((p) => p.projectId == null).map((p) => p.project);
  if (lost.length) throw new Error(`No project for: ${lost.join(', ')}. Nothing was written.`);
  let changed = 0, created = 0, same = 0, failed = 0;
  for (const p of data.projects) {
    if (ONLY && p.project !== ONLY) continue;
    const last = p.versions[p.versions.length - 1];
    try {
      await sql.begin(async (tx) => {
        const db = renoDbOf(tx as unknown as UnsafeRunner);
        const existing = await liveContractOfProject(db, p.projectId!);
        if (!existing) {
          const r = await createSo(db, actor, p);
          console.log(`new   ${p.project}: ${r.docNo}${r.vos.length ? ` + ${r.vos.join(', ')}` : ''}, ${rm(last.payableSen)} (${last.file})`);
          created++;
        } else {
          const r = await bringToPdf(db, actor, existing, last);
          if (!r.voNo) { console.log(`same  ${p.project}: ${existing} matches ${last.file}`); same++; }
          else {
            await soScreenFields(db, existing, p.projectId, actor.companyId);
            console.log(`vo    ${p.project}: ${existing} ${r.voNo}  ${rm(r.before)} -> ${rm(last.payableSen)}  omit ${r.omit.length} (${rm(r.omit.reduce((t, l) => t + l.netSen, 0))}), add ${r.add.length} (${rm(r.add.reduce((t, a) => t + (a.line.netSen ?? 0), 0))})${r.gap ? `, adjustment ${rm(r.gap)}` : ''}`);
            for (const l of r.omit) console.log(`        - ${rm(l.netSen).padStart(12)}  x${l.qty}  ${l.itemCode ?? ''}  ${l.description.slice(0, 90)}`);
            for (const a of r.add) console.log(`        + ${rm(a.line.netSen ?? 0).padStart(12)}  x${a.line.qty ?? 1}  ${a.line.itemCode ?? ''}  ${a.line.description.slice(0, 90)}`);
            changed++;
          }
        }
        if (DRY) throw new Rollback();
      });
    } catch (e) {
      if (e instanceof Rollback) continue;
      failed++;
      console.log(`FAIL  ${p.project}: ${(e as Error).message}`);
    }
  }
  console.log(`${changed} SO changed by a VO, ${created} SO created, ${same} already matching, ${failed} failed${DRY ? ' (dry run: nothing written)' : ''}.`);
  if (failed) process.exitCode = 1;
} finally {
  await sql.end();
}
