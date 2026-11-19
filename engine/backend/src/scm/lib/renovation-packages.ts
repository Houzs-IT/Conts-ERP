/* Packages module (owner, 20 Nov 2026). A package template (scm.reno_quotation_templates, migration 0347) is one record of
   two kinds: a Package (PKG-, a whole unit, lines grouped by area) and a Kit (KIT-, a few items, usually no area). A package
   keeps products, quantities and SLA days only, never prices: the screen shows today's SKU Master selling price as a
   reference, and lines added to a sales order (through a variation order) take the SKU Master price at that moment.
   Only an Active one is offered in the sales order / variation order search. Cost and margin are never shown here. */

import { auditEntity, refuse, type RenoDb } from './renovation-db';
import { deleteStructure, insertSections, readSections, readSectionsMany, type DocSectionOut } from './renovation-doc-lines';
import type { NormSection } from './renovation-validate';
import type { RenoActor } from './renovation-quotation';
import { lineAmounts } from '../shared/renovation-money';

export const PACKAGE_KINDS = ['PACKAGE', 'KIT'] as const;
export const PACKAGE_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE'] as const;
export type PackageKind = (typeof PACKAGE_KINDS)[number];
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

export const codePrefixOf = (kind: PackageKind): string => (kind === 'KIT' ? 'KIT-' : 'PKG-');

