// Conts only (not part of Houzs's code): the project or unit a ledger line belongs to, on Money received and manual
// journal lines as on voucher lines (chew 2 Nov 2026; plan 2026-11-02-renovation-close-out.md Task 1). A deposit paid
// on a voucher and returned on a receipt then nets to nothing on its project or unit, and the close-out check reads
// that. A unit only on a Rental line; a project on any line; both optional.

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as in the routes beside it */
type Db = any;

export type LineTags = { projectId: number | null; unitId: string | null };
export type TagRefusal = { error: 'bad_line' | 'unit_not_rental' | 'unit_unknown' | 'project_unknown'; message: string };

/** The tags a line sends, checked on their own (the department rule); unknown ones are found by unknownTags. */
export function readLineTags(raw: { projectId?: unknown; unitId?: unknown }, department: string, lineNo: number): LineTags | TagRefusal {
  const p = raw.projectId;
  let projectId: number | null = null;
  if (p !== undefined && p !== null && p !== '') {
    const n = Number(p);
    if (!Number.isSafeInteger(n) || n <= 0) return { error: 'bad_line', message: `Line ${lineNo}: the project is not one of ours.` };
    projectId = n;
  }
  const u = raw.unitId;
  const unitId = u === undefined || u === null || String(u).trim() === '' ? null : String(u).trim();
  if (unitId && department !== 'rental') return { error: 'unit_not_rental', message: `Line ${lineNo}: only a Rental line names a unit.` };
  return { projectId, unitId };
}

/** The first tag on the lines that is not a project of the company or a Property OS unit, as a refusal; null when all are known. */
export async function unknownTags(sb: Db, companyId: number, lines: LineTags[]): Promise<TagRefusal | { error: 'load_failed'; message: string } | null> {
  const projects = [...new Set(lines.map((l) => l.projectId).filter((p): p is number => p != null))];
  const units = [...new Set(lines.map((l) => l.unitId).filter((u): u is string => !!u))];
  if (projects.length > 0) {
    const { data, error } = await sb.schema('public').from('projects').select('id').eq('company_id', companyId).in('id', projects);
    if (error) return { error: 'load_failed', message: error.message };
    const known = new Set(((data ?? []) as Array<{ id: number }>).map((r) => Number(r.id)));
    if (projects.some((p) => !known.has(p))) return { error: 'project_unknown', message: 'Choose the project from the list.' };
  }
  if (units.length > 0) {
    const { data, error } = await sb.schema('public').from('conts_units').select('id').in('id', units);
    if (error) return { error: 'load_failed', message: error.message };
    const known = new Set(((data ?? []) as Array<{ id: string }>).map((r) => String(r.id)));
    if (units.some((u) => !known.has(u))) return { error: 'unit_unknown', message: 'Choose the unit from the list.' };
  }
  return null;
}
