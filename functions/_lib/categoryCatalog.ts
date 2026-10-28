import { isRecord, type Parsed } from './accessRules';

/**
 * The product categories a person can be limited to (Dream Crafter > System > Category access).
 *
 * The groups and sub-categories are a copy of engine/backend/src/scm/shared/renovation-catalog.ts: Conts functions cannot
 * read schema `scm`, where the engine keeps them. src/lib/categoryCatalog.test.mjs compares the two files, so a group or
 * sub-category added there fails the test until it is added here.
 *
 * What is stored (pos.person_category_access, migration 0176): one row per ticked group (sub_code null) or sub-category.
 * The group code OTHER is not a catalog group: it means products that have no category yet. A person with no rows sees
 * everything; one with at least one row is limited to those rows.
 */

export interface CatalogSub { code: string; label: string; sort: number; active: boolean }
export interface CatalogGroup { code: string; label: string; sort: number; active: boolean; subs: CatalogSub[] }

/** The group code stored for products that have no category yet. */
export const OTHER = 'OTHER';

const subs = (...list: [code: string, label: string, sort: number][]): CatalogSub[] =>
  list.map(([code, label, sort]) => ({ code, label, sort, active: true }));

export const CATEGORY_CATALOG: readonly CatalogGroup[] = [
  { code: 'WORKS', label: 'Works', sort: 10, active: true, subs: subs(
    ['PROTECTION', 'Protection', 10], ['HACKING', 'Hacking', 20], ['PLUMBING', 'Plumbing', 30], ['WATERPROOFING', 'Waterproofing', 40],
    ['ELECTRICAL', 'Electrical', 50], ['MASONRY_TILING', 'Masonry / tiling', 60], ['PLASTER_CEILING', 'Plaster ceiling', 70],
    ['PARTITION', 'Partition', 75], ['ALUMINIUM_GLASS', 'Window / sliding door / glass', 80], ['DOOR', 'Door', 82], ['GRILL', 'Grill', 85],
    ['PAINTING', 'Painting', 90], ['TEXTURED_PAINTING', 'Textured painting', 95], ['FEATURE_WALL', 'Feature wall', 97], ['FLOORING', 'Flooring', 100],
  ) },
  { code: 'BUILTIN', label: 'Built-in', sort: 20, active: true, subs: subs(
    ['KITCHEN_CABINET', 'Kitchen cabinet', 10], ['WARDROBE', 'Wardrobe', 20], ['TV_CABINET', 'TV cabinet', 30], ['SHOE_CABINET', 'Shoe cabinet', 40],
    ['STUDY_TABLE', 'Study table', 50], ['COUNTERTOP', 'Countertop (stone)', 60], ['SHELVING', 'Shelving', 70],
  ) },
  { code: 'FURNITURE', label: 'Furniture', sort: 30, active: true, subs: subs(
    ['SOFA', 'Sofa', 10], ['BEDFRAME', 'Bedframe', 20], ['MATTRESS', 'Mattress', 30], ['DINING', 'Dining', 40], ['TABLES', 'Tables', 50],
    ['LOOSE_STORAGE', 'Loose storage', 60], ['ACCESSORY', 'Accessory', 70],
  ) },
  { code: 'LIGHTING', label: 'Lighting', sort: 40, active: true, subs: subs(
    ['DOWNLIGHT', 'Downlight', 10], ['EYEBALL', 'Eye ball', 15], ['PENDANT', 'Pendant', 20], ['LED_STRIP', 'LED strip', 30], ['CEILING_FAN', 'Ceiling fan', 40],
  ) },
  { code: 'APPLIANCE', label: 'Appliances', sort: 50, active: true, subs: subs(
    ['TV', 'TV', 10], ['FRIDGE', 'Fridge', 20], ['WASHER', 'Washer', 30], ['WATER_HEATER', 'Water heater', 40], ['HOOD_HOB', 'Hood / hob', 50], ['AIRCON_UNIT', 'Aircon unit', 60],
  ) },
  { code: 'SOFT', label: 'Soft furnishing', sort: 60, active: true, subs: subs(
    ['CURTAIN_BLINDS', 'Curtain / blinds', 10], ['BED_LINEN', 'Bed linen', 20], ['AMENITIES', 'Amenities', 30], ['DECORATION', 'Decoration', 40],
    ['CARPET', 'Carpet', 50], ['DIFFUSER', 'Diffuser', 60],
  ) },
  { code: 'SERVICE', label: 'Service', sort: 70, active: true, subs: subs(
    ['DELIVERY', 'Delivery', 10], ['STYLING', 'Styling', 20], ['PHOTOSHOOT', 'Photoshoot', 30], ['AIRBNB_SETUP', 'Airbnb setup', 40],
    ['AIRCON_INSTALL', 'Aircon install', 50], ['CLEANING', 'Cleaning', 60], ['PROJECT_MGMT', 'Project management', 70],
  ) },
  { code: 'AIRBNB', label: 'Airbnb supplies', sort: 80, active: true, subs: subs(
    ['KITCHENWARE', 'Kitchenware', 10], ['BATH_CLEANING', 'Bathroom & cleaning', 20], ['FIXTURE', 'Fixture', 30], ['CONSUMABLES', 'Consumables', 40], ['SIGNAGE', 'Signage', 50],
  ) },
];

