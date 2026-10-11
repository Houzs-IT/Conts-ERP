/* Project Monitor: wire types for GET /api/renovation/monitor and the pure
   helpers the page uses (which rows a tile or flag opens, search, role tabs).
   Queue rules themselves live on the server (services/renovation/monitor.ts). */

import { api } from "../../../api/client";
import type { BoardRowV2, PersonRole } from "./simpleApi";
import type { FlowStepKey } from "../../../vendor/shared/renovation-stages";

export type MonitorRole = "sales" | "design" | "renovation" | "admin" | "boss";

export type QueueKey =
  | "sales_no_so" | "sales_payment_behind" | "sales_vo_open" | "sales_quote_open" | "sales_ongoing"
  | "design_in_design" | "design_no_measure" | "design_files_missing"
  | "reno_to_arrange" | "reno_in_progress" | "reno_overdue"
  | "admin_paid_not_arrived"
  | "boss_in_defect" | "boss_overdue" | "boss_closed";

export type FlagKey = "in_defect" | "task_overdue" | "no_so_after_days" | "handed_over_unpaid" | "works_before_gate";

export interface MonitorRow extends BoardRowV2 {
  designer: { personId: number | null; name: string | null };
  renoPic: { personId: number | null; name: string | null };
  createdAt: string | null;
  siteMeasured: boolean;
  has2d: boolean;
  has3d: boolean;
  scheduledTasks: number;
  overdueTasks: number;
  openTasks: number;
  /** "Works started before: ..." when site works began ahead of the hardware gate items (a warning, never a block) */
  worksBeforeGateText: string | null;
  crewIds: number[];
  openQuotation: { id: string; quoteNo: string; count: number } | null;
  openVo: { id: string; voNo: string; count: number } | null;
  queues: QueueKey[];
  flags: FlagKey[];
}

export interface MonitorQueue { key: QueueKey; role: MonitorRole; label: string; hint: string; count: number; ids: number[] }
export interface MonitorFlag { key: FlagKey; label: string; count: number; ids: number[] }

export interface MonitorData {
  today: string;
  personId: number | null;
  moneyHidden: boolean;
  steps: Array<{ key: FlowStepKey; label: string }>;
  stepCounts: Record<FlowStepKey, number>;
  holdCounts: { in_defect: number; on_hold: number };
  queues: MonitorQueue[];
  flags: MonitorFlag[];
  paymentNormPct: Record<FlowStepKey, number>;
  noSoFlagDays: number;
  rows: MonitorRow[];
}

export const monitorApi = {
  get: (personId: number | null) => api.get<MonitorData>(`/api/renovation/monitor${personId ? `?personId=${personId}` : ""}`),
};

export const ROLE_TABS: ReadonlyArray<{ key: MonitorRole; label: string; who: string }> = [
  { key: "sales", label: "Sales", who: "Follow-up on SOs, payments, VOs and quotations" },
  { key: "design", label: "Design", who: "Site measures and 2D / 3D drawings" },
  { key: "renovation", label: "Renovation", who: "Arrange site tasks, works in progress, late tasks" },
  { key: "admin", label: "Admin", who: "Money in, purchases and deliveries to chase" },
  { key: "boss", label: "Boss", who: "Everything: steps, defects, overdue, closed" },
];

export function isMonitorRole(x: string | null | undefined): x is MonitorRole {
  return ROLE_TABS.some((t) => t.key === x);
}

/** The tab a person most likely wants first, from their roles in the people list. */
export function roleTabFor(roles: readonly PersonRole[] | null | undefined): MonitorRole | null {
  if (!roles || roles.length === 0) return null;
  if (roles.includes("boss")) return "boss";
  if (roles.includes("sales")) return "sales";
  if (roles.includes("designer")) return "design";
  if (roles.includes("reno_pic") || roles.includes("site_crew")) return "renovation";
  if (roles.includes("admin")) return "admin";
  return null;
}

/** What the list under the tiles is showing: a queue, a red flag, a step, a hold, or everything. */
export type MonitorSelection =
  | { kind: "all" }
  | { kind: "queue"; key: QueueKey }
  | { kind: "flag"; key: FlagKey }
  | { kind: "step"; key: FlowStepKey }
  | { kind: "hold"; key: "in_defect" | "on_hold" };

export function selectionOf(raw: string | null | undefined): MonitorSelection {
  const [kind, key] = String(raw ?? "").split(":");
  if (!key) return { kind: "all" };
  if (kind === "queue") return { kind, key: key as QueueKey };
  if (kind === "flag") return { kind, key: key as FlagKey };
  if (kind === "step") return { kind, key: key as FlowStepKey };
  if (kind === "hold" && (key === "in_defect" || key === "on_hold")) return { kind, key };
  return { kind: "all" };
}

export function selectionParam(s: MonitorSelection): string | null {
  return s.kind === "all" ? null : `${s.kind}:${s.key}`;
}

export function matchesSelection(r: Pick<MonitorRow, "queues" | "flags" | "step" | "hold">, s: MonitorSelection): boolean {
  switch (s.kind) {
    case "all": return true;
    case "queue": return r.queues.includes(s.key);
    case "flag": return r.flags.includes(s.key);
    case "step": return r.step.key === s.key;
    case "hold": return r.hold?.flag === s.key;
  }
}

/** Every search word must appear in building, unit, project, customer, SO or the people on it. */
export function matchesSearch(r: Pick<MonitorRow, "code" | "name" | "building" | "unitNo" | "customerName" | "soDocNo" | "sales" | "designer" | "renoPic">, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [r.code, r.name, r.building, r.unitNo, r.customerName, r.soDocNo, r.sales.name, r.designer?.name, r.renoPic?.name]
    .filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function selectionLabel(s: MonitorSelection, d: Pick<MonitorData, "queues" | "flags" | "steps"> | null | undefined): string {
  if (s.kind === "all") return "All projects";
  if (s.kind === "queue") return d?.queues.find((q) => q.key === s.key)?.label ?? "Queue";
  if (s.kind === "flag") return d?.flags.find((f) => f.key === s.key)?.label ?? "Red flag";
  if (s.kind === "step") return d?.steps.find((x) => x.key === s.key)?.label ?? s.key;
  return s.key === "in_defect" ? "In defect" : "On hold";
}

/** Short reasons a row is in the selected queue, shown on the card / row. */
export function rowReasons(r: MonitorRow, normPct: Record<FlowStepKey, number> | undefined): string[] {
  const out: string[] = [];
  if (r.queues.includes("sales_payment_behind") && normPct) out.push(`Received ${r.receivedPct ?? 0}% (usual ${normPct[r.step.key]}% at ${r.step.label})`);
  if (r.queues.includes("design_no_measure")) out.push("No site measure");
  if (r.queues.includes("design_files_missing")) out.push([!r.has2d && "2D", !r.has3d && "3D"].filter(Boolean).join(" + ") + " missing");
  if (r.overdueTasks > 0) out.push(`${r.overdueTasks} late task${r.overdueTasks === 1 ? "" : "s"}`);
  if (r.queues.includes("reno_to_arrange")) out.push("No site task scheduled");
  return out;
}
