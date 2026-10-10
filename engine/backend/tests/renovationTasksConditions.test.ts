import { describe, expect, test } from "vitest";
import {
  plannedDatesRefusal,
  planTradeTasks,
  tradeTaskStatus,
  type WorksLine,
} from "../src/services/renovation/tradeTasks";
import { boardConditions, supplyCondition, unitKeyStatus, type LineSupply } from "../src/services/renovation/conditions";
import { groupEvidence, podCoverage, podQtyBySoItem } from "../src/services/renovation/pod";
import { redFlags } from "../src/services/renovation/redFlags";
import type { ContractLine } from "../src/services/renovation/stages";

const ALL = ["design", "key_permit", "defect_check", "shop_drawings", "hardware", "furniture", "appliances", "soft_furnishing", "handover", "warranty", "closed"];

function w(id: string, trade: string, extra: Partial<WorksLine> = {}): WorksLine {
  return { soItemId: id, trade, omitted: false, poItemId: null, poId: null, supplierId: null, ...extra };
}

describe("planTradeTasks", () => {
  test("one task per trade, electrical twice, laid out in the suggested order", () => {
    const plan = planTradeTasks({
      works: [w("1", "PAINTING"), w("2", "ELECTRICAL", { poId: "po1", poItemId: "pi2", supplierId: "s1" }), w("3", "HACKING"), w("4", "PROJECT_MGMT"), w("5", "CLEANING")],
      existing: [],
      typeStageKeys: ALL,
    });
    const po = plan.create.filter((t) => t.fulfilmentKind === "po").sort((a, b) => a.seq - b.seq);
    expect(po.map((t) => `${t.tradeCode}:${t.fixPhase}`)).toEqual([
      "HACKING:single", "ELECTRICAL:first", "PAINTING:single", "ELECTRICAL:second", "CLEANING:single",
    ]);
    expect(po.find((t) => t.fixPhase === "first")).toMatchObject({ label: "WIRING & HACKING", purchaseOrderId: "po1", supplierId: "s1" });
    expect(po.find((t) => t.tradeCode === "CLEANING")!.stageKey).toBe("handover");
    expect(po.some((t) => t.tradeCode === "PROJECT_MGMT")).toBe(false);
  });

  test("template tasks follow the project type's stages, with no PO", () => {
    const full = planTradeTasks({ works: [], existing: [], typeStageKeys: ALL });
    expect(full.create.map((t) => t.tradeCode)).toEqual([
      "INTERNAL:pre_reno_delivery", "INTERNAL:qc", "INTERNAL:post_reno_cleaning", "INTERNAL:touch_up",
      "INTERNAL:set_up_cleaning", "INTERNAL:joint_handover_inspection",
    ]);
    expect(full.create.every((t) => t.fulfilmentKind === "internal" && t.purchaseOrderId === null)).toBe(true);
    const airbnb = planTradeTasks({ works: [], existing: [], typeStageKeys: ["design", "furniture", "handover", "closed"] });
    expect(airbnb.create.map((t) => t.tradeCode)).not.toContain("INTERNAL:qc");
  });

  test("existing tasks are refreshed, not duplicated; VO omission skips and re-opens", () => {
    const existing = [
      { id: 10, trade_code: "PAINTING", fix_phase: "single", state: "open" },
      { id: 11, trade_code: "PLUMBING", fix_phase: "single", state: "skipped", skip_source: "vo_omitted" },
    ];
    const plan = planTradeTasks({
      works: [w("1", "PAINTING", { omitted: true }), w("2", "PLUMBING")],
      existing,
      typeStageKeys: ["design", "handover", "closed"],
    });
    expect(plan.create.filter((t) => t.fulfilmentKind === "po")).toEqual([]);
    expect(plan.autoSkip).toEqual([10]);
    expect(plan.reopen).toEqual([11]);
    expect(plan.refresh.map((r) => r.id).sort()).toEqual([10, 11]);
  });

  test("a trade that is entirely omitted before any task exists creates nothing", () => {
    const plan = planTradeTasks({ works: [w("1", "GRILL", { omitted: true })], existing: [], typeStageKeys: ["design", "handover", "closed"] });
    expect(plan.create.filter((t) => t.fulfilmentKind === "po")).toEqual([]);
  });
});

describe("tradeTaskStatus: dates only, never another task", () => {
  const base = { state: "open", fulfilment_kind: "po", planned_start: null, planned_end: null, actual_start: null, actual_end: null };
  test("statuses", () => {
    expect(tradeTaskStatus(base, "2026-10-09")).toBe("unscheduled");
    expect(tradeTaskStatus({ ...base, planned_start: "2026-10-12", planned_end: "2026-10-14" }, "2026-10-09")).toBe("planned");
    expect(tradeTaskStatus({ ...base, planned_start: "2026-10-01", planned_end: "2026-10-14" }, "2026-10-09")).toBe("late_start");
    expect(tradeTaskStatus({ ...base, planned_start: "2026-10-01", planned_end: "2026-10-14", actual_start: "2026-10-02" }, "2026-10-09")).toBe("in_progress");
    expect(tradeTaskStatus({ ...base, planned_end: "2026-10-08", actual_start: "2026-10-02" }, "2026-10-09")).toBe("overdue");
    expect(tradeTaskStatus({ ...base, planned_end: "2026-10-08", poFullyReceived: true }, "2026-10-09")).toBe("done");
    expect(tradeTaskStatus({ ...base, fulfilment_kind: "internal", planned_end: "2026-10-08", poFullyReceived: true }, "2026-10-09")).toBe("overdue");
    expect(tradeTaskStatus({ ...base, state: "skipped", planned_end: "2026-10-01" }, "2026-10-09")).toBe("skipped");
  });
  test("planned date validation", () => {
    expect(plannedDatesRefusal("2026-10-01", "2026-09-30")).toBe("end_before_start");
    expect(plannedDatesRefusal("10/01/2026", null)).toBe("invalid_date");
    expect(plannedDatesRefusal("2026-10-01", "2026-10-01")).toBeNull();
    expect(plannedDatesRefusal(null, null)).toBeNull();
  });
});

