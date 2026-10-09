/* Shape and rule checks for renovation document bodies (quotation revision,
   package template, variation order). Pure: no database. The route parses the
   JSON, this turns it into normalised sections / lines / instalments or a list
   of plain-English problems, and only then does anything touch the database. */

import { z } from 'zod';
import { isUom, UOMS } from '../shared/renovation-catalog';
import { isStageKey } from '../shared/renovation-stages';
import { instalmentPctError, parseMeasureMilli, type RenoLineKind } from '../shared/renovation-money';

export const PRINT_FORMATS = ['AMOUNT', 'UNIT_PRICE', 'DISCOUNT', 'QTY_ONLY', 'PROMO_STANDARD'] as const;
export type PrintFormat = (typeof PRINT_FORMATS)[number];
export const INSTALMENT_TRIGGERS = ['so_confirmed', 'stage_start', 'stage_done'] as const;
export const PO_PAYABLE_ON = ['ON_CONFIRM', 'ON_RECEIPT', 'ON_HANDOVER', 'MANUAL'] as const;
/* Codes the documents write themselves; never typed on a line. */
export const RESERVED_ITEM_CODES = ['RENO-ADJUST', 'RENO-DISCOUNT', 'RENO-PROGRESS'] as const;

const int = z.number().int();
const money = int.min(-2_000_000_000).max(2_000_000_000);

const lineSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(['ITEM', 'CHILD', 'DETAIL', 'TEXT']),
  room: z.string().max(100).optional().default(''),
  itemCode: z.string().max(80).nullable().optional(),
  description: z.string().max(500).optional().default(''),
  qty: int.min(0).max(1_000_000).optional().default(1),
  measure: z.union([z.string(), z.number()]).nullable().optional(),
  measureUom: z.string().nullable().optional(),
  uom: z.string().nullable().optional(),
  unitPriceSen: money.optional().default(0),
  listPriceSen: money.nullable().optional(),
  discountBp: int.min(0).max(10000).optional().default(0),
  amountOverrideSen: money.nullable().optional(),
  isFoc: z.boolean().optional().default(false),
  supplyByOwner: z.boolean().optional().default(false),
  highlight: z.enum(['NONE', 'GREY', 'PINK']).optional().default('NONE'),
  supplierId: z.string().uuid().nullable().optional(),
  unitCostSen: int.min(0).max(2_000_000_000).optional().default(0),
  stageCode: z.string().nullable().optional(),
  pageBreakBefore: z.boolean().optional().default(false),
  voChange: z.enum(['ADD', 'OMIT']).nullable().optional(),
  omitTargetLineId: z.string().uuid().nullable().optional(),
  omitQty: int.min(1).nullable().optional(),
});

const sectionSchema = z.object({
  id: z.string().uuid().optional(),
  heading: z.string().max(200).optional().default(''),
  bandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  lumpSumSen: money.nullable().optional(),
  pageBreakBefore: z.boolean().optional().default(false),
  lines: z.array(lineSchema).max(500).optional().default([]),
});

const instalmentSchema = z.object({
  seq: int.min(1).max(99),
  label: z.string().max(100).optional().default(''),
  pctBp: int.min(1).max(10000),
  description: z.string().max(1000).optional().default(''),
  stageCode: z.string().nullable().optional(),
  trigger: z.enum(INSTALMENT_TRIGGERS).optional().default('stage_start'),
});

export interface NormLine {
  id: string;
  parentId: string | null;
  kind: RenoLineKind;
  sortOrder: number;
  room: string;
  itemCode: string | null;
  description: string;
  qty: number;
  measureMilli: number | null;
  measureUom: string | null;
  uom: string | null;
  unitPriceSen: number;
  listPriceSen: number | null;
  discountBp: number;
  amountOverrideSen: number | null;
  isFoc: boolean;
  supplyByOwner: boolean;
  highlight: 'NONE' | 'GREY' | 'PINK';
  supplierId: string | null;
  unitCostSen: number;
  stageCode: string | null;
  pageBreakBefore: boolean;
  voChange: 'ADD' | 'OMIT' | null;
  omitTargetLineId: string | null;
  omitQty: number | null;
  soItemId?: string | null;
}

