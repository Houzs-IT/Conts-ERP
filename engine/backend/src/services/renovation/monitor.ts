/* Project Monitor queues (the one page that replaces the team's Notion panels,
   study sections 3 and 7). Pure: each project's facts in, the queues and red
   flags it belongs to out. The route builds the facts set-based from the same
   loaded data as the board rows.

   Queues per role tab:
     Sales       no SO yet; payment received below the step's norm; VO draft or
                 sent; quotation open (draft or sent, not converted); all ongoing
     Design      in the Design step; site measure not recorded; 2D or 3D missing
     Renovation  Signed or Ordering with no site task scheduled ("to arrange");
                 Renovation in progress; overdue site tasks
     Admin       money received but furniture or reno items not all arrived
     Boss        IN DEFECT; overdue (tasks, or planned handover passed); closed
   Red flags: IN DEFECT, overdue tasks, no SO N days after the project was
   created, handed over but not fully paid, works started before the hardware
   gate items (a warning only: the gate blocks nothing, owner decision).

   Money-based rules read nothing when money is hidden from the viewer (the
   route passes null amounts), so a queue never reveals what the board hides. */

import type { FlowStepKey, HoldFlag } from "../../scm/shared/renovation-stages";
import type { SupplyCondition } from "./conditions";
import { isFullyPaid } from "./flow";

export type MonitorRole = "sales" | "design" | "renovation" | "admin" | "boss";

export type QueueKey =
  | "sales_no_so"
  | "sales_payment_behind"
  | "sales_vo_open"
  | "sales_quote_open"
  | "sales_ongoing"
  | "design_in_design"
  | "design_no_measure"
  | "design_files_missing"
  | "reno_to_arrange"
  | "reno_in_progress"
  | "reno_overdue"
  | "admin_paid_not_arrived"
  | "boss_in_defect"
  | "boss_overdue"
  | "boss_closed";

export type FlagKey = "in_defect" | "task_overdue" | "no_so_after_days" | "handed_over_unpaid" | "works_before_gate";

export interface QueueDef { key: QueueKey; role: MonitorRole; label: string; hint: string }

/** Days a project may sit without a sales order before it is red-flagged. */
export const NO_SO_FLAG_DAYS = 14;

/** Share of the contract (%) normally received by the time a project reaches each step:
    deposit at signing, the 2nd payment before ordering carpentry, progress during the
    works, the balance at handover. A default for the owner to tune, not a contract term. */
export const PAYMENT_NORM_PCT: Readonly<Record<FlowStepKey, number>> = {
  design: 0,
  signed: 10,
  ordering: 40,
  renovation: 60,
  handover: 90,
  closed: 100,
};

const OPEN_DESIGN_STEPS: readonly FlowStepKey[] = ["design", "signed", "ordering"];

export const QUEUES: readonly QueueDef[] = [
  { key: "sales_no_so", role: "sales", label: "No sales order yet", hint: "Project exists but no signed SO is linked" },
  { key: "sales_payment_behind", role: "sales", label: "Payment behind", hint: "Received below the usual share for the project's step" },
  { key: "sales_vo_open", role: "sales", label: "VO waiting", hint: "Variation order in draft or sent, not approved" },
  { key: "sales_quote_open", role: "sales", label: "Quotation open", hint: "Quotation in draft or sent, not converted to an SO" },
  { key: "sales_ongoing", role: "sales", label: "All ongoing", hint: "Every project that is not closed" },
  { key: "design_in_design", role: "design", label: "In design", hint: "Projects in the Design step" },
  { key: "design_no_measure", role: "design", label: "Site measure not recorded", hint: "Open project with no site measure on record" },
  { key: "design_files_missing", role: "design", label: "2D / 3D missing", hint: "Open project without a 2D or a 3D file" },
  { key: "reno_to_arrange", role: "renovation", label: "To arrange", hint: "Signed or ordering, but no site task has dates yet" },
  { key: "reno_in_progress", role: "renovation", label: "Renovation in progress", hint: "Projects in the Renovation step" },
  { key: "reno_overdue", role: "renovation", label: "Overdue tasks", hint: "A site task is past its planned dates" },
  { key: "admin_paid_not_arrived", role: "admin", label: "Paid, items not arrived", hint: "Money received, furniture or reno items not all arrived" },
  { key: "boss_in_defect", role: "boss", label: "In defect", hint: "Projects flagged IN DEFECT" },
  { key: "boss_overdue", role: "boss", label: "Overdue", hint: "Site tasks late, or the planned handover date has passed" },
  { key: "boss_closed", role: "boss", label: "Closed", hint: "Handed over and fully paid, or closed by hand" },
];

