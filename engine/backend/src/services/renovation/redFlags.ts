/* Red flags on the project board. Phase 4 adds the closure checks; phase 3
   raises what the site and billing can see today. */

import type { BillingPrompt } from "./billing";
import type { StageView } from "./stages";
import { isTaskFlagged, type TaskStatus } from "./tradeTasks";

export type RedFlagCode =
  | "task_overdue"
  | "stage_overdue"
  | "billing_due"
  | "billing_unavailable"
  | "snag_overdue"
  | "handover_overdue"
  | "gate_blocked_works"
  | "sla_overdue";

export interface RedFlag {
  code: RedFlagCode;
  text: string;
  count?: number;
}

export interface RedFlagInput {
  today: string;
  views: readonly StageView[];
  taskStatuses: readonly TaskStatus[];
  prompts: readonly BillingPrompt[];
  billingAvailable: boolean;
  hasSo: boolean;
  openSnags: ReadonlyArray<{ due_date: string | null }>;
  plannedHandoverDate: string | null;
  handedOver: boolean;
  gateOpen: boolean;
  /** What is missing when works start early (owner 11 Oct: the gate warns, it never blocks). */
  gateMessages?: readonly string[];
  /** the SLA due date, when it has passed and the project is not handed over */
  slaOverdueSince?: string | null;
}

export function redFlags(i: RedFlagInput): RedFlag[] {
  const flags: RedFlag[] = [];
  const lateTasks = i.taskStatuses.filter(isTaskFlagged).length;
  if (lateTasks > 0) flags.push({ code: "task_overdue", count: lateTasks, text: `${lateTasks} task${lateTasks === 1 ? "" : "s"} past planned dates` });
  const lateStages = i.views.filter(
    (v) => v.state !== "done" && v.state !== "skipped" && v.plannedEnd && String(v.plannedEnd).slice(0, 10) < i.today,
  );
  if (lateStages.length > 0) flags.push({ code: "stage_overdue", count: lateStages.length, text: `Overdue: ${lateStages.map((v) => v.label).join(", ")}` });
  const due = i.prompts.filter((p) => p.actionable);
  if (due.length > 0) flags.push({ code: "billing_due", count: due.length, text: `Bill instalment ${due.map((p) => p.seq).join(", ")}` });
  if (i.hasSo && !i.billingAvailable) flags.push({ code: "billing_unavailable", text: "Customer billing cannot be read" });
  const lateSnags = i.openSnags.filter((s) => s.due_date && String(s.due_date).slice(0, 10) < i.today).length;
  if (lateSnags > 0) flags.push({ code: "snag_overdue", count: lateSnags, text: `${lateSnags} snag${lateSnags === 1 ? "" : "s"} past the 7-day fix date` });
  if (!i.handedOver && i.plannedHandoverDate && String(i.plannedHandoverDate).slice(0, 10) < i.today) {
    flags.push({ code: "handover_overdue", text: "Planned handover date has passed" });
  }
  const hw = i.views.find((v) => v.key === "hardware");
  if (hw && hw.state === "in_progress" && !i.gateOpen) {
    const missing = (i.gateMessages ?? []).join("; ");
    flags.push({ code: "gate_blocked_works", text: missing ? `Works started before: ${missing}` : "Works started before the project was ready" });
  }
  if (i.slaOverdueSince) flags.push({ code: "sla_overdue", text: `SLA due date passed (${i.slaOverdueSince})` });
  return flags;
}
