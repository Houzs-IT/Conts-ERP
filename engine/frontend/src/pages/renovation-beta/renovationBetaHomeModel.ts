/* The Beta project list (owner, 24 Oct 2026): search as you type, newest first by default, and a row that stays where
   it was after Assign until the page is reloaded. Pure rules, tested. */

import type { DesignProject } from "./renovationBetaBoard";

export type HomeSort = "newest" | "due";

export const HOME_SORTS: ReadonlyArray<readonly [HomeSort, string]> = [["newest", "Newest first"], ["due", "Due soonest"]];

export function sortFromParam(v: string | null): HomeSort {
  return v === "due" ? "due" : "newest";
}

/** Everything a person may type to find a project: name, building, unit, client, project code, SO numbers, people. */
export function searchText(p: DesignProject): string {
  const people = [p.lead, p.site, ...p.team["3"], ...p.team["2"]].map((x) => x?.name ?? "");
  return [p.title, p.name, p.tag, p.building, p.unitNo, p.customer, p.code, ...p.soDocNos, p.salesName, ...people]
    .filter(Boolean).join("\n").toLowerCase();
}

/** Every word typed appears somewhere (case does not matter, part of a word is enough). */
export function matchesSearch(p: DesignProject, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = searchText(p);
  return words.every((w) => hay.includes(w));
}

/** Newest first: made most recently on top (a new project is never buried mid-list); the same moment by id. */
export function newestFirst(list: readonly DesignProject[]): DesignProject[] {
  return [...list].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.id - a.id);
}

/** The list in a kept order: rows seen before keep their place, new rows go after them in the order given. */
export function keepOrder<T extends { id: number }>(list: readonly T[], order: ReadonlyMap<number, number>): T[] {
  return list.map((x, i) => ({ x, k: order.get(x.id) ?? order.size + i })).sort((a, b) => a.k - b.k).map((y) => y.x);
}

export const orderOf = (list: ReadonlyArray<{ id: number }>): Map<number, number> => new Map(list.map((x, i) => [x.id, i] as const));
