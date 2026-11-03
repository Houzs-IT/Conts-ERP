/* One-off (owner, 2 Nov 2026): the in-house renovation orders of The Conts brand (Skyline Embassy quotations, KL 48
   Airbnb packages) become engine contracts, each under its own renovation project. Data:
   docs/so-import/inhouse/inhouse-so-data.json (built from the owner's files, see docs/so-import/inhouse/README.md).

   The same path as the Dream Crafter import (scripts/so-notion-import.mts), through the code the screens use:
     project  -> createRenovationProject (services/renovation/create.ts), then the import fields the 79 imported
                 projects carry (brand The Conts, inhouse renovation, address, source);
     order    -> quotation (brand The Conts) -> sent -> accepted -> converted to a sales order on --so-date.
                 The brand makes it an inhouse renovation contract: a 302- customer and a 481- advance account.
                 Lines adding up to more than the quotation's final total carry the rest as the document discount;
                 a package without line prices carries its total on one "Package price" line.
   Accounts (owner, 2 Nov 2026): each contract takes the customer (302-) and advance (481-) account AutoCount already
     keeps for its unit (findAccounts); the two the conversion opens are removed in the same transaction, so no new
     account is left. A unit without exactly one of each is not imported: it is listed at the end.

   EVERYTHING runs in ONE transaction. --dry-run builds it all, prints the counts and totals, and rolls back.

     npx tsx scripts/so-inhouse-import.mts --so-date=2026-10-31 --dry-run [--groups=EMBASSY,KL48,OTHER]
     npx tsx scripts/so-inhouse-import.mts --so-date=2026-10-31 --confirm-ref=<ref> [--groups=EMBASSY,OTHER]

   An order whose price is a placeholder is dry-run only: a write refuses it. An order marked "hold" in the data is
   skipped unless its key is in --release.
   --new-accounts=<key>,...   (owner, 3 Nov 2026) these units have no AutoCount accounts: the contract keeps the 302- customer
                              and 481- advance account the conversion opens, as the screens do. Refused if AutoCount has them.
   --account-alias=<key>:<unit>  look the AutoCount accounts up under another unit number (KL48 B-17-09:B-17-19).
   A package priced as a whole is one lump-sum section (the engine's own): its price on the section, its lines unpriced.
   RE-RUN: safe. A project is found by its source_ref, an order by its note row (scm.app_config) or its project's
   live contract; both are skipped. Only the Conts databases (production, staging) or localhost are accepted. */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres, { type Sql } from 'postgres';