export const FLAG_LABEL: Readonly<Record<FlagKey, string>> = {
  in_defect: "In defect",
  task_overdue: "Overdue site tasks",
  no_so_after_days: `No SO after ${NO_SO_FLAG_DAYS} days`,
  handed_over_unpaid: "Handed over, not fully paid",
  works_before_gate: "Works started before gate items",
};

export interface MonitorFacts {
  step: FlowStepKey;
  hold: HoldFlag | null;
  hasSo: boolean;
  /** YYYY-MM-DD (or a timestamp) the project was created */
  createdAt: string | null;
  /** null when there is no SO, billing cannot be read, or money is hidden */
  contractSen: number | null;
  receivedSen: number | null;
  receivedPct: number | null;
  /** variation orders in DRAFT or SENT */
  voOpen: number;
  /** quotations in DRAFT or SENT, not converted */
  quotationsOpen: number;
  siteMeasured: boolean;
  has2d: boolean;
  has3d: boolean;
  /** live (not skipped) site tasks with a planned start or end date */
  scheduledTasks: number;
  /** site tasks past their planned dates (overdue or late start) */
  overdueTasks: number;
  furniture: SupplyCondition | null;
  renoItem: SupplyCondition | null;
  handedOver: boolean;
  plannedHandoverDate: string | null;
  /** the project's red flag gate_blocked_works is raised (works started before the gate items) */
  worksBeforeGate: boolean;
}

const notArrived = (c: SupplyCondition | null) => c === "pending_purchased" || c === "pending_arrived";

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) / 864e5);
}

export function paymentBehind(f: Pick<MonitorFacts, "step" | "hasSo" | "receivedPct">): boolean {
  if (!f.hasSo || f.receivedPct == null || f.step === "closed") return false;
  return f.receivedPct < PAYMENT_NORM_PCT[f.step];
}

export function handoverOverdue(f: Pick<MonitorFacts, "handedOver" | "plannedHandoverDate">, today: string): boolean {
  return !f.handedOver && !!f.plannedHandoverDate && String(f.plannedHandoverDate).slice(0, 10) < today;
}

export function monitorQueues(f: MonitorFacts, today: string): QueueKey[] {
  const out: QueueKey[] = [];
  const open = f.step !== "closed";
  const designOpen = OPEN_DESIGN_STEPS.includes(f.step);
  if (open && !f.hasSo) out.push("sales_no_so");
  if (paymentBehind(f)) out.push("sales_payment_behind");
  if (f.voOpen > 0) out.push("sales_vo_open");
  if (f.quotationsOpen > 0) out.push("sales_quote_open");
  if (open) out.push("sales_ongoing");
  if (f.step === "design") out.push("design_in_design");
  if (designOpen && !f.siteMeasured) out.push("design_no_measure");
  if (designOpen && (!f.has2d || !f.has3d)) out.push("design_files_missing");
  if ((f.step === "signed" || f.step === "ordering") && f.scheduledTasks === 0) out.push("reno_to_arrange");
  if (f.step === "renovation") out.push("reno_in_progress");
  if (f.overdueTasks > 0) out.push("reno_overdue");
  if ((f.receivedSen ?? 0) > 0 && (notArrived(f.furniture) || notArrived(f.renoItem))) out.push("admin_paid_not_arrived");
  if (f.hold === "in_defect") out.push("boss_in_defect");
  if (open && (f.overdueTasks > 0 || handoverOverdue(f, today))) out.push("boss_overdue");
  if (f.step === "closed") out.push("boss_closed");
  return out;
}

export function monitorFlags(f: MonitorFacts, today: string): FlagKey[] {
  const out: FlagKey[] = [];
  if (f.hold === "in_defect") out.push("in_defect");
  if (f.overdueTasks > 0) out.push("task_overdue");
  if (!f.hasSo && f.step !== "closed" && f.createdAt && daysBetween(f.createdAt, today) > NO_SO_FLAG_DAYS) out.push("no_so_after_days");
  if (f.handedOver && f.contractSen != null && f.contractSen > 0 && f.receivedSen != null && !isFullyPaid(f.contractSen, f.receivedSen)) out.push("handed_over_unpaid");
  if (f.worksBeforeGate) out.push("works_before_gate");
  return out;
}

/** Who a project belongs to for "my projects": its sales person, designer, renovation PIC, or crew on a site task. */
export interface ProjectPeople { salesPersonId: number | null; designerPersonId: number | null; renoPicPersonId: number | null; crewIds: readonly number[] }

export function involvesPerson(p: ProjectPeople, personId: number | null): boolean {
  if (personId == null) return true;
  return p.salesPersonId === personId || p.designerPersonId === personId || p.renoPicPersonId === personId || p.crewIds.includes(personId);
}
