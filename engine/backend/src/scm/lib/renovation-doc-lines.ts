/* Read and write the shared section / line / instalment structure
   (scm.reno_doc_sections, scm.reno_doc_lines, scm.reno_doc_instalments) for one
   owner: a quotation template, a quotation revision, a sales order (contract) or
   a variation order. Writes replace the owner's whole structure in two inserts
   (ids are minted here so parents resolve without a round trip per line). */

import type { RenoDb } from './renovation-db';
import type { NormInstalment, NormLine, NormSection } from './renovation-validate';
import { docTotals, lineAmounts, parseMeasureMilli, type MoneyLine } from '../shared/renovation-money';

export type DocOwner =
  | { kind: 'template'; id: string }
  | { kind: 'revision'; id: string }
  | { kind: 'so'; id: string }
  | { kind: 'vo'; id: string };

const OWNER_COL: Record<DocOwner['kind'], string> = {
  template: 'template_id',
  revision: 'revision_id',
  so: 'so_doc_no',
  vo: 'vo_id',
};

export interface DocLineOut extends NormLine {
  measure: string | null;
  baseSen: number;
  netSen: number;
  overridden: boolean;
  soItemId: string | null;
  voId: string | null;
  omittedByVoId: string | null;
  soItemCancelled?: boolean;
}

export interface DocSectionOut extends Omit<NormSection, 'lines'> {
  voId: string | null;
  lines: DocLineOut[];
}

export async function deleteStructure(db: RenoDb, owner: DocOwner, opts: { instalments?: boolean } = {}): Promise<void> {
  const col = OWNER_COL[owner.kind];
  await db.q(`delete from scm.reno_doc_sections where ${col} = $1`, [owner.id]);
  if (opts.instalments !== false && owner.kind !== 'vo') {
    await db.q(`delete from scm.reno_doc_instalments where ${col} = $1`, [owner.id]);
  }
}

/** Insert sections and their lines for `owner`. Ids and parent ids come from
    the normalised input; `voId` tags contract sections a VO appended. */