function cl(id: string, group: ContractLine["group"], qty = 1, extra: Partial<ContractLine> = {}): ContractLine {
  return { soItemId: id, category: group, group, subCategory: null, stageOverride: null, supplyByOwner: false, qty, room: null, description: null, itemCode: null, ...extra };
}

describe("derived board conditions", () => {
  const s = (o: number, r: number, d = 0): LineSupply => ({ orderedQty: o, receivedQty: r, deliveredQty: d });
  test("pending purchased / pending arrived / all arrived", () => {
    const lines = [cl("f1", "FURNITURE", 2), cl("a1", "APPLIANCE"), cl("w1", "WORKS")];
    expect(supplyCondition(lines, new Map(), ["FURNITURE", "APPLIANCE"], { excludeSupplyByOwner: true }).condition).toBe("pending_purchased");
    expect(supplyCondition(lines, new Map([["f1", s(2, 1)], ["a1", s(1, 1)]]), ["FURNITURE", "APPLIANCE"], { excludeSupplyByOwner: true }).condition).toBe("pending_arrived");
    expect(supplyCondition(lines, new Map([["f1", s(0, 0, 2)], ["a1", s(1, 1)]]), ["FURNITURE", "APPLIANCE"], { excludeSupplyByOwner: true }).condition).toBe("all_arrived");
  });
  test("supply-by-owner goods are left out; no lines -> none; no SO -> null", () => {
    const lines = [cl("f1", "FURNITURE", 1, { supplyByOwner: true }), cl("w1", "WORKS")];
    const c = boardConditions(lines, new Map([["w1", s(1, 0)]]));
    expect(c.furniture!.condition).toBe("none");
    expect(c.renoItem!.condition).toBe("pending_arrived");
    expect(boardConditions(null, new Map())).toEqual({ furniture: null, renoItem: null });
  });
  test("unit key status", () => {
    expect(unitKeyStatus(null, false)).toBe("unknown");
    expect(unitKeyStatus({ status: "pending" }, false)).toBe("not_collected");
    expect(unitKeyStatus({ status: "done" }, false)).toBe("collected");
    expect(unitKeyStatus({ status: "done" }, true)).toBe("returned");
  });
});

describe("POD coverage and evidence", () => {
  test("a stage is covered only when every owned line has a POD", () => {
    const qty = new Map([["a", 2], ["b", 1], ["c", 0]]);
    const pods = new Map([["a", { siteQty: 1, doPodQty: 1 }], ["b", { siteQty: 0, doPodQty: 0 }]]);
    expect(podCoverage({ ownedLineIds: ["a", "b", "c"] }, qty, pods)).toEqual({ total: 2, covered: 1, missing: ["b"] });
  });
  test("lines that never get a PO (owner-supplied goods, in-house, system rows) need no POD", () => {
    const qty = podQtyBySoItem([
      { soItemId: "tv", qty: 1, needsPod: true },
      { soItemId: "owner-sink", qty: 1, needsPod: false },
      { soItemId: "waived", qty: 1, needsPod: false },
      { soItemId: "legacy", qty: 2 },
    ]);
    expect([...qty.entries()]).toEqual([["tv", 1], ["legacy", 2]]);
    const pods = new Map([["tv", { siteQty: 1, doPodQty: 0 }], ["legacy", { siteQty: 2, doPodQty: 0 }]]);
    expect(podCoverage({ ownedLineIds: ["tv", "owner-sink", "waived", "legacy"] }, qty, pods)).toEqual({ total: 2, covered: 2, missing: [] });
  });
  test("evidence groups by room, unknown room last", () => {
    const g = groupEvidence([
      { id: "1", kind: "in_place", location: null, r2_key: "k1", source: "site_receipt" },
      { id: "2", kind: "in_place", location: "Kitchen", r2_key: "k2", source: "site_receipt" },
      { id: "3", kind: "after", location: "Master bedroom", r2_key: "k3", source: "site_receipt" },
      { id: "4", kind: "before", location: "Kitchen", r2_key: "k4", source: "site_receipt" },
    ]);
    expect(g.map((x) => [x.room, x.photos.length])).toEqual([["Kitchen", 2], ["Master bedroom", 1], ["No room", 1]]);
  });
});

describe("red flags", () => {
  test("raises overdue tasks, due billing, late snags, late handover", () => {
    const f = redFlags({
      today: "2026-10-09",
      views: [],
      taskStatuses: ["overdue", "planned", "late_start"],
      prompts: [{ instalmentId: "x", seq: 2, label: "", description: null, stage: "hardware", trigger: "stage_start", dueSen: null, actionable: true }],
      billingAvailable: true,
      hasSo: true,
      openSnags: [{ due_date: "2026-10-01" }, { due_date: null }],
      plannedHandoverDate: "2026-10-01",
      handedOver: false,
      gateOpen: true,
    });
    expect(f.map((x) => x.code)).toEqual(["task_overdue", "billing_due", "snag_overdue", "handover_overdue"]);
  });
});
