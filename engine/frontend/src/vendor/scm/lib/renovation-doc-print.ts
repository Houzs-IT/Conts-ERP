/* Renovation mode (Conts, 14 Oct 2026, "batch 4"; mig 0116): what a delivery order, sales invoice, purchase
   order or goods receipt carries from its sales order, for the page and the print. Read from
   GET <document>/:id/renovation-info (engine/backend/src/scm/routes/renovation-doc-flow.ts). Pure. */

import { RENOVATION_GROUPS, SUB_CATEGORIES } from '../../shared/renovation-catalog';

export interface RenoDocLine { room: string; categoryGroup: string; subCategory: string }
export interface RenoDocInfo {
  ready: boolean;
  info: {
    projectId: number | null;
    projectCode: string | null;
    projectName: string | null;
    building: string;
    unitNo: string;
    soDocNos: string[];
    poNumbers: string[];
    /** A renovation PO's one category (and sub-category while its lines share one); '' elsewhere. */
    categoryGroup?: string;
    subCategory?: string;
  } | null;
  lines: Record<string, RenoDocLine>;
}

/** "RN-2610-001 · Vista Harmoni B-8-2", or null without a project. */
export function renoProjectLabel(d: RenoDocInfo | null | undefined): string | null {
  const i = d?.info;
  if (!i || i.projectId == null) return null;
  return [i.projectCode, i.projectName].filter(Boolean).join(' · ') || `#${i.projectId}`;
}

/** "Works / Electrical" label of a line's category (the catalog's names), '' when none. */
export function renoCategoryLabel(l: RenoDocLine | undefined): string {
  if (!l) return '';
  const group = RENOVATION_GROUPS.find((g) => g.code === l.categoryGroup)?.label ?? l.categoryGroup;
  const sub = SUB_CATEGORIES.find((s) => s.group === l.categoryGroup && s.code === l.subCategory)?.label ?? l.subCategory.replace(/_/g, ' ');
  return [group, sub].filter(Boolean).join(' / ');
}

/** Rows for a print's details column: Project, Building, Unit (null rows are skipped by drawInfoColumns). */
export function renoDetailRows(d: RenoDocInfo | null | undefined, opts: { short?: boolean } = {}): Array<[string, string | null]> {
  if (!d?.ready || !d.info) return [];
  /* short: the project code only, for a print column that does not wrap (the DO); its name is building + unit, printed below. */
  const project = opts.short ? (d.info.projectCode ?? renoProjectLabel(d)) : renoProjectLabel(d);
  const cat = d.info.categoryGroup ? renoCategoryLabel({ room: '', categoryGroup: d.info.categoryGroup, subCategory: d.info.subCategory ?? '' }) : null;
  return [
    ['Project', project],
    ['Category', cat],
    ['Building', d.info.building || null],
    ['Unit', d.info.unitNo || null],
  ];
}

/** A line's extra print text: "Room: Bedroom 1" (and "· WORKS / ELECTRICAL" on a PO or GR), '' when nothing. */
export function renoLineNote(d: RenoDocInfo | null | undefined, itemId: string | null | undefined, withCategory = false): string {
  if (!d?.ready || !itemId) return '';
  const l = (d.lines as Partial<Record<string, RenoDocLine>>)[itemId];
  if (!l) return '';
  const parts = [l.room ? `Room: ${l.room}` : '', withCategory ? renoCategoryLabel(l) : ''].filter(Boolean);
  return parts.join(' · ');
}

/** True when the document has anything renovation to show (a project, building, unit or any line room). */
export function renoHasInfo(d: RenoDocInfo | null | undefined): boolean {
  if (!d?.ready || !d.info) return false;
  return d.info.projectId != null || !!d.info.building || !!d.info.unitNo
    || Object.values(d.lines).some((l) => !!l.room || !!l.categoryGroup);
}
