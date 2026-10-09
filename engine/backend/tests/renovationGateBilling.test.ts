import { describe, expect, test } from "vitest";
import { evaluateHardwareGate, permitStateOf } from "../src/services/renovation/gate";
import {
  billingPrompts,
  effectiveInstalmentStage,
  instalmentOneReceived,
  paymentSummary,
  type BillingFacts,
  type InstalmentFact,
} from "../src/services/renovation/billing";
import { deriveStageViews } from "../src/services/renovation/stages";

const ALL = ["design", "key_permit", "defect_check", "shop_drawings", "hardware", "furniture", "appliances", "soft_furnishing", "handover", "warranty", "closed"];

describe("evaluateHardwareGate", () => {
  const ok = { soStatus: "RENO_CONFIRMED", instalment1Received: true, shopDrawingsSigned: true, permit: "approved" as const };

  test("opens only when every fact holds", () => {
    expect(evaluateHardwareGate(ok)).toEqual({ open: true, reasons: [] });
    expect(evaluateHardwareGate({ ...ok, soStatus: "RENO_IN_PROGRESS", permit: "skipped" }).open).toBe(true);
  });

  test("lists every reason it is closed", () => {
    expect(evaluateHardwareGate({ soStatus: "CONFIRMED", instalment1Received: false, shopDrawingsSigned: false, permit: "pending" }).reasons)
      .toEqual(["so_not_confirmed", "instalment1_unpaid", "shop_drawings_unsigned", "permit_pending"]);
  });

  test("unknown facts keep it closed (fails closed)", () => {
    const r = evaluateHardwareGate({ soStatus: null, instalment1Received: null, shopDrawingsSigned: null, permit: null });
    expect(r.open).toBe(false);
    expect(r.reasons).toEqual(["so_missing", "billing_unavailable", "shop_drawings_unsigned", "permit_pending"]);
  });

  test("permit state from its checklist row", () => {
    expect(permitStateOf({ status: "done" })).toBe("approved");
    expect(permitStateOf({ status: "pending", skip_reason: "no permit needed" })).toBe("skipped");
    expect(permitStateOf({ status: "pending" })).toBe("pending");
    expect(permitStateOf(null)).toBeNull();
  });
});

function inst(seq: number, extra: Partial<InstalmentFact> = {}): InstalmentFact {
  return {
    id: `i${seq}`, seq, label: `Instalment ${seq}`, pctBp: 2500, description: null, stageCode: null,
    trigger: "stage_start", billedSen: 0, receivedSen: 0, dueSen: null, billed: false, ...extra,
  };
}

describe("billing prompts", () => {
  const lines = [{ soItemId: "w", category: "WORKS", group: "WORKS" as const, subCategory: "PAINTING", stageOverride: null, supplyByOwner: false, qty: 1, room: null, description: null, itemCode: null }];

  test("an instalment on a skipped stage moves to the next stage not skipped", () => {
    const v = deriveStageViews({ typeStageKeys: ALL, stored: [], lines });
    expect(effectiveInstalmentStage("furniture", v)).toBe("handover"); // furniture/appliances/soft auto-skipped
    expect(effectiveInstalmentStage("hardware", v)).toBe("hardware");
    expect(effectiveInstalmentStage(null, v)).toBeNull();
  });

  test("prompts when the trigger is met; only the lowest unbilled is actionable", () => {
    const v = deriveStageViews({
      typeStageKeys: ALL,
      stored: [{ stage_key: "hardware", state: "in_progress" }, { stage_key: "design", state: "done" }],
      lines,
    });
    const billing: BillingFacts = {
      available: true, contractSen: 10_000_000,
      instalments: [
        inst(1, { trigger: "so_confirmed", billed: true, billedSen: 1_500_000, receivedSen: 1_500_000 }),
        inst(2, { stageCode: "design", trigger: "stage_done" }),
        inst(3, { stageCode: "hardware", trigger: "stage_start" }),
        inst(4, { stageCode: "handover", trigger: "stage_done" }),
      ],
    };
    const p = billingPrompts(billing, v, true);
    expect(p.map((x) => [x.seq, x.actionable])).toEqual([[2, true], [3, false]]);
    expect(billingPrompts(billing, v, false)).toEqual([]);
    expect(billingPrompts({ ...billing, available: false }, v, true)).toEqual([]);
  });

  test("instalment 1 received in full; null when billing is unreadable", () => {
    expect(instalmentOneReceived({ available: false, contractSen: null, instalments: [] })).toBeNull();
    expect(instalmentOneReceived({ available: true, contractSen: 1, instalments: [] })).toBeNull();
    expect(instalmentOneReceived({ available: true, contractSen: 1, instalments: [inst(1)] })).toBe(false);
    expect(instalmentOneReceived({ available: true, contractSen: 1, instalments: [inst(1, { billed: true, billedSen: 100, receivedSen: 99 })] })).toBe(false);
    expect(instalmentOneReceived({ available: true, contractSen: 1, instalments: [inst(2), inst(1, { billed: true, billedSen: 100, receivedSen: 100 })] })).toBe(true);
  });

  test("payment condition on the board", () => {
    expect(paymentSummary({ available: false, contractSen: null, instalments: [] }).condition).toBe("not_available");
    expect(paymentSummary({ available: true, contractSen: 1, instalments: [] }).condition).toBe("no_terms");
    expect(paymentSummary({ available: true, contractSen: 1, instalments: [inst(1), inst(2)] }).condition).toBe("not_billed");
    const s = paymentSummary({
      available: true, contractSen: 1,
      instalments: [inst(1, { billed: true, billedSen: 100, receivedSen: 100 }), inst(2, { billed: true, billedSen: 50 }), inst(3)],
    });
    expect(s).toMatchObject({ condition: "partly_paid", billedCount: 2, receivedCount: 1, billedSen: 150, receivedSen: 100, label: "Paid 1/3, billed 2" });
  });
});
