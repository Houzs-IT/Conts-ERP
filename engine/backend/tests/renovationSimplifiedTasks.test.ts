import { describe, expect, test } from "vitest";
import { TASK_CATEGORIES, taskCategoryDef } from "../src/scm/shared/renovation-stages";
import { manualTaskRow, planTradeTasks, tradeTaskLabel, type WorksLine } from "../src/services/renovation/tradeTasks";
import { linkRefusal, unlinkRefusal } from "../src/services/renovation/soLink";
import { flowFactsOf, moneyOf } from "../src/services/renovation/view";
import type { ProjectFacts } from "../src/services/renovation/load";

const cat = (code: string) => taskCategoryDef(code)!;
const works = (trade: string, soItemId: string, poId: string | null = null): WorksLine => ({ soItemId, trade, omitted: false, poItemId: poId ? `${poId}-i` : null, poId, supplierId: poId ? "s1" : null });

describe("task names follow the Notion categories", () => {
  test("contract trades take their category's wording", () => {
    expect(tradeTaskLabel("MASONRY_TILING", "single")).toBe("TILES INSTALLATION");
    expect(tradeTaskLabel("PLUMBING", "single")).toBe("PLUMBING WORK");
    expect(tradeTaskLabel("ELECTRICAL", "first")).toBe("WIRING & HACKING");
  });

  test("planned tasks carry their category code", () => {
    const plan = planTradeTasks({ works: [works("PARTITION", "a")], existing: [], typeStageKeys: ["design", "hardware", "handover", "closed"] });
    const part = plan.create.find((t) => t.tradeCode === "PARTITION")!;
    expect(part).toMatchObject({ categoryCode: "PARTITION", label: "PARTITION", fulfilmentKind: "po" });
    expect(plan.create.find((t) => t.tradeCode === "INTERNAL:qc")).toMatchObject({ categoryCode: "QC", label: "QC", fulfilmentKind: "internal" });
  });
});

describe("in-house crew and repeats", () => {
  test("a trade task switched to in-house crew is refreshed without a PO or supplier", () => {
    const plan = planTradeTasks({
      works: [works("PAINTING", "a", "po1")],
      existing: [{ id: 7, trade_code: "PAINTING", fix_phase: "single", state: "open", fulfilment_kind: "internal", occurrence: 1 }],
      typeStageKeys: ["hardware"],
    });
    const r = plan.refresh.find((t) => t.id === 7)!;
    expect(r.purchaseOrderId).toBeNull();
    expect(r.supplierId).toBeNull();
    expect(r.lines).toEqual([{ soItemId: "a", poItemId: "po1-i" }]);
  });

  test("a PO task still picks up its PO", () => {
    const plan = planTradeTasks({
      works: [works("PAINTING", "a", "po1")],
      existing: [{ id: 7, trade_code: "PAINTING", fix_phase: "single", state: "open", fulfilment_kind: "po", occurrence: 1 }],
      typeStageKeys: ["hardware"],
    });
    expect(plan.refresh.find((t) => t.id === 7)!.purchaseOrderId).toBe("po1");
  });

  test("the sync owns only the first occurrence of a trade", () => {
    const plan = planTradeTasks({
      works: [works("PAINTING", "a")],
      existing: [
        { id: 9, trade_code: "PAINTING", fix_phase: "single", state: "open", occurrence: 2 },
        { id: 8, trade_code: "PAINTING", fix_phase: "single", state: "open", occurrence: 1 },
      ],
      typeStageKeys: ["hardware"],
    });
    expect(plan.refresh.map((t) => t.id)).toEqual([8]);
    expect(plan.create.filter((t) => t.tradeCode === "PAINTING")).toHaveLength(0);
  });

  test("a hand-added task takes the next occurrence of its task code", () => {
    const existing = [{ trade_code: "PAINTING", fix_phase: "single", occurrence: 1 }, { trade_code: "PAINTING", fix_phase: "single", occurrence: 2 }];
    expect(manualTaskRow(cat("PAINTING"), existing)).toMatchObject({ tradeCode: "PAINTING", occurrence: 3, categoryCode: "PAINTING", fulfilmentKind: "internal" });
    expect(manualTaskRow(cat("PAINTING"), [], { fulfilment: "po" })).toMatchObject({ occurrence: 1, fulfilmentKind: "po" });
  });

  test("template and stand-alone categories get INTERNAL: / CAT: codes; templates are always our own people", () => {
    expect(manualTaskRow(cat("TOUCH_UP"), [], { fulfilment: "po" })).toMatchObject({ tradeCode: "INTERNAL:touch_up", fulfilmentKind: "internal", stageKey: "handover" });
    expect(manualTaskRow(cat("CURTAIN"), [], { fulfilment: "po" })).toMatchObject({ tradeCode: "CAT:CURTAIN", fulfilmentKind: "po", stageKey: "soft_furnishing" });
    expect(manualTaskRow(cat("SERVICE"), [])).toMatchObject({ tradeCode: "CAT:SERVICE", stageKey: "warranty" });
  });

  test("every category can be added by hand", () => {
    for (const c of TASK_CATEGORIES) expect(() => manualTaskRow(c, [])).not.toThrow();
  });
});

