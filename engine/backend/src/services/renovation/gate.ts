/* The hardware gate: site works cannot start until the contract is real.

   Open only when ALL of these are known to hold:
     - the renovation SO is confirmed (RENO_CONFIRMED / RENO_IN_PROGRESS / RENO_COMPLETED)
     - instalment 1 is received in full
     - the customer signed off the shop drawings
     - the renovation permit is approved, or skipped by hand with a reason
   A fact that could not be read (null) keeps the gate CLOSED: every gate fails
   closed (spec section 8). */

export const RENO_SO_CONFIRMED_STATUSES: readonly string[] = ["RENO_CONFIRMED", "RENO_IN_PROGRESS", "RENO_COMPLETED"];

export type GateReason =
  | "so_missing"
  | "so_not_confirmed"
  | "billing_unavailable"
  | "instalment1_unpaid"
  | "shop_drawings_unsigned"
  | "permit_pending";

export const GATE_REASON_TEXT: Readonly<Record<GateReason, string>> = {
  so_missing: "No renovation sales order is linked to this project yet.",
  so_not_confirmed: "The sales order is not confirmed.",
  billing_unavailable: "Customer billing cannot be read yet, so instalment 1 cannot be confirmed as received.",
  instalment1_unpaid: "Instalment 1 has not been received in full.",
  shop_drawings_unsigned: "The customer has not signed off the shop drawings.",
  permit_pending: "The renovation permit is not approved (or skipped with a reason).",
};

export type PermitState = "approved" | "skipped" | "pending";

export interface GateFacts {
  /** undefined/null = no renovation SO; a string = its status. */
  soStatus: string | null | undefined;
  /** null = billing could not be read. */
  instalment1Received: boolean | null;
  /** null = checklist could not be read or has no sign-off item. */
  shopDrawingsSigned: boolean | null;
  permit: PermitState | null;
}

export interface GateResult {
  open: boolean;
  reasons: GateReason[];
}

export function evaluateHardwareGate(f: GateFacts): GateResult {
  const reasons: GateReason[] = [];
  if (f.soStatus == null) reasons.push("so_missing");
  else if (!RENO_SO_CONFIRMED_STATUSES.includes(f.soStatus)) reasons.push("so_not_confirmed");
  if (f.instalment1Received === null) reasons.push("billing_unavailable");
  else if (!f.instalment1Received) reasons.push("instalment1_unpaid");
  if (f.shopDrawingsSigned !== true) reasons.push("shop_drawings_unsigned");
  if (f.permit !== "approved" && f.permit !== "skipped") reasons.push("permit_pending");
  return { open: reasons.length === 0, reasons };
}

/** Checklist row -> permit state. A done or skipped item counts; anything else is pending. */
export function permitStateOf(item: { status?: string | null; skip_reason?: string | null } | null | undefined): PermitState | null {
  if (!item) return null;
  if (item.skip_reason && item.skip_reason.trim().length >= 3) return "skipped";
  if (item.status === "done") return "approved";
  return "pending";
}

export function isSoConfirmed(status: string | null | undefined): boolean {
  return status != null && RENO_SO_CONFIRMED_STATUSES.includes(status);
}
