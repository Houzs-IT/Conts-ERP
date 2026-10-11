/* Billing prompts on the project: "Bill instalment N" shows on the stage that
   owns the instalment once its trigger is met. Amounts are never stored here:
   they come from phase 2's billing (scm.reno_doc_instalments + bills + invoices).

   - An instalment tied to a skipped stage moves to the next stage that is not
     skipped (spec section 5, Stages).
   - Phase 2 bills the lowest unbilled instalment only, so only that one is
     actionable; later triggered ones are shown as "waiting". */

import type { StageKey } from "../../scm/shared/renovation-stages";
import { isStageKey } from "../../scm/shared/renovation-stages";
import { nextNonSkipped, type StageView } from "./stages";

export type InstalmentTrigger = "so_confirmed" | "stage_start" | "stage_done";

export interface InstalmentFact {
  id: string;
  seq: number;
  label: string;
  pctBp: number;
  description: string | null;
  stageCode: string | null;
  trigger: InstalmentTrigger;
  billedSen: number;
  receivedSen: number;
  /** Amount the instalment is expected to bill, when the billing side reports it. */
  dueSen: number | null;
  billed: boolean;
}

export interface BillingFacts {
  available: boolean;
  /** Why billing is not available ('table_missing', 'no_so'), for the screen. */
  unavailableReason?: string;
  contractSen: number | null;
  /** everything received against the contract (phase 2 billing view), sen */
  receivedTotalSen?: number;
  voTotalSen?: number;
  instalments: InstalmentFact[];
}

export function normTrigger(x: string | null | undefined): InstalmentTrigger {
  return x === "so_confirmed" || x === "stage_done" ? x : "stage_start";
}

export function effectiveInstalmentStage(stageCode: string | null, views: readonly StageView[]): StageKey | null {
  if (!isStageKey(stageCode)) return null;
  return nextNonSkipped(views, stageCode);
}

export interface BillingPrompt {
  instalmentId: string;
  seq: number;
  label: string;
  description: string | null;
  stage: StageKey | null;
  trigger: InstalmentTrigger;
  dueSen: number | null;
  actionable: boolean;
}

function triggerMet(inst: InstalmentFact, stage: StageView | undefined, soConfirmed: boolean): boolean {
  if (!soConfirmed) return false;
  if (inst.trigger === "so_confirmed") return true;
  if (!stage) return false;
  if (inst.trigger === "stage_done") return stage.state === "done";
  return stage.state === "in_progress" || stage.state === "done";
}

export function billingPrompts(billing: BillingFacts, views: readonly StageView[], soConfirmed: boolean): BillingPrompt[] {
  if (!billing.available) return [];
  const sorted = [...billing.instalments].sort((a, b) => a.seq - b.seq);
  const lowestUnbilled = sorted.find((i) => !i.billed);
  const out: BillingPrompt[] = [];
  for (const inst of sorted) {
    if (inst.billed) continue;
    const stageKey = effectiveInstalmentStage(inst.stageCode, views);
    const stage = stageKey ? views.find((v) => v.key === stageKey) : undefined;
    if (!triggerMet(inst, stage, soConfirmed)) continue;
    out.push({
      instalmentId: inst.id,
      seq: inst.seq,
      label: inst.label,
      description: inst.description,
      stage: stageKey,
      trigger: inst.trigger,
      dueSen: inst.dueSen,
      actionable: inst.id === lowestUnbilled?.id,
    });
  }
  return out;
}

/** Instalment 1 received in full; null when billing cannot be read or has no instalment 1. */
export function instalmentOneReceived(billing: BillingFacts): boolean | null {
  if (!billing.available) return null;
  const first = [...billing.instalments].sort((a, b) => a.seq - b.seq)[0];
  if (!first) return null;
  if (!first.billed || first.billedSen <= 0) return false;
  return first.receivedSen >= first.billedSen;
}

export type PaymentCondition = "not_available" | "no_terms" | "not_billed" | "billed_unpaid" | "partly_paid" | "fully_paid";

export interface PaymentSummary {
  condition: PaymentCondition;
  count: number;
  billedCount: number;
  receivedCount: number;
  billedSen: number;
  receivedSen: number;
  contractSen: number | null;
  label: string;
}

/** The board's payment condition: instalments billed / received. */
export function paymentSummary(billing: BillingFacts): PaymentSummary {
  const base = { count: 0, billedCount: 0, receivedCount: 0, billedSen: 0, receivedSen: 0, contractSen: billing.contractSen };
  if (!billing.available) return { ...base, condition: "not_available", label: "Billing not available" };
  const list = billing.instalments;
  if (list.length === 0) return { ...base, condition: "no_terms", label: "No payment terms" };
  const billed = list.filter((i) => i.billed);
  const received = billed.filter((i) => i.billedSen > 0 && i.receivedSen >= i.billedSen);
  const billedSen = billed.reduce((s, i) => s + i.billedSen, 0);
  const receivedSen = billed.reduce((s, i) => s + Math.min(i.receivedSen, Math.max(i.billedSen, 0)), 0);
  let condition: PaymentCondition;
  if (billed.length === 0) condition = "not_billed";
  else if (received.length === list.length) condition = "fully_paid";
  else if (receivedSen > 0) condition = "partly_paid";
  else condition = "billed_unpaid";
  return {
    count: list.length,
    billedCount: billed.length,
    receivedCount: received.length,
    billedSen,
    receivedSen,
    contractSen: billing.contractSen,
    condition,
    label: `Paid ${received.length}/${list.length}` + (billed.length > received.length ? `, billed ${billed.length}` : ""),
  };
}
