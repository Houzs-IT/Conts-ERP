/* Person access by product category (Renovation beta project screens, phase 1 of PLAN-category-rbac.md v2).

   Set per person on the Conts side (pos.person_category_access) and read here through public.conts_category_access,
   matched on the signed-in email. A person with no rows sees every category. A person with rows is limited, whatever
   permissions they hold: an allow-list of ticked groups (all their sub-categories, also ones added later), single ticked
   sub-categories, and "uncategorised" (products with no category, group code OTHER in the table).
   The scope is read per request, not kept in the auth cache, so a change on the Conts side applies on the next page load. */

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

/** The caller's scope: null when the view has no rows for their email. */
export async function loadCategoryScope(db: Db, user: Pick<AuthUser, "email">): Promise<CategoryScope | null> {
  try {
    const res = await db.prepare(`SELECT group_code, sub_code FROM public.conts_category_access WHERE email = lower(?)`).bind(user.email).all<CategoryAccessRow>();
    return scopeOfRows(res.results ?? []);
  } catch (e) {
    // Migration 0176 not applied yet: no view means no restriction (the plan's rollback: a missing view is today's behaviour).
    if (isMissingRelation(e)) {
      console.warn("[category-access] view public.conts_category_access missing, no restriction applied");
      return null;
    }
    throw e;
  }
}
