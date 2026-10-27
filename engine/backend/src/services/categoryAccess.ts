/* Role access by product category (Renovation beta project screens, phase 1 of PLAN-category-rbac.md).

   A role with no rows in public.role_category_access sees every category, and so does the owner role (the `*`
   permission). A role with rows is an allow-list: a ticked group (all its sub-categories, also ones added later),
   single ticked sub-categories, and "uncategorised" (products with no category, group code OTHER in the table).
   The scope is read per request, not kept in the auth cache, so a change on Roles applies on the next page load. */

import { isMissingRelation, type Db } from "./renovation/load";
import type { AuthUser } from "./auth";

/** The group code stored for "uncategorised" lines. */
export const OTHER_GROUP = "OTHER";

export interface CategoryScope {
  /** Group codes ticked whole. */
  groups: ReadonlySet<string>;
  /** "GROUP/SUB" for each sub-category ticked on its own. */
  subs: ReadonlySet<string>;
  /** Lines with no category are visible. */
  other: boolean;
}

export interface CategoryAccessRow { group_code: string; sub_code: string | null }

/** The scope the stored rows describe; null when there are none (everything visible). */
export function scopeOfRows(rows: readonly CategoryAccessRow[]): CategoryScope | null {
  if (rows.length === 0) return null;
  const groups = new Set<string>();
  const subs = new Set<string>();
  let other = false;
  for (const { group_code: group, sub_code: sub } of rows) {
    if (group === OTHER_GROUP) other = true;
    else if (sub === null) groups.add(group);
    else subs.add(`${group}/${sub}`);
  }
  return { groups, subs, other };
}

/** Whether a line with this category is visible. A null scope sees everything; a line with no group code needs `other`. */
export function lineVisible(scope: CategoryScope | null, groupCode: string | null, subCode: string | null): boolean {
  if (scope === null) return true;
  if (groupCode === null) return scope.other;
  if (scope.groups.has(groupCode)) return true;
  return subCode !== null && scope.subs.has(`${groupCode}/${subCode}`);
}

/** The rule for anything keyed by PO (a pending PO change, the PO list for photos): a PO is visible when at least one of
    its lines is. `visibleLinePoIds` are the PO ids of the lines the caller can see; a null scope keeps everything. */
export function keepVisiblePos<T>(items: readonly T[], poIdOf: (x: T) => string, visibleLinePoIds: Iterable<string>, scope: CategoryScope | null): T[] {
  if (scope === null) return [...items];
  const seen = new Set(visibleLinePoIds);
  return items.filter((x) => seen.has(poIdOf(x)));
}

/** The rows stored for a role. */
export async function readCategoryRows(db: Db, roleId: number): Promise<CategoryAccessRow[]> {
  const res = await db.prepare(`SELECT group_code, sub_code FROM public.role_category_access WHERE role_id = ?`).bind(roleId).all<CategoryAccessRow>();
  return res.results ?? [];
}

/** The caller's scope: null for the owner role or a role with no rows. */
export async function loadCategoryScope(db: Db, user: Pick<AuthUser, "role_id" | "permissions">): Promise<CategoryScope | null> {
  if (user.permissions.includes("*")) return null;
  try {
    return scopeOfRows(await readCategoryRows(db, user.role_id));
  } catch (e) {
    // Migration 0175 not applied yet: no table means no restriction (the plan's rollback: a missing table is today's behaviour).
    if (isMissingRelation(e)) {
      console.warn("[category-access] role_category_access table missing, no restriction applied");
      return null;
    }
    throw e;
  }
}

/* ---------- the editor on Roles ---------- */

export interface CategoryTreeGroup { code: string; label: string; subs: Array<{ code: string; label: string }> }