/** The next free code of a kind: PKG-001, PKG-002 ... after the highest number already used. */
export function suggestCode(kind: PackageKind, existing: readonly string[]): string {
  const pfx = codePrefixOf(kind);
  let max = 0;
  for (const c of existing) {
    const m = new RegExp(`^${pfx}(\\d+)$`).exec(c.trim().toUpperCase());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${pfx}${String(max + 1).padStart(3, '0')}`;
}

export interface PackageHeader {
  kind: PackageKind;
  code: string;
  name: string;
  building: string;
  unitType: string;
  salesNote: string;
  status: PackageStatus;
}

/** The header fields of a save; only the ones present are checked. A code is letters, digits and - _ . / only. */
export function normalisePackageHeader(b: Record<string, unknown>, partial: boolean): { ok: true; value: Partial<PackageHeader> } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const out: Partial<PackageHeader> = {};
  const str = (k: string, max: number): string | undefined => {
    const v = b[k];
    if (v === undefined) return undefined;
    if (v !== null && typeof v !== 'string') { problems.push(`${k} must be text.`); return undefined; }
    const t = (v ?? '').trim();
    if (t.length > max) problems.push(`${k} is longer than ${max} characters.`);
    return t;
  };
  if (b.kind !== undefined) {
    if ((PACKAGE_KINDS as readonly unknown[]).includes(b.kind)) out.kind = b.kind as PackageKind;
    else problems.push('kind must be PACKAGE or KIT.');
  } else if (!partial) out.kind = 'PACKAGE';
  if (b.status !== undefined) {
    if ((PACKAGE_STATUSES as readonly unknown[]).includes(b.status)) out.status = b.status as PackageStatus;
    else problems.push('status must be DRAFT, ACTIVE or INACTIVE.');
  } else if (!partial) out.status = 'DRAFT';
  const code = str('code', 40);
  if (code !== undefined) {
    const c = code.toUpperCase();
    if (!c) problems.push('A package needs a code.');
    else if (!/^[A-Z0-9][A-Z0-9._/-]*$/.test(c)) problems.push('The code may hold letters, digits and - _ . / only.');
    out.code = c;
  }
  const name = str('name', 200);
  if (name !== undefined) {
    if (!name) problems.push('A package needs a name.');
    out.name = name;
  } else if (!partial) problems.push('A package needs a name.');
  const building = str('building', 200); if (building !== undefined) out.building = building;
  const unitType = str('unitType', 200); if (unitType !== undefined) out.unitType = unitType;
  const salesNote = str('salesNote', 1000); if (salesNote !== undefined) out.salesNote = salesNote;
  return problems.length ? { ok: false, problems } : { ok: true, value: out };
}

/** A package keeps products, quantities and SLA days: every price, cost, discount and supplier is dropped. */
export function stripPrices(sections: NormSection[]): NormSection[] {
  return sections.map((s) => ({
    ...s,
    lumpSumSen: null,
    lines: s.lines.map((l) => ({
      ...l, unitPriceSen: 0, listPriceSen: null, discountBp: 0, amountOverrideSen: null, isFoc: false, unitCostSen: 0, supplierId: null, fromPackageId: null,
    })),
  }));
}

export interface SkuRef { name: string; sellSen: number; costSen: number; supplierId: string | null; uom: string | null; active: boolean }

/** Today's SKU Master facts for the codes, keyed by code: the selling price as the product search gives it. */
export async function skuRefs(db: RenoDb, companyId: number, codes: readonly string[]): Promise<Map<string, SkuRef>> {
  const out = new Map<string, SkuRef>();
  const list = [...new Set(codes.filter(Boolean))];
  if (list.length === 0) return out;
  const rows = await db.q<{ code: string; name: string; sell_sen: number | null; cost_sen: number | null; supplier_id: string | null; uom: string | null; active: boolean }>(
    `select distinct on (p.code) p.code, p.name,
            case when p.category::text in ('BEDFRAME', 'SOFA', 'MATTRESS') then coalesce(p.sell_price_sen, 0)
                 else coalesce(p.sell_price_sen, p.base_price_sen, p.price1_sen, 0) end as sell_sen,
            coalesce(b.unit_price_sen, p.cost_price_sen, 0) as cost_sen, b.supplier_id, to_jsonb(p) ->> 'uom' as uom,
            (p.status::text = 'ACTIVE') as active
       from scm.mfg_products p
       left join lateral (select supplier_id, unit_price_sen from scm.supplier_material_bindings smb
                           where smb.item_code = p.code and smb.company_id = p.company_id
                           order by smb.is_main_supplier desc, smb.is_cost_anchor desc, smb.created_at limit 1) b on true
      where p.company_id = $1 and p.code = any(string_to_array($2, chr(31)))
      order by p.code, (p.status::text = 'ACTIVE') desc`,
    [companyId, list.join('\u001f')],
  );
  for (const r of rows) {
    out.set(r.code, { name: r.name, sellSen: Number(r.sell_sen ?? 0), costSen: Number(r.cost_sen ?? 0), supplierId: r.supplier_id, uom: r.uom, active: r.active });
  }
  return out;
}

const priced = (kind: string): boolean => kind === 'ITEM' || kind === 'CHILD';

/** What the package comes to at today's SKU prices (a product the catalog no longer has counts zero). */
export function totalAtSkuPrices(sections: DocSectionOut[], refs: Map<string, SkuRef>): number {
  let sum = 0;
  for (const s of sections) for (const l of s.lines) {
    if (!priced(l.kind) || !l.itemCode) continue;
    const price = refs.get(l.itemCode)?.sellSen ?? 0;
    sum += lineAmounts({ kind: l.kind, qty: l.qty, measureMilli: l.measureMilli, measureUom: l.measureUom, uom: l.uom, unitPriceSen: price, discountBp: 0, amountOverrideSen: null, isFoc: false }).netSen;
  }
  return sum;
}

export function productLines(sections: DocSectionOut[]) {
  return sections.flatMap((s) => s.lines.filter((l) => priced(l.kind)));
}

/** "SLA set": every product line carries at least one of its two days. */
export function slaSet(sections: DocSectionOut[]): boolean {
  const lines = productLines(sections);
  return lines.length > 0 && lines.every((l) => l.processingAfterDays != null || l.deliveryAfterDays != null);
}

/** Areas: sections with a heading and at least one line. */
export function areaCount(sections: DocSectionOut[]): number {
  return sections.filter((s) => s.heading.trim() && s.lines.length > 0).length;
}

interface HeadRow {
  id: string; code: string; kind: PackageKind; name: string; building: string; unit_type: string; sales_note: string; status: PackageStatus;
  updated_at: string; created_at: string;
}

const HEAD_COLS = `id, code, kind, name, building, unit_type, sales_note, status, updated_at::text as updated_at, created_at::text as created_at`;

function headOut(r: HeadRow) {
  return { id: r.id, code: r.code, kind: r.kind, name: r.name, building: r.building, unitType: r.unit_type, salesNote: r.sales_note, status: r.status, updatedAt: r.updated_at, createdAt: r.created_at };
}

async function usedCounts(db: RenoDb, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const rows = await db.q<{ pid: string; n: number }>(
    `select l.from_package_id::text as pid, count(distinct v.id)::int as n
       from scm.reno_doc_lines l
       join scm.reno_doc_sections s on s.id = l.section_id
       join scm.reno_variation_orders v on v.id = s.vo_id
      where l.from_package_id::text = any(string_to_array($1, ',')) and v.status <> 'CANCELLED'
      group by 1`,
    [ids.join(',')],
  );
  for (const r of rows) out.set(r.pid, Number(r.n));
  return out;
}

export async function listPackages(db: RenoDb, companyId: number) {
  const rows = await db.q<HeadRow>(`select ${HEAD_COLS} from scm.reno_quotation_templates where company_id = $1 order by code`, [companyId]);
  const ids = rows.map((r) => r.id);
  const structures = await readSectionsMany(db, 'template', ids);
  const codes = [...structures.values()].flatMap((ss) => productLines(ss).map((l) => l.itemCode ?? ''));
  const refs = await skuRefs(db, companyId, codes);
  const used = await usedCounts(db, ids);
  return rows.map((r) => {
    const ss = structures.get(r.id) ?? [];
    return {
      ...headOut(r), areas: areaCount(ss), lines: productLines(ss).length, totalSen: totalAtSkuPrices(ss, refs), slaSet: slaSet(ss), used: used.get(r.id) ?? 0,
    };
  });
}

async function readHead(db: RenoDb, id: string, companyId: number): Promise<HeadRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw refuse(404, 'package_not_found', 'That package does not exist.');
  const [r] = await db.q<HeadRow>(`select ${HEAD_COLS} from scm.reno_quotation_templates where id = $1 and company_id = $2`, [id, companyId]);
  if (!r) throw refuse(404, 'package_not_found', 'That package does not exist.');
  return r;
}

/** Sections with each product line's SKU Master reference (name, today's selling price); no cost. */
function withRefs(sections: DocSectionOut[], refs: Map<string, SkuRef>) {
  return sections.map((s) => ({
    ...s,
    lines: s.lines.map((l) => {
      const ref = l.itemCode ? refs.get(l.itemCode) : undefined;
      return { ...l, unitCostSen: 0, skuName: ref?.name ?? null, skuPriceSen: ref ? ref.sellSen : null, skuActive: ref ? ref.active : l.itemCode ? false : null };
    }),
  }));
}

export async function getPackage(db: RenoDb, id: string, companyId: number) {
  const h = await readHead(db, id, companyId);
  const sections = await readSections(db, { kind: 'template', id });
  const refs = await skuRefs(db, companyId, productLines(sections).map((l) => l.itemCode ?? ''));
  const usedIn = await db.q<{ vo_id: string; vo_no: string; so_doc_no: string; status: string; doc_date: string; project: string | null; n: number }>(
    `select v.id as vo_id, v.vo_no, v.so_doc_no, v.status, v.doc_date::text as doc_date, p.name as project, count(l.id)::int as n
       from scm.reno_doc_lines l
       join scm.reno_doc_sections s on s.id = l.section_id
       join scm.reno_variation_orders v on v.id = s.vo_id
       left join scm.mfg_sales_orders o on o.doc_no = v.so_doc_no
       left join public.projects p on p.id = o.project_id
      where l.from_package_id = $1 and l.kind in ('ITEM', 'CHILD')
      group by v.id, v.vo_no, v.so_doc_no, v.status, v.doc_date, p.name
      order by v.doc_date desc, v.vo_no desc`,
    [id],
  );
  const history = await db.q<{ at: string; who: string | null; action: string; note: string | null }>(
    `select created_at::text as at, actor_name_snapshot as who, action, note
       from scm.entity_audit_log where entity_type = 'reno_quotation_template' and entity_id = $1
      order by created_at desc limit 200`,
    [id],
  );
  return {
    ...headOut(h),
    sections: withRefs(sections, refs),
    totalSen: totalAtSkuPrices(sections, refs),
    slaSet: slaSet(sections),
    usedIn: usedIn.map((u) => ({ voId: u.vo_id, voNo: u.vo_no, soDocNo: u.so_doc_no, status: u.status, docDate: u.doc_date, project: u.project, lines: Number(u.n) })),
    history: history.map((r) => ({ at: r.at, who: r.who, action: r.action, note: r.note })),
  };
}

async function codeTaken(db: RenoDb, companyId: number, code: string, exceptId: string | null): Promise<boolean> {
  const r = await db.q(`select 1 from scm.reno_quotation_templates where company_id = $1 and upper(code) = upper($2) and ($3::uuid is null or id <> $3)`, [companyId, code, exceptId]);
  return r.length > 0;
}

async function nameTaken(db: RenoDb, companyId: number, name: string, exceptId: string | null): Promise<boolean> {
  const r = await db.q(`select 1 from scm.reno_quotation_templates where company_id = $1 and lower(name) = lower($2) and ($3::uuid is null or id <> $3)`, [companyId, name, exceptId]);
  return r.length > 0;
}

export async function nextCode(db: RenoDb, companyId: number, kind: PackageKind): Promise<string> {
  const rows = await db.q<{ code: string }>(`select code from scm.reno_quotation_templates where company_id = $1 and code like $2`, [companyId, `${codePrefixOf(kind)}%`]);
  return suggestCode(kind, rows.map((r) => r.code));
}

const STATUS_LABEL: Record<PackageStatus, string> = { DRAFT: 'Draft', ACTIVE: 'Active', INACTIVE: 'Inactive' };
const KIND_LABEL: Record<PackageKind, string> = { PACKAGE: 'Package', KIT: 'Kit' };

/** One line for History: what a save changed, in plain words. */
export function describeChange(before: PackageHeader & { lines: Array<{ code: string; qty: number }> }, after: Partial<PackageHeader> & { lines?: Array<{ code: string; qty: number }> }): string {
  const parts: string[] = [];
  const field = (label: string, a: string, b: string | undefined) => { if (b !== undefined && a !== b) parts.push(`${label} ${a || '(blank)'} to ${b || '(blank)'}`); };
  field('Code', before.code, after.code);
  field('Name', before.name, after.name);
  if (after.kind && after.kind !== before.kind) parts.push(`Kind ${KIND_LABEL[before.kind]} to ${KIND_LABEL[after.kind]}`);
  field('Building', before.building, after.building);
  field('Unit type', before.unitType, after.unitType);
  if (after.salesNote !== undefined && after.salesNote !== before.salesNote) parts.push('Note for sales changed');
  if (after.status && after.status !== before.status) parts.push(`Status ${STATUS_LABEL[before.status]} to ${STATUS_LABEL[after.status]}`);
  if (after.lines) {
    const qty = (ls: Array<{ code: string; qty: number }>) => { const m = new Map<string, number>(); for (const l of ls) m.set(l.code, (m.get(l.code) ?? 0) + l.qty); return m; };
    const a = qty(before.lines); const b = qty(after.lines);
    const added = [...b.keys()].filter((k) => !a.has(k));
    const removed = [...a.keys()].filter((k) => !b.has(k));
    const changed = [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k));
    if (added.length) parts.push(`Added ${added.slice(0, 5).join(', ')}${added.length > 5 ? ` and ${added.length - 5} more` : ''}`);
    if (removed.length) parts.push(`Removed ${removed.slice(0, 5).join(', ')}${removed.length > 5 ? ` and ${removed.length - 5} more` : ''}`);
    if (changed.length) parts.push(`Qty changed on ${changed.slice(0, 5).map((k) => `${k} ${a.get(k)} to ${b.get(k)}`).join(', ')}${changed.length > 5 ? ` and ${changed.length - 5} more` : ''}`);
    if (!added.length && !removed.length && !changed.length && before.lines.length === after.lines.length) parts.push('Lines rearranged or SLA days changed');
  }
  return parts.join('; ') || 'Saved, nothing changed';
}

const lineKeys = (sections: Array<{ lines: Array<{ kind: string; itemCode: string | null; qty: number }> }>) =>
  sections.flatMap((s) => s.lines.filter((l) => priced(l.kind) && l.itemCode).map((l) => ({ code: l.itemCode!, qty: l.qty })));

export interface PackageBody extends Partial<PackageHeader> { sections?: NormSection[]; fromSoDocNo?: string | null }

export async function createPackage(db: RenoDb, actor: RenoActor, body: PackageBody): Promise<{ id: string; code: string }> {
  const kind = body.kind ?? 'PACKAGE';
  const name = (body.name ?? '').trim();
  if (!name) throw refuse(400, 'name_required', 'A package needs a name.');
  const code = (body.code ?? '').trim().toUpperCase() || await nextCode(db, actor.companyId, kind);
  if (await codeTaken(db, actor.companyId, code, null)) throw refuse(409, 'code_taken', `The code ${code} is already used. Pick another one.`);
  if (await nameTaken(db, actor.companyId, name, null)) throw refuse(409, 'name_taken', `A package called "${name}" already exists.`);
  const sections = stripPrices(body.sections ?? []);
  if (body.status === 'ACTIVE' && lineKeys(sections).length === 0) throw refuse(422, 'no_lines', 'Add at least one product before activating.');
  const [t] = await db.q<{ id: string; code: string }>(
    `insert into scm.reno_quotation_templates (company_id, name, code, kind, building, unit_type, sales_note, status, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id, code`,
    [actor.companyId, name, code, kind, body.building ?? '', body.unitType ?? '', body.salesNote ?? '', body.status ?? 'DRAFT', actor.name],
  );
  await insertSections(db, { kind: 'template', id: t.id }, sections, actor.companyId);
  const n = lineKeys(sections).length;
  await auditEntity(db, {
    companyId: actor.companyId, entityType: 'reno_quotation_template', entityId: t.id, docNo: t.code, action: 'CREATE', actorName: actor.name,
    note: `Created ${KIND_LABEL[kind].toLowerCase()} ${t.code} (${STATUS_LABEL[body.status ?? 'DRAFT']}, ${n} line${n === 1 ? '' : 's'})${body.fromSoDocNo ? ` from ${body.fromSoDocNo}` : ''}`,
  });
  return { id: t.id, code: t.code };
}

export async function savePackage(db: RenoDb, actor: RenoActor, id: string, body: PackageBody): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw refuse(404, 'package_not_found', 'That package does not exist.');
  const [cur] = await db.q<HeadRow>(`select ${HEAD_COLS} from scm.reno_quotation_templates where id = $1 and company_id = $2 for update`, [id, actor.companyId]);
  if (!cur) throw refuse(404, 'package_not_found', 'That package does not exist.');
  if (body.code !== undefined && await codeTaken(db, actor.companyId, body.code, id)) throw refuse(409, 'code_taken', `The code ${body.code} is already used. Pick another one.`);
  if (body.name !== undefined && await nameTaken(db, actor.companyId, body.name, id)) throw refuse(409, 'name_taken', `A package called "${body.name}" already exists.`);
  const before = await readSections(db, { kind: 'template', id });
  const sections = body.sections ? stripPrices(body.sections) : undefined;
  const status = body.status ?? cur.status;
  if (status === 'ACTIVE' && lineKeys(sections ?? before).length === 0) throw refuse(422, 'no_lines', 'Add at least one product before activating.');
  await db.q(
    `update scm.reno_quotation_templates set
        code = coalesce($2, code), name = coalesce($3, name), kind = coalesce($4, kind), building = coalesce($5, building),
        unit_type = coalesce($6, unit_type), sales_note = coalesce($7, sales_note), status = coalesce($8, status), updated_at = now()
      where id = $1`,
    [id, body.code ?? null, body.name ?? null, body.kind ?? null, body.building ?? null, body.unitType ?? null, body.salesNote ?? null, body.status ?? null],
  );
  if (sections) {
    await deleteStructure(db, { kind: 'template', id }, { instalments: false });
    await insertSections(db, { kind: 'template', id }, sections, actor.companyId);
  }
  const note = describeChange(
    { kind: cur.kind, code: cur.code, name: cur.name, building: cur.building, unitType: cur.unit_type, salesNote: cur.sales_note, status: cur.status, lines: lineKeys(before) },
    { ...body, lines: sections ? lineKeys(sections) : undefined },
  );
  await auditEntity(db, { companyId: actor.companyId, entityType: 'reno_quotation_template', entityId: id, docNo: body.code ?? cur.code, action: 'UPDATE', actorName: actor.name, note });
}

/** Active packages and kits matching the words (code, name, building, or a product code in them), for the SO / VO search. */
export async function searchPackages(db: RenoDb, companyId: number, q: string, limit = 12) {
  const rows = await db.q<HeadRow>(
    `select ${HEAD_COLS} from scm.reno_quotation_templates t
      where t.company_id = $1 and t.status = 'ACTIVE'
        and ($2 = '' or t.code ilike '%' || $2 || '%' or t.name ilike '%' || $2 || '%' or t.building ilike '%' || $2 || '%'
             or exists (select 1 from scm.reno_doc_sections s join scm.reno_doc_lines l on l.section_id = s.id
                         where s.template_id = t.id and (l.item_code ilike '%' || $2 || '%' or s.heading ilike '%' || $2 || '%')))
      order by (t.code ilike $2 || '%') desc, t.kind desc, t.code
      limit $3`,
    [companyId, q.trim(), limit],
  );
  const ids = rows.map((r) => r.id);
  const structures = await readSectionsMany(db, 'template', ids);
  const refs = await skuRefs(db, companyId, [...structures.values()].flatMap((ss) => productLines(ss).map((l) => l.itemCode ?? '')));
  return rows.map((r) => {
    const ss = structures.get(r.id) ?? [];
    const lines = productLines(ss);
    return {
      id: r.id, code: r.code, kind: r.kind, name: r.name, building: r.building,
      areas: areaCount(ss), lines: lines.length, totalSen: totalAtSkuPrices(ss, refs),
      areaNames: ss.filter((s) => s.heading.trim() && s.lines.length).map((s) => s.heading),
      itemCodes: lines.map((l) => (l.qty > 1 ? `${l.itemCode} x${l.qty}` : l.itemCode ?? '')).filter(Boolean),
    };
  });
}

/** The package's lines as they would go into a sales order today: SKU Master price, supplier and unit; quantities and
    SLA days from the package. Cost travels for the PO split (the VO screen already holds it), never shown here. */
export async function expandPackage(db: RenoDb, id: string, companyId: number) {
  const h = await readHead(db, id, companyId);
  if (h.status !== 'ACTIVE') throw refuse(409, 'package_not_active', `${h.code} is ${STATUS_LABEL[h.status].toLowerCase()}: only an active package can be added.`);
  const sections = await readSections(db, { kind: 'template', id });
  const refs = await skuRefs(db, companyId, productLines(sections).map((l) => l.itemCode ?? ''));
  return {
    ...headOut(h),
    sections: sections.filter((s) => s.lines.length > 0).map((s) => ({
      heading: s.heading,
      bandColor: s.bandColor,
      pageBreakBefore: false,
      lumpSumSen: null,
      lines: s.lines.map((l) => {
        const ref = l.itemCode ? refs.get(l.itemCode) : undefined;
        const p = priced(l.kind);
        return {
          kind: l.kind, room: l.room, itemCode: l.itemCode, description: l.description || ref?.name || '', qty: l.qty,
          measure: l.measure, measureUom: l.measureUom, uom: ref?.uom ?? l.uom,
          unitPriceSen: p ? (ref?.sellSen ?? 0) : 0, listPriceSen: null, discountBp: 0, amountOverrideSen: null, isFoc: false, supplyByOwner: l.supplyByOwner,
          highlight: l.highlight, supplierId: p ? (ref?.supplierId ?? null) : null, unitCostSen: p ? (ref?.costSen ?? 0) : 0, stageCode: l.stageCode,
          processingAfterDays: l.processingAfterDays, deliveryAfterDays: l.deliveryAfterDays, pageBreakBefore: false, fromPackageId: id,
          skuActive: ref ? ref.active : !l.itemCode ? null : false,
        };
      }),
    })),
  };
}