export async function insertSections(
  db: RenoDb,
  owner: DocOwner,
  sections: NormSection[],
  companyId: number,
  opts: { voId?: string | null; sortOffset?: number } = {},
): Promise<void> {
  if (sections.length === 0) return;
  const col = OWNER_COL[owner.kind];
  const sectionRows = sections.map((s, i) => ({
    id: s.id,
    heading: s.heading,
    band_color: s.bandColor,
    sort_order: (opts.sortOffset ?? 0) + (s.sortOrder || i + 1),
    lump_sum_sen: s.lumpSumSen,
    page_break_before: s.pageBreakBefore,
    so_item_id: s.soItemId ?? null,
  }));
  // A VO's own (draft) section is owned by the VO; a contract section a VO
  // appended on approval is owned by the SO and remembers the VO.
  await db.q(
    `insert into scm.reno_doc_sections (id, company_id, ${col}, added_by_vo_id, heading, band_color, sort_order, lump_sum_sen, page_break_before, so_item_id)
     select x.id, $2, $3, $4::uuid, x.heading, x.band_color, x.sort_order, x.lump_sum_sen, x.page_break_before, x.so_item_id
       from jsonb_to_recordset($1::text::jsonb) as x(id uuid, heading text, band_color text, sort_order int, lump_sum_sen int, page_break_before boolean, so_item_id uuid)`,
    [JSON.stringify(sectionRows), companyId, owner.id, owner.kind === 'so' ? (opts.voId ?? null) : null],
  );
  const lineRows = sections.flatMap((s) => s.lines.map((l) => ({
    id: l.id,
    section_id: s.id,
    parent_line_id: l.parentId,
    kind: l.kind,
    sort_order: l.sortOrder,
    room: l.room,
    item_code: l.itemCode,
    description: l.description,
    qty: l.qty,
    measure: l.measureMilli === null ? null : (l.measureMilli / 1000).toFixed(3),
    measure_uom: l.measureUom,
    uom: l.uom,
    unit_price_sen: l.unitPriceSen,
    list_price_sen: l.listPriceSen,
    discount_bp: l.discountBp,
    amount_override_sen: l.amountOverrideSen,
    is_foc: l.isFoc,
    supply_by_owner: l.supplyByOwner,
    highlight: l.highlight,
    supplier_id: l.supplierId,
    unit_cost_sen: l.unitCostSen,
    stage_code: l.stageCode,
    page_break_before: l.pageBreakBefore,
    so_item_id: l.soItemId ?? null,
    vo_id: owner.kind === 'vo' ? owner.id : (opts.voId ?? null),
    vo_change: l.voChange ?? (opts.voId ? 'ADD' : null),
    omit_target_line_id: l.omitTargetLineId,
    omit_qty: l.omitQty,
  })));
  if (lineRows.length === 0) return;
  // Parents first: an ITEM row must exist before its CHILD rows reference it.
  const ordered = [...lineRows.filter((r) => !r.parent_line_id), ...lineRows.filter((r) => r.parent_line_id)];
  await db.q(
    `insert into scm.reno_doc_lines (id, company_id, section_id, parent_line_id, kind, sort_order, room, item_code, description, qty,
        measure, measure_uom, uom, unit_price_sen, list_price_sen, discount_bp, amount_override_sen, is_foc, supply_by_owner, highlight,
        supplier_id, unit_cost_sen, stage_code, page_break_before, so_item_id, vo_id, vo_change, omit_target_line_id, omit_qty)
     select x.id, $2, x.section_id, x.parent_line_id, x.kind, x.sort_order, x.room, x.item_code, x.description, x.qty,
        x.measure, x.measure_uom, x.uom, x.unit_price_sen, x.list_price_sen, x.discount_bp, x.amount_override_sen, x.is_foc, x.supply_by_owner, x.highlight,
        x.supplier_id, x.unit_cost_sen, x.stage_code, x.page_break_before, x.so_item_id, x.vo_id, x.vo_change, x.omit_target_line_id, x.omit_qty
       from jsonb_to_recordset($1::text::jsonb) as x(id uuid, section_id uuid, parent_line_id uuid, kind text, sort_order int, room text, item_code text,
        description text, qty int, measure numeric, measure_uom text, uom text, unit_price_sen int, list_price_sen int, discount_bp int,
        amount_override_sen int, is_foc boolean, supply_by_owner boolean, highlight text, supplier_id uuid, unit_cost_sen int, stage_code text,
        page_break_before boolean, so_item_id uuid, vo_id uuid, vo_change text, omit_target_line_id uuid, omit_qty int)`,
    [JSON.stringify(ordered), companyId],
  );
}

export async function insertInstalments(db: RenoDb, owner: DocOwner, rows: NormInstalment[], companyId: number): Promise<void> {
  if (owner.kind === 'vo' || rows.length === 0) return;
  const col = OWNER_COL[owner.kind];
  await db.q(
    `insert into scm.reno_doc_instalments (company_id, ${col}, seq, label, pct_bp, description, stage_code, trigger)
     select $2, $3, x.seq, x.label, x.pct_bp, x.description, x.stage_code, x.trigger
       from jsonb_to_recordset($1::text::jsonb) as x(seq int, label text, pct_bp int, description text, stage_code text, trigger text)`,
    [JSON.stringify(rows.map((r) => ({ seq: r.seq, label: r.label, pct_bp: r.pctBp, description: r.description, stage_code: r.stageCode, trigger: r.trigger }))), companyId, owner.id],
  );
}

interface LineRow {
  id: string; section_id: string; parent_line_id: string | null; kind: NormLine['kind']; sort_order: number; room: string;
  item_code: string | null; description: string; qty: number; measure: string | null; measure_uom: string | null; uom: string | null;
  unit_price_sen: number; list_price_sen: number | null; discount_bp: number; amount_override_sen: number | null; is_foc: boolean;
  supply_by_owner: boolean; highlight: NormLine['highlight']; supplier_id: string | null; unit_cost_sen: number; stage_code: string | null;
  page_break_before: boolean; so_item_id: string | null; vo_id: string | null; vo_change: 'ADD' | 'OMIT' | null;
  omit_target_line_id: string | null; omit_qty: number | null; omitted_by_vo_id: string | null; so_item_cancelled: boolean | null;
}

