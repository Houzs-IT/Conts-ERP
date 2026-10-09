import { describe, expect, test } from "vitest";
import {
  currentStage,
  deriveStageViews,
  lineHomeStage,
  manualSkipRefusal,
  nextNonSkipped,
  type ContractLine,
} from "../src/services/renovation/stages";

function line(id: string, group: ContractLine["group"], extra: Partial<ContractLine> = {}): ContractLine {
  return {
    soItemId: id, category: group, group, subCategory: null, stageOverride: null,
    supplyByOwner: false, qty: 1, room: null, description: null, itemCode: null, ...extra,
  };
}

const ALL = ["design", "key_permit", "defect_check", "shop_drawings", "hardware", "furniture", "appliances", "soft_furnishing", "handover", "warranty", "closed"];

describe("deriveStageViews", () => {
  test("no SO yet: nothing is auto-skipped, current stage is design", () => {
    const v = deriveStageViews({ typeStageKeys: ALL, stored: [], lines: null });
    expect(v).toHaveLength(11);
    expect(v.every((s) => s.state === "not_started")).toBe(true);
    expect(currentStage(v)).toBe("design");
  });

  test("auto-skip from SO contents: no furniture/appliance/soft lines", () => {
    const v = deriveStageViews({ typeStageKeys: ALL, stored: [], lines: [line("w1", "WORKS")] });
    const by = Object.fromEntries(v.map((s) => [s.key, s]));
    expect(by.hardware!.state).toBe("not_started");
    expect(by.furniture).toMatchObject({ state: "skipped", skipSource: "auto" });
    expect(by.appliances).toMatchObject({ state: "skipped", skipSource: "auto" });
    expect(by.soft_furnishing).toMatchObject({ state: "skipped", skipSource: "auto" });
    expect(by.key_permit!.state).toBe("not_started"); // no rule: never auto-skipped
  });

  test("a VO adding furniture lines re-opens the auto-skipped stage", () => {
    const before = deriveStageViews({ typeStageKeys: ALL, stored: [], lines: [line("w1", "WORKS")] });
    expect(before.find((s) => s.key === "furniture")!.state).toBe("skipped");
    const after = deriveStageViews({ typeStageKeys: ALL, stored: [], lines: [line("w1", "WORKS"), line("f1", "BUILTIN")] });
    expect(after.find((s) => s.key === "furniture")!.state).toBe("not_started");
  });

  test("precedence: manual skip beats type and auto, and keeps its reason", () => {
    const v = deriveStageViews({
      typeStageKeys: ["design", "handover", "closed", "furniture"],
      stored: [{ stage_key: "hardware", state: "skipped", skip_reason: "owner did hacking", skipped_by: 7, skipped_at: "2026-10-09" }],
      lines: [],
    });
    const hw = v.find((s) => s.key === "hardware")!;
    expect(hw).toMatchObject({ state: "skipped", skipSource: "manual", skipReason: "owner did hacking", skippedBy: 7 });
    expect(v.find((s) => s.key === "defect_check")).toMatchObject({ state: "skipped", skipSource: "type" });
    expect(v.find((s) => s.key === "furniture")).toMatchObject({ state: "skipped", skipSource: "auto" });
  });

  test("design, handover and closed are never skipped, whatever is stored", () => {
    const v = deriveStageViews({
      typeStageKeys: ["key_permit"],
      stored: [{ stage_key: "handover", state: "skipped", skip_reason: "xxx" }],
      lines: [],
    });
    for (const k of ["design", "handover", "closed"]) {
      expect(v.find((s) => s.key === k)!.state).not.toBe("skipped");
      expect(v.find((s) => s.key === k)!.skippable).toBe(false);
    }
  });

  test("lines move off skipped stages to the next stage that is not skipped", () => {
    const v = deriveStageViews({
      typeStageKeys: ["design", "key_permit", "shop_drawings", "furniture", "appliances", "handover", "warranty", "closed"],
      stored: [{ stage_key: "appliances", state: "skipped", skip_reason: "customer buys own", skipped_by: 1, skipped_at: "x" }],
      lines: [line("w1", "WORKS"), line("a1", "APPLIANCE"), line("f1", "FURNITURE")],
    });
    expect(v.find((s) => s.key === "furniture")!.ownedLineIds).toEqual(["w1", "f1"]); // hardware not in type -> furniture
    expect(v.find((s) => s.key === "handover")!.ownedLineIds).toEqual(["a1"]); // appliances skipped by hand; soft auto-skipped
  });

  test("a line's stage override wins over its group", () => {
    expect(lineHomeStage(line("x", "LIGHTING"))).toBe("hardware");
    expect(lineHomeStage(line("x", "LIGHTING", { stageOverride: "furniture" }))).toBe("furniture");
    expect(lineHomeStage(line("x", null, { category: "SOFA" }))).toBe("furniture");
  });

  test("stored progress is kept; current stage is the first not done or skipped", () => {
    const v = deriveStageViews({
      typeStageKeys: ALL,
      stored: [
        { stage_key: "design", state: "done" },
        { stage_key: "key_permit", state: "done" },
        { stage_key: "defect_check", state: "in_progress" },
      ],
      lines: [line("w1", "WORKS")],
    });
    expect(currentStage(v)).toBe("defect_check");
    expect(nextNonSkipped(v, "furniture")).toBe("handover");
  });

  test("all done: current stage is closed", () => {
    const v = deriveStageViews({
      typeStageKeys: ALL,
      stored: ALL.filter((k) => k !== "closed").map((k) => ({ stage_key: k, state: "done" })),
      lines: [],
    });
    expect(currentStage(v)).toBe("closed");
  });
});

describe("manualSkipRefusal", () => {
  const v = deriveStageViews({ typeStageKeys: ALL, stored: [{ stage_key: "key_permit", state: "done" }], lines: null });
  const by = (k: string) => v.find((s) => s.key === k);
  test("unskippable stages are refused", () => {
    expect(manualSkipRefusal(by("design"), "a good reason")).toBe("unskippable");
    expect(manualSkipRefusal(by("handover"), "a good reason")).toBe("unskippable");
  });
  test("a reason of at least 3 characters is required", () => {
    expect(manualSkipRefusal(by("hardware"), "  ")).toBe("reason_required");
    expect(manualSkipRefusal(by("hardware"), "ab")).toBe("reason_required");
    expect(manualSkipRefusal(by("hardware"), "abc")).toBeNull();
  });
  test("a done stage cannot be skipped; unknown stage refused", () => {
    expect(manualSkipRefusal(by("key_permit"), "reason")).toBe("already_done");
    expect(manualSkipRefusal(undefined, "reason")).toBe("unknown_stage");
  });
});
