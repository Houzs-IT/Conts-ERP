import { isRecord, type Parsed } from './accessRules';

/**
 * The product categories a person can be limited to (Dream Crafter > System > Category access).
 *
 * The groups and sub-categories are the engine's own (scm.product_category_groups, scm.product_sub_categories), read
 * through pos.product_category_catalog() (migration 0317) by loadCategoryCatalog in categoryCatalogDb.ts.
 *
 * What is stored (pos.person_category_access, migration 0176): one row per ticked group (sub_code null) or sub-category.
 * The group code OTHER is not a catalog group: it means products that have no category yet. A person with no rows sees
 * everything; one with at least one row is limited to those rows.
 */

export interface CatalogSub { code: string; label: string; active: boolean }
export interface CatalogGroup { code: string; label: string; subs: CatalogSub[] }
export type CategoryCatalog = readonly CatalogGroup[];

/** The group code stored for products that have no category yet. */
export const OTHER = 'OTHER';

export interface CatalogRow { group_code: string; group_label: string; sub_code: string | null; sub_label: string | null; sub_active: boolean | null }

export function catalogOfRows(rows: readonly CatalogRow[]): CategoryCatalog {
  const groups = new Map<string, CatalogGroup>();
  for (const row of rows) {
    const group = groups.get(row.group_code) ?? { code: row.group_code, label: row.group_label, subs: [] };
    groups.set(row.group_code, group);
    if (row.sub_code !== null) group.subs.push({ code: row.sub_code, label: row.sub_label ?? row.sub_code, active: row.sub_active !== false });
  }
  return [...groups.values()];
}

/** The catalog as the page draws it: groups and shown sub-categories, in order, with the codes and labels only. */
export interface CatalogTreeGroup { code: string; label: string; subs: { code: string; label: string }[] }
export const catalogTree = (catalog: CategoryCatalog): CatalogTreeGroup[] =>
  catalog.map(group => ({
    code: group.code, label: group.label,
    subs: group.subs.filter(sub => sub.active).map(({ code, label }) => ({ code, label })),
  }));

/** One person's ticks. `subs` holds "GROUP/SUB" codes. */
export interface CategoryChoice { groups: string[]; subs: string[]; other: boolean }
export interface CategoryAccessBody extends CategoryChoice { restricted: boolean }

const MAX_TICKS = 500;
export const subKey = (group: string, sub: string): string => `${group}/${sub}`;

const groupCodesOf = (catalog: CategoryCatalog): ReadonlySet<string> => new Set(catalog.map(group => group.code));
const subKeysOf = (catalog: CategoryCatalog): ReadonlySet<string> =>
  new Set(catalog.flatMap(group => group.subs.map(sub => subKey(group.code, sub.code))));

const bad = (message: string): { ok: false; message: string } => ({ ok: false, message });

/** A list of catalog codes from the request: strings only, each one in `known`, repeats dropped. Null when anything else. */
function codesOf(v: unknown, known: ReadonlySet<string>): string[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_TICKS) return null;
  const out = new Set<string>();
  for (const x of v as unknown[]) {
    if (typeof x !== 'string' || !known.has(x)) return null;
    out.add(x);
  }
  return [...out];
}

/** PUT /api/users/:id/category-access body: `{ restricted, groups, subs, other }`. Unknown codes are refused, a limited
 *  save needs something ticked, and a sub-category whose group is ticked whole is dropped (the group covers it). With
 *  restricted false the ticks are ignored: everything is shown and nothing is stored. */
export function parseCategoryAccess(body: unknown, catalog: CategoryCatalog): Parsed<CategoryAccessBody> {
  if (!isRecord(body) || typeof body.restricted !== 'boolean') return bad('Say whether this person is limited to some categories.');
  if (!body.restricted) return { ok: true, value: { restricted: false, groups: [], subs: [], other: false } };
  if (body.other !== undefined && typeof body.other !== 'boolean') return bad('Uncategorised must be on or off.');
  const groups = codesOf(body.groups, groupCodesOf(catalog));
  if (!groups) return bad('One of the categories is not in the catalog.');
  const subs = codesOf(body.subs, subKeysOf(catalog));
  if (!subs) return bad('One of the sub-categories is not in the catalog.');
  const whole = new Set(groups);
  const kept = subs.filter(s => !whole.has(s.split('/')[0] ?? ''));
  const other = body.other === true;
  if (groups.length === 0 && kept.length === 0 && !other) return bad('Tick at least one category, or switch All categories back on.');
  return { ok: true, value: { restricted: true, groups, subs: kept, other } };
}

/** The rows to store for a choice: a group (sub null), a sub-category, and OTHER for uncategorised. */
export function rowsOfChoice({ groups, subs, other }: CategoryChoice): { group: string; sub: string | null }[] {
  return [
    ...groups.map(group => ({ group, sub: null })),
    ...subs.map(s => { const [group = '', sub = ''] = s.split('/'); return { group, sub }; }),
    ...(other ? [{ group: OTHER, sub: null }] : []),
  ];
}

/** A person's stored rows as ticks. Codes the catalog no longer has are left out. */
export function choiceOfRows(rows: { group_code: string; sub_code: string | null }[], catalog: CategoryCatalog): CategoryChoice {
  const groupCodes = groupCodesOf(catalog);
  const subKeys = subKeysOf(catalog);
  const groups: string[] = [];
  const subs: string[] = [];
  let other = false;
  for (const { group_code: g, sub_code: s } of rows) {
    if (g === OTHER && s === null) other = true;
    else if (s === null && groupCodes.has(g)) groups.push(g);
    else if (s !== null && subKeys.has(subKey(g, s))) subs.push(subKey(g, s));
  }
  return { groups, subs, other };
}

/** A choice in words, for the audit trail and the list: "All categories", or "Works, Soft furnishing / Curtain / blinds". */
export function describeChoice(restricted: boolean, { groups, subs, other }: CategoryChoice, catalog: CategoryCatalog): string {
  if (!restricted) return 'All categories';
  const labelOf = (g: string): string => catalog.find(c => c.code === g)?.label ?? g;
  const parts = [
    ...groups.map(labelOf),
    ...subs.map(s => {
      const [g = '', c = ''] = s.split('/');
      return `${labelOf(g)} / ${catalog.find(x => x.code === g)?.subs.find(x => x.code === c)?.label ?? c}`;
    }),
    ...(other ? ['Uncategorised'] : []),
  ];
  return parts.join(', ');
}
