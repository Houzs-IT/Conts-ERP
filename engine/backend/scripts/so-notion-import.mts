/* One-off (owner, 26 Oct 2026): the renovation sales orders kept as PDFs in Notion become engine contracts.
   Data: docs/so-import/so-notion-data.json (built from Notion SO.zip by docs/so-import/build, see README there).

   Each project goes through the same steps as the screens, in one transaction:
     its oldest PDF -> quotation -> sent -> accepted -> converted to a sales order (our own TC-SO number, dated as the PDF);
     every later PDF -> a variation order on that SO: lines that disappeared are omitted, new ones added, and a
     "Price adjustment" line closes any gap so the revised contract equals the PDF's printed final total.
   A PDF whose lines add up to more than its printed total carries the difference as the document discount; one that
   prices a package (lines without prices) gets a "Package price" line for the rest.

     npx tsx scripts/so-notion-import.mts --dry-run                 plan only, nothing written (DATABASE_URL)
     npx tsx scripts/so-notion-import.mts --confirm-ref=<ref>       write; production needs its project ref typed back
     npx tsx scripts/so-notion-import.mts --only="BARON B11-07 MS LEE"

   RE-RUN: safe. A project that already has a renovation contract, or a note row from this import, is skipped.
   Only the Conts databases (production, staging) or localhost are accepted. */
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
const NOTE = 'note:so-notion-import:';
const SYSTEM_STAFF = '00000000-0000-4000-8000-000000000001';

interface DataLine { kind: 'ITEM' | 'TEXT'; itemCode?: string; description: string; qty?: number; unitPriceSen?: number; discountBp?: number; netSen?: number }
interface DataVersion { file: string; docDate: string | null; lastAmended: string | null; preparedBy: string; to: string; payableSen: number; linesSen: number; sections: Array<{ heading: string; lines: DataLine[] }> }
interface DataProject { project: string; projectId: number | null; versions: DataVersion[] }

const data = JSON.parse(readFileSync(arg('data') ?? join(root, 'docs/so-import/so-notion-data.json'), 'utf8')) as { projects: DataProject[] };

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set.');
const host = new URL(url.replace(/^postgres(ql)?:/, 'http:')).hostname;
const ref = Object.keys(CONTS_REFS).find((r) => url.includes(r));
if (!ref && !['127.0.0.1', 'localhost'].includes(host)) throw new Error(`Refusing ${host}: not a Conts database.`);
if (ref === 'cweomoenhsjvsxfsmiiw' && !DRY && arg('confirm-ref') !== ref) throw new Error('Production: pass --confirm-ref=cweomoenhsjvsxfsmiiw to write.');
console.log(`Target: ${ref ? CONTS_REFS[ref] : host}${DRY ? ' (dry run)' : ''}`);

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

function lineInput(l: DataLine) {
  if (l.kind === 'TEXT') return { kind: 'TEXT', description: l.description };
  const qty = l.qty ?? 1;
  const out: Record<string, unknown> = { kind: 'ITEM', itemCode: l.itemCode, description: l.description, qty, unitPriceSen: l.unitPriceSen ?? 0, discountBp: l.discountBp ?? 0 };
  const net = lineAmounts({ kind: 'ITEM', qty, measureMilli: null, unitPriceSen: l.unitPriceSen ?? 0, discountBp: l.discountBp ?? 0, amountOverrideSen: null, isFoc: false }).netSen;
  if (net !== (l.netSen ?? 0)) out.amountOverrideSen = l.netSen ?? 0;
  return out;
}

/* The code most of the version's lines use: carried by the package / adjustment lines. */
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

const keyOf = (code: string | null, desc: string, net: number) => `${code}|${desc.trim().toUpperCase()}|${net}`;

