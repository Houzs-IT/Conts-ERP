/* Pure rules for the handover checklist and the defect queue (TODO item 17). */

import { defectDaysLate } from "./renovationBetaModel";
import type { CheckItem, HandoverCheck, QueueCheck, QueueDefect, TemplateItem } from "./renovationBetaHandoverApi";

export interface AreaGroup { area: string; items: CheckItem[] }

/** The items under their area, in the template's order; an item with no area sits under "General". */
export function itemsByArea(items: readonly CheckItem[]): AreaGroup[] {
  const out: AreaGroup[] = [];
  for (const i of items) {
    const area = i.area ?? "General";
    const last = out.find((g) => g.area === area);
    if (last) last.items.push(i);
    else out.push({ area, items: [i] });
  }
  return out;
}

/** The open check (at most one), else the newest finished one. */
export function currentCheck(checks: readonly HandoverCheck[]): HandoverCheck | null {
  return checks.find((k) => !k.completedAt) ?? checks[0] ?? null;
}

/** "12 of 20 checked · 2 failed" */
export function progressLine(p: { total: number; checked: number; failed: number }): string {
  return `${p.checked} of ${p.total} checked${p.failed > 0 ? ` · ${p.failed} failed` : ""}`;
}

/** What a Fail prefills in the defect report: the item and its area. */
export function failPrefill(i: Pick<CheckItem, "area" | "item" | "note">): { location: string; description: string } {
  return { location: i.area ?? "", description: i.note ? `${i.item}: ${i.note}` : i.item };
}

/** The rows the template editor sends: blank rows dropped, text trimmed. */
export function cleanRows(rows: readonly TemplateItem[]): TemplateItem[] {
  const t = (s: string | null): string | null => (s && s.trim() ? s.trim() : null);
  return rows
    .map((r) => ({ area: t(r.area), item: (r.item ?? "").trim(), criteria: t(r.criteria) }))
    .filter((r) => r.item || r.area || r.criteria);
}

/** Moves row i up (-1) or down (+1); out of range leaves the list as it is. */
export function moveRow<T>(rows: readonly T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  if (i < 0 || i >= rows.length || j < 0 || j >= rows.length) return [...rows];
  const out = [...rows];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/* ---------- The defect queue ---------- */

export type QueueTab = "all" | "to_fix" | "check" | "overdue" | "unassigned";

export const QUEUE_TABS: ReadonlyArray<readonly [QueueTab, string]> = [
  ["all", "All open"], ["to_fix", "To fix"], ["check", "To check"], ["overdue", "Overdue"], ["unassigned", "No one named"],
];

export function queueStage(d: Pick<QueueDefect, "fixedAt">): "to_fix" | "check" {
  return d.fixedAt ? "check" : "to_fix";
}

export function queueDaysLate(d: Pick<QueueDefect, "fixedAt" | "dueDate">, today: string): number {
  return defectDaysLate({ ...d, closedAt: null }, today);
}

export function inTab(d: QueueDefect, tab: QueueTab, today: string): boolean {
  if (tab === "all") return true;
  if (tab === "to_fix" || tab === "check") return queueStage(d) === tab;
  if (tab === "overdue") return queueDaysLate(d, today) > 0;
  return d.assigneeId == null && queueStage(d) === "to_fix";
}

export function tabCounts(defects: readonly QueueDefect[], today: string): Record<QueueTab, number> {
  const out: Record<QueueTab, number> = { all: 0, to_fix: 0, check: 0, overdue: 0, unassigned: 0 };
  for (const d of defects) for (const [t] of QUEUE_TABS) if (inTab(d, t, today)) out[t] += 1;
  return out;
}

/** Words typed in the search box each match on their own: project, customer, area, what is wrong, who fixes it. */
export function matchesSearch(d: QueueDefect, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [d.projectCode, d.projectName, d.customerName, d.location, d.description, d.assigneeName, d.trade].filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Most overdue first, then the earliest fix-by date (none last), then the oldest. */
export function sortQueue(defects: readonly QueueDefect[], today: string): QueueDefect[] {
  return [...defects].sort((a, b) =>
    queueDaysLate(b, today) - queueDaysLate(a, today)
    || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")
    || a.id - b.id);
}

export interface QueueProject { projectId: number; label: string; defects: QueueDefect[]; check: QueueCheck | null }

/** The queue under each project, the project with the most overdue defect first; a project with only an open check is listed too. */
export function queueByProject(defects: readonly QueueDefect[], checks: readonly QueueCheck[], today: string): QueueProject[] {
  const map = new Map<number, QueueProject>();
  const label = (code: string | null, name: string | null): string => [code, name].filter(Boolean).join(" · ") || "Project";
  for (const d of sortQueue(defects, today)) {
    const p = map.get(d.projectId) ?? { projectId: d.projectId, label: label(d.projectCode, d.projectName), defects: [], check: null };
    p.defects.push(d);
    map.set(d.projectId, p);
  }
  for (const k of checks) {
    const p = map.get(k.projectId) ?? { projectId: k.projectId, label: label(k.projectCode, k.projectName), defects: [], check: null };
    p.check = k;
    map.set(k.projectId, p);
  }
  const worst = (p: QueueProject): number => Math.max(0, ...p.defects.map((d) => queueDaysLate(d, today)));
  return [...map.values()].sort((a, b) => worst(b) - worst(a) || b.defects.length - a.defects.length || a.label.localeCompare(b.label));
}