/** The catalog as the page draws it: active groups and sub-categories, in order, with the codes and labels only. */
export interface CatalogTreeGroup { code: string; label: string; subs: { code: string; label: string }[] }
export const catalogTree = (): CatalogTreeGroup[] =>
  CATEGORY_CATALOG.filter(g => g.active).sort((a, b) => a.sort - b.sort).map(g => ({
    code: g.code, label: g.label,
    subs: g.subs.filter(s => s.active).sort((a, b) => a.sort - b.sort).map(({ code, label }) => ({ code, label })),
  }));

/** One person's ticks. `subs` holds "GROUP/SUB" codes. */
export interface CategoryChoice { groups: string[]; subs: string[]; other: boolean }
export interface CategoryAccessBody extends CategoryChoice { restricted: boolean }

const MAX_TICKS = 500;
export const subKey = (group: string, sub: string): string => `${group}/${sub}`;

const GROUP_CODES: ReadonlySet<string> = new Set(CATEGORY_CATALOG.map(g => g.code));
const SUB_KEYS: ReadonlySet<string> = new Set(CATEGORY_CATALOG.flatMap(g => g.subs.map(s => subKey(g.code, s.code))));

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
export function parseCategoryAccess(body: unknown): Parsed<CategoryAccessBody> {
  if (!isRecord(body) || typeof body.restricted !== 'boolean') return bad('Say whether this person is limited to some categories.');
  if (!body.restricted) return { ok: true, value: { restricted: false, groups: [], subs: [], other: false } };
  if (body.other !== undefined && typeof body.other !== 'boolean') return bad('Uncategorised must be on or off.');
  const groups = codesOf(body.groups, GROUP_CODES);
  if (!groups) return bad('One of the categories is not in the catalog.');
  const subs = codesOf(body.subs, SUB_KEYS);
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
export function choiceOfRows(rows: { group_code: string; sub_code: string | null }[]): CategoryChoice {
  const groups: string[] = [];
  const subs: string[] = [];
  let other = false;
  for (const { group_code: g, sub_code: s } of rows) {
    if (g === OTHER && s === null) other = true;
    else if (s === null && GROUP_CODES.has(g)) groups.push(g);
    else if (s !== null && SUB_KEYS.has(subKey(g, s))) subs.push(subKey(g, s));
  }
  return { groups, subs, other };
}

/** A choice in words, for the audit trail and the list: "All categories", or "Works, Soft furnishing / Curtain / blinds". */
export function describeChoice(restricted: boolean, { groups, subs, other }: CategoryChoice): string {
  if (!restricted) return 'All categories';
  const labelOf = (g: string): string => CATEGORY_CATALOG.find(c => c.code === g)?.label ?? g;
  const parts = [
    ...groups.map(labelOf),
    ...subs.map(s => {
      const [g = '', c = ''] = s.split('/');
      return `${labelOf(g)} / ${CATEGORY_CATALOG.find(x => x.code === g)?.subs.find(x => x.code === c)?.label ?? c}`;
    }),
    ...(other ? ['Uncategorised'] : []),
  ];
  return parts.join(', ');
}