async function importProject(db: RenoDb, actor: RenoActor, p: DataProject) {
  const [first, ...later] = p.versions;
  const sections = first.sections.map((s) => ({ heading: s.heading, lines: s.lines.map(lineInput) }));
  let docDiscountSen = 0;
  if (first.linesSen > first.payableSen) docDiscountSen = first.linesSen - first.payableSen;
  if (first.payableSen > first.linesSen) {
    sections.push({ heading: 'Package', lines: [lineInput({ kind: 'ITEM', itemCode: mainCode(first), description: 'Package price (not priced per line on the signed SO)', qty: 1, unitPriceSen: first.payableSen - first.linesSen, netSen: first.payableSen - first.linesSen })] });
  }
  const soDate = first.docDate ?? first.lastAmended ?? new Date().toISOString().slice(0, 10);
  const header = {
    printFormat: docDiscountSen || first.sections.some((s) => s.lines.some((l) => l.discountBp)) ? 'DISCOUNT' : 'AMOUNT',
    attention: first.to, customerName: first.to, preparedBy: first.preparedBy, docDate: soDate, lastAmended: first.lastAmended,
    docDiscountSen, docDiscountLabel: docDiscountSen ? 'Discount as per signed SO' : '',
  };
  const q = await createQuotation(db, actor, { projectId: p.projectId, header: header as never, sections: norm(sections, 'doc') });
  let head = await lockQuotation(db, q.id, actor.companyId);
  await setQuotationStatus(db, actor, q.id, 'SENT', head.version);
  head = await lockQuotation(db, q.id, actor.companyId);
  await setQuotationStatus(db, actor, q.id, 'ACCEPTED', head.version);
  head = await lockQuotation(db, q.id, actor.companyId);
  const { docNo, contractSen } = await convertQuotationToSo(db, actor, q.id, { version: head.version, soDate });
  if (contractSen !== first.payableSen) throw new Error(`${docNo}: contract ${contractSen} but the PDF says ${first.payableSen}`);
  await db.q(`update scm.mfg_sales_orders set note = $2 where doc_no = $1`, [docNo, `Imported from Notion SO PDF ${first.file}`]);

  const vos: string[] = [];
  for (const v of later) {
    const live = (await readSections(db, { kind: 'so', id: docNo })).flatMap((s) => s.lines)
      .filter((l) => (l.kind === 'ITEM' || l.kind === 'CHILD') && !l.omittedByVoId && !l.soItemCancelled);
    const pool = new Map<string, string[]>();
    for (const l of live) { const k = keyOf(l.itemCode, l.description, l.netSen); pool.set(k, [...(pool.get(k) ?? []), l.id]); }
    const adds: Array<{ heading: string; lines: Record<string, unknown>[] }> = [];
    let addSen = 0;
    for (const s of v.sections) {
      const lines: Record<string, unknown>[] = [];
      for (const l of s.lines) {
        if (l.kind !== 'ITEM') continue;
        const ids = pool.get(keyOf(l.itemCode ?? null, l.description, l.netSen ?? 0));
        if (ids?.length) { ids.shift(); continue; }
        lines.push({ ...lineInput(l), voChange: 'ADD' });
        addSen += l.netSen ?? 0;
      }
      if (lines.length) adds.push({ heading: s.heading, lines });
    }
    const omitIds = [...pool.values()].flat();
    const omitSen = live.filter((l) => omitIds.includes(l.id)).reduce((t, l) => t + l.netSen, 0);
    const before = await revisedContractSen(db, docNo);
    const gap = v.payableSen - (before + addSen - omitSen);
    const voSections: Array<{ heading: string; lines: Record<string, unknown>[] }> = [...adds];
    if (omitIds.length) voSections.push({ heading: 'Omitted', lines: omitIds.map((id) => ({ kind: 'ITEM', voChange: 'OMIT', omitTargetLineId: id, description: '' })) });
    if (gap !== 0) voSections.push({ heading: 'Adjustment', lines: [{ ...lineInput({ kind: 'ITEM', itemCode: mainCode(v), description: 'Price adjustment to the revised SO total', qty: 1, unitPriceSen: gap, netSen: gap }), voChange: 'ADD' }] });
    if (voSections.length === 0) continue;
    const vo = await createVo(db, actor, docNo, { title: `Revised SO ${v.lastAmended ?? ''} (${v.file})`.slice(0, 200) });
    const [row] = await db.q<{ version: number }>(`select version from scm.reno_variation_orders where id = $1`, [vo.id]);
    const saved = await saveVo(db, actor, vo.id, { version: Number(row.version), docDate: v.lastAmended ?? undefined, sections: norm(voSections, 'vo') });
    const r = await applyVo(db, actor, vo.id, { version: saved.version, signedName: v.to || null, signedAt: v.lastAmended });
    if (r.revisedContractSen !== v.payableSen) throw new Error(`${vo.voNo}: contract ${r.revisedContractSen} but the PDF says ${v.payableSen}`);
    if (v.lastAmended) await db.q(`update scm.reno_so_contracts set last_amended = $2::date where so_doc_no = $1`, [docNo, v.lastAmended]);
    vos.push(vo.voNo);
  }
  return { docNo, vos, total: p.versions[p.versions.length - 1].payableSen };
}