export function lineOut(r: LineRow): DocLineOut {
  const measureMilli = r.measure === null ? null : parseMeasureMilli(String(Number(r.measure)));
  const l: DocLineOut = {
    id: r.id,
    parentId: r.parent_line_id,
    kind: r.kind,
    sortOrder: Number(r.sort_order),
    room: r.room,
    itemCode: r.item_code,
    description: r.description,
    qty: Number(r.qty),
    measureMilli,
    measure: measureMilli === null ? null : String(Number(r.measure)),
    measureUom: r.measure_uom,
    uom: r.uom,
    unitPriceSen: Number(r.unit_price_sen),
    listPriceSen: r.list_price_sen === null ? null : Number(r.list_price_sen),
    discountBp: Number(r.discount_bp),
    amountOverrideSen: r.amount_override_sen === null ? null : Number(r.amount_override_sen),
    isFoc: r.is_foc,
    supplyByOwner: r.supply_by_owner,
    highlight: r.highlight,
    supplierId: r.supplier_id,
    unitCostSen: Number(r.unit_cost_sen),
    stageCode: r.stage_code,
    pageBreakBefore: r.page_break_before,
    voChange: r.vo_change,
    omitTargetLineId: r.omit_target_line_id,
    omitQty: r.omit_qty === null ? null : Number(r.omit_qty),
    soItemId: r.so_item_id,
    voId: r.vo_id,
    omittedByVoId: r.omitted_by_vo_id,
    baseSen: 0,
    netSen: 0,
    overridden: false,
  };
  if (r.so_item_cancelled !== null && r.so_item_cancelled !== undefined) l.soItemCancelled = r.so_item_cancelled;
  const a = lineAmounts(toMoneyLine(l));
  l.baseSen = a.baseSen;
  l.netSen = a.netSen;
  l.overridden = a.overridden;
  return l;
}

export function toMoneyLine(l: Pick<NormLine, 'kind' | 'qty' | 'measureMilli' | 'measureUom' | 'uom' | 'unitPriceSen' | 'discountBp' | 'amountOverrideSen' | 'isFoc'>): MoneyLine {
  return {
    kind: l.kind, qty: l.qty, measureMilli: l.measureMilli, measureUom: l.measureUom, uom: l.uom,
    unitPriceSen: l.unitPriceSen, discountBp: l.discountBp, amountOverrideSen: l.amountOverrideSen, isFoc: l.isFoc,
  };
}

export async function readSections(db: RenoDb, owner: DocOwner): Promise<DocSectionOut[]> {
  return (await readSectionsMany(db, owner.kind, [owner.id])).get(owner.id) ?? [];
}