import { renoDbOf, type RenoDb, type UnsafeRunner } from '../src/scm/lib/renovation-db';
import { createQuotation, lockQuotation, setQuotationStatus, type RenoActor } from '../src/scm/lib/renovation-quotation';
import { convertQuotationToSo, liveContractOfProject } from '../src/scm/lib/renovation-so';
import { normaliseSections, type NormSection } from '../src/scm/lib/renovation-validate';
import { lineAmounts } from '../src/scm/shared/renovation-money';
import { createRenovationProject } from '../src/services/renovation/create';
import { d1Compat } from '../src/db/d1-compat';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const DRY = process.argv.includes('--dry-run');
const GROUPS = new Set((arg('groups') ?? 'EMBASSY,OTHER').split(',').map((g) => g.trim().toUpperCase()).filter(Boolean));
const SO_DATE = arg('so-date') ?? '';
const list = (n: string) => new Set((arg(n) ?? '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean));
const RELEASE = list('release');
const NEW_ACCOUNTS = list('new-accounts');
const ALIAS = new Map([...list('account-alias')].map((x) => { const [k, u] = x.split(':'); return [k.trim(), (u ?? '').trim()] as [string, string]; }));
const CONTS_REFS: Record<string, string> = { cweomoenhsjvsxfsmiiw: 'PRODUCTION', ecgyrmblqfxvbfjlqkdq: 'staging' };
const NOTE = 'note:so-inhouse-import:';
const SRC = 'owner-data:';
const SYSTEM_STAFF = '00000000-0000-4000-8000-000000000001';
const THE_CONTS_BRAND = 'The Conts';
const AIRBNB_PACKAGE_TYPE = 'Airbnb package';

interface DataLine { kind: 'ITEM' | 'TEXT'; itemCode?: string; description: string; qty?: number; unitPriceSen?: number; discountBp?: number; netSen?: number }
interface Order {
  group: string; key: string; unit: string; building: string; owner: string; email: string; layout: string; preparedBy: string; source: string;
  payableSen: number; linesSen: number; pricePlaceholder: boolean; type?: string; hold?: string; sections: Array<{ heading: string; lumpSumSen?: number; lines: DataLine[] }>;
}
interface Project { key: string; group: string; building: string; unit: string; owner: string; email: string; layout: string }

if (!/^\d{4}-\d{2}-\d{2}$/.test(SO_DATE)) throw new Error('Pass --so-date=YYYY-MM-DD: the files carry no date, the SO date is given.');
const data = JSON.parse(readFileSync(arg('data') ?? join(root, 'docs/so-import/inhouse/inhouse-so-data.json'), 'utf8')) as { orders: Order[]; projects: Project[] };

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set.');
const host = new URL(url.replace(/^postgres(ql)?:/, 'http:')).hostname;
const ref = Object.keys(CONTS_REFS).find((r) => url.includes(r));
if (!ref && !['127.0.0.1', 'localhost'].includes(host)) throw new Error(`Refusing ${host}: not a Conts database.`);
if (ref === 'cweomoenhsjvsxfsmiiw' && !DRY && arg('confirm-ref') !== ref) throw new Error('Production: pass --confirm-ref=cweomoenhsjvsxfsmiiw to write.');
const held = data.orders.filter((o) => GROUPS.has(o.group) && o.hold && !RELEASE.has(o.key.toUpperCase()));
const orders = data.orders.filter((o) => GROUPS.has(o.group) && !held.includes(o));
for (const k of [...NEW_ACCOUNTS, ...ALIAS.keys()]) if (!orders.some((o) => o.key.toUpperCase() === k)) throw new Error(`${k} is not an order of this run.`);
const placeholders = orders.filter((o) => o.pricePlaceholder);
if (!DRY && placeholders.length) throw new Error(`${placeholders.length} order(s) have a placeholder price (${placeholders[0].key}, ...): dry-run only.`);
const projects = data.projects.filter((p) => GROUPS.has(p.group));
console.log(`Target: ${ref ? CONTS_REFS[ref] : host}${DRY ? ' (dry run: everything is rolled back)' : ''}; SO date ${SO_DATE}; groups ${[...GROUPS].join(', ')}; `
  + `${projects.length} projects, ${orders.length} orders`);

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const rm = (sen: number) => `RM ${(sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const keyOf = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
/* AutoCount writes the KL 48 accounts as "KL48 A-22-11": compared without spaces and dashes. */
const acUnit = (building: string, unit: string) => keyOf(`${building} ${unit}`);

function lineInput(l: DataLine) {
  if (l.kind === 'TEXT') return { kind: 'TEXT', description: l.description };
  const qty = l.qty ?? 1;
  const price = l.unitPriceSen ?? 0;
  const out: Record<string, unknown> = { kind: 'ITEM', itemCode: l.itemCode, description: l.description, qty, unitPriceSen: price, discountBp: l.discountBp ?? 0 };
  const net = lineAmounts({ kind: 'ITEM', qty, measureMilli: null, unitPriceSen: price, discountBp: l.discountBp ?? 0, amountOverrideSen: null, isFoc: false }).netSen;
  if (net !== (l.netSen ?? 0)) out.amountOverrideSen = l.netSen ?? 0;
  return out;
}
function mainCode(o: Order): string {
  const n = new Map<string, number>();
  for (const s of o.sections) for (const l of s.lines) if (l.itemCode) n.set(l.itemCode, (n.get(l.itemCode) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'RN-PROJECT_MGMT';
}
function norm(input: unknown): NormSection[] {
  const r = normaliseSections(input, 'doc');
  if (!r.ok) throw new Error(`invalid lines: ${r.problems.slice(0, 5).join('; ')}`);
  return r.value;
}

/* The project, through the screens' own create, then the fields the imported projects carry. */
async function ensureProject(db: RenoDb, tx: Sql, p: Project, companyId: number, typeId: number): Promise<{ id: number; code: string; created: boolean }> {
  const sourceRef = SRC + p.key;
  const [have] = await db.q<{ id: string; code: string }>('select id::text as id, code from public.projects where source_ref = $1 and company_id = $2', [sourceRef, companyId]);
  if (have) return { id: Number(have.id), code: have.code, created: false };
  const name = [p.building, p.unit, p.owner].filter(Boolean).join(' ');
  const made = await createRenovationProject(d1Compat(() => tx) as never, {
    name, projectTypeId: typeId, customerKind: 'customer', customerName: p.owner || name, customerEmail: p.email || null,
    building: p.building, unitNo: p.unit,
  }, null as never, companyId, new Date(`${SO_DATE}T04:00:00Z`));
  if (!made) throw new Error(`project type ${typeId} not found: ${p.key}`);
  await db.q(
    `update public.projects set brand = $2, finance_kind = 'INHOUSE_RENOVATION', layout_label = nullif($3, ''), address1 = $4, country = 'Malaysia',
            property_type = 'Condo', funding = 'customer', source = 'import', source_ref = $5, start_date = $6, status = 'pending',
            flow_manual_reason = $7
      where id = $1`,
    [made.id, THE_CONTS_BRAND, p.layout, `${p.unit}, ${p.building}`, sourceRef, SO_DATE, `Imported from the Owner Data file (${p.group}), 2 Nov 2026`],
  );
  return { ...made, created: true };
}

/* AutoCount's own accounts for this unit (chart import, 24 Oct 2026; owner, 2 Nov 2026: reuse them, never open new
   ones). Customer: the one 302- debtor whose name ends "(<building> <unit>)" (spaces and dashes ignored; KL 48 is
   "KL48" there); two such, the one whose name carries the owner's; none, the one 302- debtor named exactly as the
   owner and tied to no unit. Advance: the one active 481- sub-account named "<building> <unit>". Either missing or
   ambiguous: the order is not imported and is reported. */
type Accounts = { ok: true; debtor: string; advance: string; how: string } | { ok: false; why: string };
async function findAccounts(db: RenoDb, companyId: number, o: Order): Promise<Accounts> {
  const unitKey = acUnit(o.building, ALIAS.get(o.key.toUpperCase()) || o.unit);
  const all = await db.q<{ code: string; name: string }>(`select code, name from scm.debtors where company_id = $1 and control_account = '302-0000'`, [companyId]);
  const tagged = all.filter((d) => keyOf(d.name.match(/\(([^()]*)\)\s*$/)?.[1] ?? '') === unitKey);
  let debtors = tagged;
  let how = 'customer by unit';
  if (tagged.length > 1) { debtors = tagged.filter((d) => keyOf(d.name).includes(keyOf(o.owner))); how = 'customer by unit and owner name'; }
  if (tagged.length === 0) { debtors = all.filter((d) => !/\)\s*$/.test(d.name) && keyOf(d.name) === keyOf(o.owner)); how = 'customer by owner name (no unit on it)'; }
  const advances = (await db.q<{ account_code: string; account_name: string }>(
    `select account_code, account_name from scm.accounts where company_id = $1 and parent_code = '481-0000' and is_active`, [companyId]))
    .filter((a) => keyOf(a.account_name) === unitKey);
  const why: string[] = [];
  if (debtors.length !== 1) why.push(debtors.length === 0 ? 'no 302- customer in AutoCount for this unit' : `${debtors.length} 302- customers fit (${debtors.map((d) => d.code).join(', ')})`);
  if (advances.length !== 1) why.push(advances.length === 0 ? 'no 481- advance account in AutoCount for this unit' : `${advances.length} 481- accounts fit (${advances.map((a) => a.account_code).join(', ')})`);
  if (why.length) return { ok: false, why: why.join('; ') };
  const [usedD] = await db.q<{ doc_no: string }>('select doc_no from scm.mfg_sales_orders where company_id = $1 and debtor_code = $2 limit 1', [companyId, debtors[0].code]);
  const [usedA] = await db.q<{ so_doc_no: string }>('select so_doc_no from scm.reno_so_contracts where advance_account_code = $1 limit 1', [advances[0].account_code]);
  if (usedD || usedA) return { ok: false, why: `AutoCount account already on ${usedD?.doc_no ?? usedA?.so_doc_no}` };
  return { ok: true, debtor: debtors[0].code, advance: advances[0].account_code, how };
}

/* The conversion opens a customer and an advance account (renovation-so.ts); inside this same transaction the contract
   moves to AutoCount's two and the two just opened are removed, so no new account is left. */
async function useAccounts(db: RenoDb, companyId: number, docNo: string, acc: { debtor: string; advance: string }) {
  const [so] = await db.q<{ debtor_code: string }>('select debtor_code from scm.mfg_sales_orders where doc_no = $1', [docNo]);
  const [ct] = await db.q<{ advance_account_code: string }>('select advance_account_code from scm.reno_so_contracts where so_doc_no = $1', [docNo]);
  await db.q('update scm.mfg_sales_orders set debtor_code = $2 where doc_no = $1', [docNo, acc.debtor]);
  await db.q('update scm.reno_so_contracts set advance_account_code = $2 where so_doc_no = $1', [docNo, acc.advance]);
  if (so.debtor_code !== acc.debtor) {
    const [other] = await db.q('select 1 from scm.mfg_sales_orders where debtor_code = $1 limit 1', [so.debtor_code]);
    if (other) throw new Error(`${docNo}: the customer ${so.debtor_code} the conversion opened is used elsewhere`);
    await db.q('delete from scm.debtors where company_id = $1 and code = $2', [companyId, so.debtor_code]);
  }
  if (ct.advance_account_code !== acc.advance) {
    const [other] = await db.q('select 1 from scm.reno_so_contracts where advance_account_code = $1 limit 1', [ct.advance_account_code]);
    if (other) throw new Error(`${docNo}: the advance account ${ct.advance_account_code} the conversion opened is used elsewhere`);
    await db.q('delete from scm.accounts where company_id = $1 and account_code = $2', [companyId, ct.advance_account_code]);
  }
}

async function importOrder(db: RenoDb, actor: RenoActor, brandId: number, o: Order, projectId: number, acc: { debtor: string; advance: string } | null) {
  const sections: Array<{ heading: string; lumpSumSen?: number; lines: Record<string, unknown>[] }> =
    o.sections.map((s) => ({ heading: s.heading, ...(s.lumpSumSen != null ? { lumpSumSen: s.lumpSumSen } : {}), lines: s.lines.map(lineInput) }));
  const docDiscountSen = o.linesSen > o.payableSen ? o.linesSen - o.payableSen : 0;
  if (o.payableSen > o.linesSen) {
    const gap = o.payableSen - o.linesSen;
    sections.push({ heading: 'Package', lines: [lineInput({ kind: 'ITEM', itemCode: mainCode(o), description: `Package price (${o.source})`, qty: 1, unitPriceSen: gap, netSen: gap })] });
  }
  const header = {
    printFormat: docDiscountSen ? 'DISCOUNT' : 'AMOUNT', attention: o.owner, customerName: o.owner, customerEmail: o.email || '',
    building: o.building, unitNo: o.unit, layoutLabel: o.layout, propertyType: 'Condo', preparedBy: o.preparedBy, docDate: SO_DATE,
    docDiscountSen, docDiscountLabel: docDiscountSen ? 'Discount as per quotation' : '',
  };
  const q = await createQuotation(db, actor, { projectId, brandId, header: header as never, sections: norm(sections) });
  let head = await lockQuotation(db, q.id, actor.companyId);
  await setQuotationStatus(db, actor, q.id, 'SENT', head.version);
  head = await lockQuotation(db, q.id, actor.companyId);
  await setQuotationStatus(db, actor, q.id, 'ACCEPTED', head.version);
  head = await lockQuotation(db, q.id, actor.companyId);
  const { docNo, contractSen } = await convertQuotationToSo(db, actor, q.id, { version: head.version, soDate: SO_DATE });
  if (contractSen !== o.payableSen) throw new Error(`${docNo} (${o.key}): contract ${contractSen} but the source says ${o.payableSen}`);
  await db.q('update scm.mfg_sales_orders set note = $2 where doc_no = $1', [docNo, `Imported 2 Nov 2026 from ${o.source}`]);
  await soScreenFields(db, docNo, projectId, actor.companyId);
  if (acc) await useAccounts(db, actor.companyId, docNo, acc);
  const [opened] = await db.q<{ debtor_code: string; advance_account_code: string }>(
    'select o.debtor_code, c.advance_account_code from scm.mfg_sales_orders o join scm.reno_so_contracts c on c.so_doc_no = o.doc_no where o.doc_no = $1', [docNo]);
  return { docNo, contractSen, debtor: opened.debtor_code, advance: opened.advance_account_code };
}

/* As the Dream Crafter import: Item shows the catalog product, the quoted wording moves to Remarks; rooms by the
   system's room rule; delivery city / postcode / state from the project. */
async function soScreenFields(db: RenoDb, docNo: string, projectId: number, companyId: number) {
  await db.q(
    `update scm.mfg_sales_order_items i set remark = i.description, description = p.name
       from (select distinct on (code) code, name from scm.mfg_products where company_id = $2 order by code, id) p
      where i.doc_no = $1 and p.code = i.item_code and i.item_code not like 'RENO-%' and i.description is distinct from p.name`,
    [docNo, companyId],
  );
  await areaRooms(db, docNo);
  await db.q(
    `update scm.mfg_sales_orders o set city = coalesce(p.city, o.city), postcode = coalesce(p.postcode, o.postcode),
            customer_state = coalesce(p.state, o.customer_state)
       from public.projects p where o.doc_no = $1 and p.id = $2`,
    [docNo, projectId],
  );
}
const COMMON = 'Common area';
function areaOne(t: string): string | null {
  let m: RegExpMatchArray | null;
  if (/MASTER\s*(BED\s*)?(ROOM\s*)?(TOILET|BATH)/.test(t)) return 'Bathroom 1';
  if ((m = t.match(/\b(?:TOILET|BATH\s*ROOM|BATH|WASH\s*ROOM|WC)\s*0?([1-9])\b/))) return `Bathroom ${m[1]}`;
  if (/\bMASTER\b/.test(t)) return 'Bedroom 1';
  if (/\b(2ND|SECOND)\s*(BED\s*)?ROOM\b/.test(t)) return 'Bedroom 2';
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
async function areaRooms(db: RenoDb, docNo: string) {
  const lines = await db.q<{ id: string; remark: string | null; description: string | null; room: string | null }>(
    'select id::text as id, remark, description, room from scm.mfg_sales_order_items where doc_no = $1', [docNo]);
  const rows = lines.map((l) => ({ id: l.id, room: areaOf(l.remark ?? l.description) ?? areaOf(l.room) ?? COMMON }));
  const has = new Set(rows.map((r) => r.room));
  for (const r of rows) {
    if (r.room === 'BATH?') r.room = has.has('Bathroom 1') ? 'Bathroom 2' : 'Bathroom 1';
    if (r.room === 'BED?') r.room = has.has('Bedroom 1') ? 'Bedroom 2' : 'Bedroom 1';
  }
  const rooms = [...new Set(rows.map((r) => r.room))].sort((a, b) => roomRank(a) - roomRank(b));
  await db.q(
    `update scm.mfg_sales_order_items i set room = x.room
       from jsonb_to_recordset($2::text::jsonb) as x(id uuid, room text) where i.id = x.id and i.doc_no = $1`,
    [docNo, JSON.stringify(rows)],
  );
  await db.q('update scm.mfg_sales_orders set room_sections = $2::text::jsonb where doc_no = $1', [docNo, JSON.stringify(rooms)]);
}

class Rollback extends Error {}

try {
  const [co] = await sql`select id from public.companies where code = 'HOUZS'`;
  const companyId = Number(co.id);
  const actor: RenoActor = { name: 'SO import', staffId: SYSTEM_STAFF, companyId, docPrefix: 'TC-' };
  const [brand] = await sql`select id, finance_kind from public.project_brands where company_id = ${companyId} and name = ${THE_CONTS_BRAND}`;
  if (!brand || brand.finance_kind !== 'INHOUSE_RENOVATION') throw new Error(`Brand "${THE_CONTS_BRAND}" is missing or not inhouse renovation.`);
  const [ptype] = await sql`select id from public.project_types where company_id = ${companyId} and name = ${AIRBNB_PACKAGE_TYPE} and active`;
  if (!ptype) throw new Error(`Project type "${AIRBNB_PACKAGE_TYPE}" not found.`);
  const codes = [...new Set(orders.flatMap((o) => o.sections.flatMap((s) => s.lines.map((l) => l.itemCode).filter((c): c is string => !!c))))];
  const known = new Set((await sql`select distinct code from scm.mfg_products where company_id = ${companyId} and code = any(${codes})`).map((r) => r.code as string));
  const missing = codes.filter((c) => !known.has(c));
  console.log(`${codes.length} SKU codes used, ${missing.length} missing${missing.length ? `: ${missing.join(', ')}` : ''}`);
  if (missing.length) throw new Error('Open the missing SKUs first; nothing was written.');

  const before = (await sql`select (select count(*) from public.projects)::int projects, (select count(*) from scm.mfg_sales_orders where so_kind = 'RENOVATION')::int sos,
    (select count(*) from scm.debtors where code like '302-%')::int d302, (select count(*) from scm.accounts where account_code like '481-%')::int a481`)[0];
  const done: string[] = [];
  const notSeeded: string[] = held.map((o) => `${o.key}: ${o.hold}`);
  const opened: string[] = [];
  try {
    await sql.begin(async (tx) => {
      const db = renoDbOf(tx as unknown as UnsafeRunner);
      const projectOf = new Map<string, { id: number; code: string }>();
      let made = 0;
      for (const p of projects) {
        const r = await ensureProject(db, tx as unknown as Sql, p, companyId, Number(ptype.id));
        projectOf.set(p.key, r);
        if (r.created) made++;
        console.log(`project ${r.created ? 'new ' : 'kept'} ${r.code} ${p.key} (${p.owner})`);
      }
      let total = 0;
      for (const o of orders) {
        const proj = projectOf.get(o.key);
        if (!proj) throw new Error(`no project for ${o.key}`);
        const [note] = await db.q<{ value: string }>('select value from scm.app_config where key = $1', [NOTE + o.key]);
        const existing = await liveContractOfProject(db, proj.id);
        if (note || existing) { console.log(`skip  ${o.key}: ${existing ? `already has ${existing}` : `imported earlier (${note!.value})`}`); continue; }
        const acc = await findAccounts(db, companyId, o);
        const openNew = NEW_ACCOUNTS.has(o.key.toUpperCase());
        if (openNew && (acc.ok || !/no 302- customer/.test(acc.why) || !/no 481- advance/.test(acc.why))) {
          throw new Error(`${o.key}: --new-accounts given but AutoCount has an account for it (${acc.ok ? `${acc.debtor} / ${acc.advance}` : acc.why})`);
        }
        if (!acc.ok && !openNew) { notSeeded.push(`${o.key}: ${acc.why}`); console.log(`hold  ${o.key}: ${acc.why}`); continue; }
        const r = await importOrder(db, actor, Number(brand.id), o, proj.id, acc.ok ? acc : null);
        if (openNew) opened.push(`${o.key}: ${r.debtor} / ${r.advance}`);
        await db.q('insert into scm.app_config (key, value, description, company_id) values ($1, $2, $3, $4)',
          [NOTE + o.key, r.docNo, `In-house SO import (2 Nov 2026): ${r.docNo} for ${o.key}`, companyId]);
        total += r.contractSen;
        done.push(r.docNo);
        console.log(`order ${r.docNo} ${o.key} ${o.owner} project ${proj.code} ${rm(r.contractSen)}${o.pricePlaceholder ? ' (PLACEHOLDER price)' : ''} | ${r.debtor} / ${r.advance} (${acc.ok ? acc.how : 'NEW accounts opened'})`);
      }
      const after = (await tx`select (select count(*) from public.projects)::int projects, (select count(*) from scm.mfg_sales_orders where so_kind = 'RENOVATION')::int sos,
        (select count(*) from scm.debtors where code like '302-%')::int d302, (select count(*) from scm.accounts where account_code like '481-%')::int a481,
        (select count(*) from scm.mfg_sales_order_items where doc_no = any(${done}))::int items,
        (select count(*) from scm.reno_so_contracts where so_doc_no = any(${done}))::int contracts,
        (select coalesce(sum(local_total_sen), 0)::bigint from scm.mfg_sales_orders where doc_no = any(${done})) so_total`)[0];
      console.log(`\nprojects ${before.projects} -> ${after.projects} (+${made}); renovation SOs ${before.sos} -> ${after.sos} (+${done.length}); `
        + `items ${after.items}; contracts ${after.contracts}; SO header total ${rm(Number(after.so_total))}; contracts total ${rm(total)}; `
        + `302- customers ${before.d302} -> ${after.d302}; 481- advance accounts ${before.a481} -> ${after.a481}`);
      if (Number(after.so_total) !== total) throw new Error(`SO headers total ${after.so_total} but the contracts total ${total}`);
      if (DRY) throw new Rollback('dry run');
    });
    console.log(`${done.length} orders written.`);
    if (opened.length) console.log(`NEW accounts opened (${opened.length}):\n  ${opened.join('\n  ')}`);
    if (notSeeded.length) console.log(`NOT imported (${notSeeded.length}):\n  ${notSeeded.join('\n  ')}`);
  } catch (e) {
    if (e instanceof Rollback) {
      console.log(`DRY RUN: ${done.length} orders built and rolled back; nothing was written.`);
      if (opened.length) console.log(`would open NEW accounts (${opened.length}):\n  ${opened.join('\n  ')}`);
      if (notSeeded.length) console.log(`would NOT be imported (${notSeeded.length}):\n  ${notSeeded.join('\n  ')}`);
    }
    else throw e;
  }
} finally {
  await sql.end();
}