/** The catalog as the editor draws it: groups in order, each with its active sub-categories. */
export async function loadCategoryTree(db: Db): Promise<CategoryTreeGroup[]> {
  const groups = (await db.prepare(`SELECT code, label FROM scm.product_category_groups ORDER BY sort_order, code`).bind().all<{ code: string; label: string }>()).results ?? [];
  const subs = (await db.prepare(`SELECT group_code, code, label FROM scm.product_sub_categories WHERE active ORDER BY group_code, sort_order, code`).bind()
    .all<{ group_code: string; code: string; label: string }>()).results ?? [];
  return groups.map((g) => ({ code: g.code, label: g.label, subs: subs.filter((x) => x.group_code === g.code).map(({ code, label }) => ({ code, label })) }));
}

/** Every (group, sub) pair of the catalog, active or not, to check a save against. */
export async function loadKnownCategories(db: Db): Promise<{ groups: Set<string>; pairs: Set<string> }> {
  const groups = (await db.prepare(`SELECT code FROM scm.product_category_groups`).bind().all<{ code: string }>()).results ?? [];
  const subs = (await db.prepare(`SELECT group_code, code FROM scm.product_sub_categories`).bind().all<{ group_code: string; code: string }>()).results ?? [];
  return { groups: new Set(groups.map((g) => g.code)), pairs: new Set(subs.map((x) => `${x.group_code}/${x.code}`)) };
}

/** What the editor saves: restricted false means every category (no rows). */
export interface CategoryAccessInput { restricted: boolean; groups: string[]; subs: string[]; other: boolean }

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function codeList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string" || !x.trim()) return null;
    out.push(x.trim());
  }
  return [...new Set(out)];
}

/** The body of PUT /roles/:id/category-access, checked for shape and for a restricted save that ticks nothing. */
export function cleanCategoryAccess(b: unknown): { ok: true; value: CategoryAccessInput } | { ok: false; message: string } {
  const o = isRecord(b) ? b : {};
  if (typeof o.restricted !== "boolean") return { ok: false, message: "Say whether this role sees all categories." };
  const groups = codeList(o.groups ?? []);
  const subs = codeList(o.subs ?? []);
  if (!groups || !subs) return { ok: false, message: "Groups and sub-categories must be lists of codes." };
  if (o.other !== undefined && typeof o.other !== "boolean") return { ok: false, message: "Uncategorised must be on or off." };
  const other = o.other === true;
  if (!o.restricted) return { ok: true, value: { restricted: false, groups: [], subs: [], other: false } };
  if (groups.length === 0 && subs.length === 0 && !other) return { ok: false, message: "Tick at least one category, or let the role see all categories." };
  return { ok: true, value: { restricted: true, groups, subs, other } };
}

/** The first code of a save the catalog does not know, as a message; null when all are known. */
export function unknownCategory(v: CategoryAccessInput, known: { groups: ReadonlySet<string>; pairs: ReadonlySet<string> }): string | null {
  // OTHER is the stored flag for uncategorised lines (sent as `other`), never a real group or a sub-category under one.
  if (v.groups.includes(OTHER_GROUP) || v.subs.some((x) => x.startsWith(`${OTHER_GROUP}/`))) return `${OTHER_GROUP} is reserved for uncategorised lines`;
  const g = v.groups.find((x) => !known.groups.has(x));
  if (g !== undefined) return `Unknown category: ${g}`;
  const s = v.subs.find((x) => !known.pairs.has(x));
  return s === undefined ? null : `Unknown sub-category: ${s}`;
}

/** The rows a save stores: a ticked group, a sub-category whose group is not ticked whole, and uncategorised. */
export function rowsOfInput(v: CategoryAccessInput): CategoryAccessRow[] {
  if (!v.restricted) return [];
  const whole = new Set(v.groups);
  return [
    ...v.groups.map((group_code) => ({ group_code, sub_code: null })),
    ...v.subs.filter((x) => !whole.has(x.split("/")[0] ?? "")).map((x) => ({ group_code: x.split("/")[0] ?? "", sub_code: x.split("/")[1] ?? null })),
    ...(v.other ? [{ group_code: OTHER_GROUP, sub_code: null }] : []),
  ];
}