/** Structures of many owners of one kind in two queries (lists, totals). */
export async function readSectionsMany(db: RenoDb, kind: DocOwner['kind'], ids: string[]): Promise<Map<string, DocSectionOut[]>> {
  const out = new Map<string, DocSectionOut[]>();
  if (ids.length === 0) return out;
  const col = OWNER_COL[kind];
  const idList = ids.join(',');
  const sections = await db.q<{
    id: string; owner_id: string; heading: string; band_color: string | null; sort_order: number; lump_sum_sen: number | null;
    page_break_before: boolean; so_item_id: string | null; added_by_vo_id: string | null;
  }>(
    `select id, ${col}::text as owner_id, heading, band_color, sort_order, lump_sum_sen, page_break_before, so_item_id, added_by_vo_id
       from scm.reno_doc_sections where ${col}::text = any(string_to_array($1, ',')) order by sort_order, created_at, id`,
    [idList],
  );
  if (sections.length === 0) return out;
  const lines = await db.q<LineRow>(
    `select l.id, l.section_id, l.parent_line_id, l.kind, l.sort_order, l.room, l.item_code, l.description, l.qty, l.measure::text as measure,
            l.measure_uom, l.uom, l.unit_price_sen, l.list_price_sen, l.discount_bp, l.amount_override_sen, l.is_foc, l.supply_by_owner,
            l.highlight, l.supplier_id, l.unit_cost_sen, l.stage_code, l.page_break_before, l.so_item_id, l.vo_id, l.vo_change,
            l.omit_target_line_id, l.omit_qty, l.omitted_by_vo_id, i.cancelled as so_item_cancelled
       from scm.reno_doc_lines l
       join scm.reno_doc_sections s on s.id = l.section_id
       left join scm.mfg_sales_order_items i on i.id = l.so_item_id
      where s.${col}::text = any(string_to_array($1, ','))
      order by l.sort_order, l.created_at, l.id`,
    [idList],
  );
  const bySection = new Map<string, DocLineOut[]>();
  for (const r of lines) {
    const list = bySection.get(r.section_id) ?? [];
    list.push(lineOut(r));
    bySection.set(r.section_id, list);
  }
  for (const s of sections) {
    const list = out.get(s.owner_id) ?? [];
    list.push({
      id: s.id,
      heading: s.heading,
      bandColor: s.band_color,
      sortOrder: Number(s.sort_order),
      lumpSumSen: s.lump_sum_sen === null ? null : Number(s.lump_sum_sen),
      pageBreakBefore: s.page_break_before,
      soItemId: s.so_item_id,
      voId: s.added_by_vo_id,
      lines: bySection.get(s.id) ?? [],
    });
    out.set(s.owner_id, list);
  }
  return out;
}

export async function readInstalments(db: RenoDb, owner: DocOwner): Promise<Array<NormInstalment & { id: string }>> {
  if (owner.kind === 'vo') return [];
  const col = OWNER_COL[owner.kind];
  const rows = await db.q<{ id: string; seq: number; label: string; pct_bp: number; description: string; stage_code: string | null; trigger: NormInstalment['trigger'] }>(
    `select id, seq, label, pct_bp, description, stage_code, trigger from scm.reno_doc_instalments where ${col} = $1 order by seq`,
    [owner.id],
  );
  return rows.map((r) => ({ id: r.id, seq: Number(r.seq), label: r.label, pctBp: Number(r.pct_bp), description: r.description, stageCode: r.stage_code, trigger: r.trigger }));
}

/** Totals of a structure, skipping lines a VO omitted. */
export function totalsOf(sections: Array<Pick<DocSectionOut, 'lumpSumSen'> & { lines: Array<DocLineOut | NormLine> }>, docDiscountSen = 0) {
  return docTotals(
    sections.map((s) => ({
      lumpSumSen: s.lumpSumSen,
      lines: s.lines
        .filter((l) => !('omittedByVoId' in l && l.omittedByVoId) && !('soItemCancelled' in l && l.soItemCancelled))
        .map((l) => toMoneyLine(l)),
    })),
    docDiscountSen,
  );
}

/** Deep copy of a structure with fresh ids (for revisions, templates, conversion). */
export function cloneSections(sections: DocSectionOut[], opts: { keepVoTags?: boolean; dropOmitted?: boolean } = {}): NormSection[] {
  return sections.map((s) => {
    const idMap = new Map<string, string>();
    const kept = s.lines.filter((l) => !(opts.dropOmitted && (l.omittedByVoId || l.soItemCancelled)));
    for (const l of kept) idMap.set(l.id, crypto.randomUUID());
    return {
      id: crypto.randomUUID(),
      heading: s.heading,
      bandColor: s.bandColor,
      sortOrder: s.sortOrder,
      lumpSumSen: s.lumpSumSen,
      pageBreakBefore: s.pageBreakBefore,
      lines: kept.map((l) => ({
        ...l,
        id: idMap.get(l.id)!,
        parentId: l.parentId ? (idMap.get(l.parentId) ?? null) : null,
        soItemId: null,
        voChange: opts.keepVoTags ? l.voChange : null,
        omitTargetLineId: opts.keepVoTags ? l.omitTargetLineId : null,
        omitQty: opts.keepVoTags ? l.omitQty : null,
      })),
    };
  });
}