describe("linking and unlinking a sales order", () => {
  test("link: the SO must be a live renovation SO of this company with no other project, and the project must have none", () => {
    const so = { so_kind: "RENOVATION", status: "RENO_CONFIRMED", project_id: null, company_id: 1 };
    expect(linkRefusal(so, { projectCompanyId: 1, projectProjectSo: null, projectId: 5 })).toBeNull();
    expect(linkRefusal(null, { projectCompanyId: 1, projectProjectSo: null, projectId: 5 })).toBe("so_not_found");
    expect(linkRefusal({ ...so, company_id: 2 }, { projectCompanyId: 1, projectProjectSo: null, projectId: 5 })).toBe("so_not_found");
    expect(linkRefusal({ ...so, so_kind: "STANDARD" }, { projectCompanyId: 1, projectProjectSo: null, projectId: 5 })).toBeNull();
    expect(linkRefusal({ ...so, so_kind: "CONSIGNMENT" }, { projectCompanyId: 1, projectProjectSo: null, projectId: 5 })).toBe("not_renovation_so");
    /* only a contract is one per project: a form SO links beside it */
    expect(linkRefusal({ ...so, so_kind: "STANDARD" }, { projectCompanyId: 1, projectProjectSo: "SO-2", projectId: 5 })).toBeNull();
    expect(linkRefusal({ ...so, status: "CANCELLED" }, { projectCompanyId: 1, projectProjectSo: null, projectId: 5 })).toBe("so_cancelled");
    expect(linkRefusal({ ...so, project_id: 9 }, { projectCompanyId: 1, projectProjectSo: null, projectId: 5 })).toBe("so_has_other_project");
    expect(linkRefusal({ ...so, project_id: 5 }, { projectCompanyId: 1, projectProjectSo: "SO-1", projectId: 5 })).toBe("already_linked");
    expect(linkRefusal(so, { projectCompanyId: 1, projectProjectSo: "SO-2", projectId: 5 })).toBe("project_has_so");
  });

  test("unlink is refused while something downstream depends on the SO", () => {
    const free = { handedOver: false, receivedPoLines: 0, startedTasks: 0 };
    expect(unlinkRefusal(free)).toBeNull();
    expect(unlinkRefusal({ ...free, handedOver: true })?.code).toBe("handover_signed");
    expect(unlinkRefusal({ ...free, receivedPoLines: 2 })?.code).toBe("po_received");
    expect(unlinkRefusal({ ...free, startedTasks: 1 })?.code).toBe("tasks_started");
    expect(unlinkRefusal({ ...free, startedTasks: 1 })?.message).toMatch(/1 site task/);
  });
});

describe("what the project reads from the SO", () => {
  const base = {
    project: { closed_at: null, handed_over_at: null },
    so: { doc_no: "SO-1", local_total_sen: 900 },
    poLines: [],
    handover: null,
    billing: { available: true, contractSen: 1000_00, receivedTotalSen: 250_00, instalments: [] },
  } as unknown as ProjectFacts;

  test("contract total, received and percent; nothing without an SO", () => {
    expect(moneyOf(base)).toEqual({ contractSen: 1000_00, receivedSen: 250_00, receivedPct: 25 });
    expect(moneyOf({ ...base, so: null } as ProjectFacts)).toEqual({ contractSen: null, receivedSen: null, receivedPct: null });
  });

  test("billing unreadable: the SO total shows, received is unknown", () => {
    expect(moneyOf({ ...base, billing: { available: false, contractSen: null, instalments: [] } } as ProjectFacts))
      .toEqual({ contractSen: 900, receivedSen: null, receivedPct: null });
  });

  test("flow facts: a skipped task never counts as started; a received PO task does", () => {
    expect(flowFactsOf(base, [{ state: "skipped", actual_start: "2026-10-01", status: "skipped" }]).taskStarted).toBe(false);
    expect(flowFactsOf(base, [{ state: "open", actual_start: null, status: "done" }]).taskStarted).toBe(true);
    expect(flowFactsOf(base, [{ state: "open", actual_start: null, status: "planned" }]).taskStarted).toBe(false);
    expect(flowFactsOf(base, []).hasSo).toBe(true);
  });
});