export interface NormSection {
  id: string;
  heading: string;
  bandColor: string | null;
  sortOrder: number;
  lumpSumSen: number | null;
  pageBreakBefore: boolean;
  soItemId?: string | null;
  lines: NormLine[];
}

export interface NormInstalment {
  seq: number;
  label: string;
  pctBp: number;
  description: string;
  stageCode: string | null;
  trigger: (typeof INSTALMENT_TRIGGERS)[number];
}

export type Normalised<T> = { ok: true; value: T } | { ok: false; problems: string[] };

const newId = () => crypto.randomUUID();
const measureUoms = UOMS.filter((u) => u.measure).map((u) => u.code);

/** Sections and lines of an editable document. `mode` 'vo' allows OMIT lines and
    refuses lump-sum sections; every other mode refuses VO fields. */
export function normaliseSections(input: unknown, mode: 'doc' | 'vo' = 'doc'): Normalised<NormSection[]> {
  const parsed = z.array(sectionSchema).max(100).safeParse(input ?? []);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`) };
  }
  const problems: string[] = [];
  const sections: NormSection[] = parsed.data.map((s, si) => {
    const where = `Section ${si + 1}${s.heading ? ` (${s.heading})` : ''}`;
    if (mode === 'vo' && s.lumpSumSen != null) problems.push(`${where}: a variation order section cannot be a lump sum.`);
    let lastItemId: string | null = null;
    const lines: NormLine[] = s.lines.map((l, li) => {
      const at = `${where}, line ${li + 1}`;
      const id = newId();
      let parentId: string | null = null;
      if (l.kind === 'ITEM') lastItemId = id;
      if (l.kind === 'CHILD') {
        if (!lastItemId) problems.push(`${at}: an add-on line must follow the item it belongs to.`);
        parentId = lastItemId;
      }
      if (l.kind === 'DETAIL') parentId = lastItemId;
      const measureMilli = parseMeasureMilli(l.measure ?? null);
      if (measureMilli !== null && Number.isNaN(measureMilli)) problems.push(`${at}: measure must be a number with at most 3 decimals.`);
      const measureUom = measureMilli === null ? null : String(l.measureUom ?? 'FT').toUpperCase();
      if (measureUom !== null && !measureUoms.includes(measureUom)) problems.push(`${at}: measure unit must be one of ${measureUoms.join(', ')}.`);
      const uom = l.uom ? String(l.uom).toUpperCase() : null;
      if (uom !== null && !isUom(uom)) problems.push(`${at}: unknown unit ${uom}.`);
      const itemCode = l.itemCode ? l.itemCode.trim().toUpperCase() : null;
      if (itemCode && (RESERVED_ITEM_CODES as readonly string[]).includes(itemCode)) problems.push(`${at}: ${itemCode} is written by the system and cannot be picked.`);
      if (l.stageCode && !isStageKey(l.stageCode)) problems.push(`${at}: unknown stage ${l.stageCode}.`);
      const priced = l.kind === 'ITEM' || l.kind === 'CHILD';
      if (!priced && (l.unitPriceSen || l.amountOverrideSen != null || l.isFoc)) problems.push(`${at}: description and text lines carry no price.`);
      if (mode !== 'vo' && (l.voChange || l.omitTargetLineId || l.omitQty != null)) problems.push(`${at}: variation fields belong on a variation order.`);
      if (mode === 'vo' && l.voChange === 'OMIT' && !l.omitTargetLineId) problems.push(`${at}: an omit line names the contract line it omits.`);
      if (l.isFoc && l.amountOverrideSen != null) problems.push(`${at}: a FOC line cannot also carry a typed amount.`);
      return {
        id,
        parentId,
        kind: l.kind,
        sortOrder: li + 1,
        room: l.room.trim(),
        itemCode,
        description: l.description.trim(),
        qty: l.qty,
        measureMilli: measureMilli !== null && !Number.isNaN(measureMilli) ? measureMilli : null,
        measureUom: measureMilli !== null && !Number.isNaN(measureMilli) ? measureUom : null,
        uom,
        unitPriceSen: l.unitPriceSen,
        listPriceSen: l.listPriceSen ?? null,
        discountBp: l.discountBp,
        amountOverrideSen: l.amountOverrideSen ?? null,
        isFoc: l.isFoc,
        supplyByOwner: l.supplyByOwner,
        highlight: l.highlight,
        supplierId: l.supplierId ?? null,
        unitCostSen: l.unitCostSen,
        stageCode: l.stageCode ?? null,
        pageBreakBefore: l.pageBreakBefore,
        voChange: mode === 'vo' ? (l.voChange ?? 'ADD') : null,
        omitTargetLineId: mode === 'vo' ? (l.omitTargetLineId ?? null) : null,
        omitQty: mode === 'vo' ? (l.omitQty ?? null) : null,
      };
    });
    return {
      id: newId(),
      heading: s.heading.trim(),
      bandColor: s.bandColor ?? null,
      sortOrder: si + 1,
      lumpSumSen: s.lumpSumSen ?? null,
      pageBreakBefore: s.pageBreakBefore,
      lines,
    };
  });
  return problems.length ? { ok: false, problems } : { ok: true, value: sections };
}

export function normaliseInstalments(input: unknown): Normalised<NormInstalment[]> {
  const parsed = z.array(instalmentSchema).max(20).safeParse(input ?? []);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((i) => `instalments.${i.path.join('.')}: ${i.message}`) };
  }
  const problems: string[] = [];
  for (const r of parsed.data) if (r.stageCode && !isStageKey(r.stageCode)) problems.push(`Instalment ${r.seq}: unknown stage ${r.stageCode}.`);
  if (parsed.data.length > 0) {
    const pctErr = instalmentPctError(parsed.data);
    if (pctErr) problems.push(pctErr);
  }
  const value = parsed.data
    .map((r) => ({ seq: r.seq, label: r.label.trim(), pctBp: r.pctBp, description: r.description.trim(), stageCode: r.stageCode ?? null, trigger: r.trigger }))
    .sort((a, b) => a.seq - b.seq);
  return problems.length ? { ok: false, problems } : { ok: true, value };
}

const headerSchema = z.object({
  printFormat: z.enum(PRINT_FORMATS).optional(),
  attention: z.string().max(200).optional(),
  customerName: z.string().max(200).optional(),
  customerPhone: z.string().max(50).optional(),
  customerEmail: z.string().max(200).optional(),
  building: z.string().max(200).optional(),
  unitNo: z.string().max(50).optional(),
  preparedBy: z.string().max(100).optional(),
  docDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lastAmended: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  intro: z.string().max(1000).nullable().optional(),
  termsNote: z.string().max(4000).optional(),
  termTemplateId: z.string().uuid().nullable().optional(),
  docDiscountSen: int.min(0).max(2_000_000_000).optional(),
  docDiscountLabel: z.string().max(200).optional(),
  promoLines: z.array(z.object({ text: z.string().max(300), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional() })).max(20).optional(),
  brandId: z.number().int().positive().nullable().optional(),
});
export type DocHeaderInput = z.infer<typeof headerSchema>;

export function normaliseHeader(input: unknown): Normalised<DocHeaderInput> {
  const parsed = headerSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  return { ok: true, value: parsed.data };
}

const poScheduleSchema = z.array(z.object({
  seq: int.min(1).max(20),
  label: z.string().min(1).max(100),
  pctBp: int.min(1).max(10000),
  payableOn: z.enum(PO_PAYABLE_ON),
})).min(1).max(10);

export function normalisePoSchedule(input: unknown): Normalised<Array<{ seq: number; label: string; pctBp: number; payableOn: (typeof PO_PAYABLE_ON)[number] }>> {
  const parsed = poScheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  const err = instalmentPctError(parsed.data);
  if (err) return { ok: false, problems: [err] };
  return { ok: true, value: [...parsed.data].sort((a, b) => a.seq - b.seq) };
}