try {
  const [co] = await sql`select id from public.companies where code = 'HOUZS'`;
  const actor: RenoActor = { name: 'Notion SO import', staffId: SYSTEM_STAFF, companyId: Number(co.id), docPrefix: 'TC-' };
  const codes = [...new Set(data.projects.flatMap((p) => p.versions.flatMap((v) => v.sections.flatMap((s) => s.lines.map((l) => l.itemCode).filter(Boolean)))))] as string[];
  const known = new Set((await sql`select distinct code from scm.mfg_products where company_id = ${actor.companyId} and code = any(${codes})`).map((r) => r.code as string));
  const missing = codes.filter((c) => !known.has(c));
  console.log(`${codes.length} SKU codes used, ${missing.length} missing${missing.length ? `: ${missing.join(', ')}` : ''}`);
  if (missing.length) throw new Error('Open the missing SKUs first; nothing was written.');
  const projectIds = data.projects.map((p) => p.projectId).filter((x): x is number => x != null);
  const found = new Set((await sql`select id from public.projects where id = any(${projectIds})`).map((r) => Number(r.id)));
  const lost = data.projects.filter((p) => p.projectId != null && !found.has(p.projectId)).map((p) => p.project);
  if (lost.length) throw new Error(`Projects not found: ${lost.join(', ')}. Nothing was written.`);
  let done = 0, skipped = 0;
  for (const p of data.projects) {
    if (ONLY && p.project !== ONLY) continue;
    const noteKey = NOTE + p.project;
    const [note] = await sql`select value from scm.app_config where key = ${noteKey}`;
    const existing = p.projectId != null ? await liveContractOfProject(renoDbOf(sql as unknown as UnsafeRunner), p.projectId) : null;
    if (note || existing) { console.log(`skip  ${p.project}: ${existing ? `already has ${existing}` : `imported earlier (${note.value})`}`); skipped++; continue; }
    const last = p.versions[p.versions.length - 1];
    if (DRY) {
      console.log(`plan  ${p.project}${p.projectId ? ` (project ${p.projectId})` : ' (no project)'}: SO from ${p.versions[0].file}, ${p.versions.length - 1} VO, final RM ${(last.payableSen / 100).toFixed(2)}`);
      continue;
    }
    const res = await sql.begin(async (tx) => {
      const db = renoDbOf(tx as unknown as UnsafeRunner);
      const r = await importProject(db, actor, p);
      await db.q(`insert into scm.app_config (key, value, description, company_id) values ($1, $2, $3, $4)`,
        [noteKey, r.docNo, `Notion SO import 26 Oct 2026: ${r.docNo}${r.vos.length ? ` + ${r.vos.join(', ')}` : ''}`, actor.companyId]);
      return r;
    });
    console.log(`done  ${p.project}: ${res.docNo}${res.vos.length ? ` + ${res.vos.length} VO` : ''}, RM ${(res.total / 100).toFixed(2)}`);
    done++;
  }
  console.log(`${done} imported, ${skipped} skipped${DRY ? ' (dry run: nothing written)' : ''}.`);
} finally {
  await sql.end();
}
