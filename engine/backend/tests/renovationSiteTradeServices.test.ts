// Aircon install, Cleaning and Project management moved from WORKS to SERVICE (owner, 22 Oct 2026, migration
// 0141). Only the filing changed: a contract line of these sub-categories must drive the site exactly as a WORKS
// line did - same trade task, same stage, same auto-skip, same condition, same PO rule, same receipt photo rule.
import { describe, expect, test } from "vitest";
import {
  SITE_TRADE_SERVICES,
  isFixedSub,
  siteGroupOf,
  subCategoriesOf,
  validateCategoryPair,
} from "../src/scm/shared/renovation-catalog";
import { contractWorksLines } from "../src/services/renovation/contractSync";
import { planTradeTasks } from "../src/services/renovation/tradeTasks";
import { deriveStageViews, lineGroup, lineHomeStage, type ContractLine } from "../src/services/renovation/stages";
import { boardConditions } from "../src/services/renovation/conditions";
import type { RawLine } from "../src/services/renovation/load";
import { groupForPo, needsPurchaseOrder } from "../src/scm/lib/renovation-po-split";
import { lineGroupOf } from "../src/scm/routes/site-receipts";

const ALL = ["design", "key_permit", "defect_check", "shop_drawings", "hardware", "furniture", "appliances", "soft_furnishing", "handover", "warranty", "closed"];

function raw(id: string, group: ContractLine["group"], sub: string | null, extra: Partial<RawLine> = {}): RawLine {
  return {
    soItemId: id, category: group, group, subCategory: sub, stageOverride: null, supplyByOwner: false, qty: 1,
    room: null, description: null, itemCode: null, omitted: false, soDocNo: "SO-1", supplierId: null, ...extra,
  };
}

describe("catalog: the three are filed under SERVICE", () => {
  test("Service lists them after its own sub-categories; Works no longer does", () => {
    expect(subCategoriesOf("SERVICE").map((s) => s.code)).toEqual([
      "DELIVERY", "STYLING", "PHOTOSHOOT", "AIRBNB_SETUP", "AIRCON_INSTALL", "CLEANING", "PROJECT_MGMT",
    ]);
    for (const c of SITE_TRADE_SERVICES) expect(subCategoriesOf("WORKS").some((s) => s.code === c), c).toBe(false);
    expect(validateCategoryPair("SERVICE", "AIRCON_INSTALL")).toEqual({ ok: true });
    expect(validateCategoryPair("WORKS", "CLEANING")).toEqual({ ok: false, error: "sub_category_mismatch" });
  });

  test("siteGroupOf: the three work as WORKS, every other service stays SERVICE", () => {
    for (const c of SITE_TRADE_SERVICES) expect(siteGroupOf("SERVICE", c)).toBe("WORKS");
    expect(siteGroupOf("SERVICE", "aircon_install")).toBe("WORKS");
    expect(siteGroupOf("SERVICE", "DELIVERY")).toBe("SERVICE");
    expect(siteGroupOf("SERVICE", null)).toBe("SERVICE");
    expect(siteGroupOf("WORKS", "PAINTING")).toBe("WORKS");
    expect(siteGroupOf("FURNITURE", "CLEANING")).toBe("FURNITURE");
    expect(siteGroupOf(null, "CLEANING")).toBeNull();
  });

  test("the three stay fixed in settings like the Works trades; other services stay editable", () => {
    for (const c of SITE_TRADE_SERVICES) expect(isFixedSub("SERVICE", c)).toBe(true);
    expect(isFixedSub("WORKS", "PAINTING")).toBe(true);
    expect(isFixedSub("SERVICE", "DELIVERY")).toBe(false);
    expect(isFixedSub("SOFT", "CARPET")).toBe(false);
  });
});

describe("an SO with these lines drives the site as before", () => {
  const lines = [
    raw("a", "SERVICE", "AIRCON_INSTALL"),
    raw("c", "SERVICE", "CLEANING"),
    raw("p", "SERVICE", "PROJECT_MGMT"),
    raw("d", "SERVICE", "DELIVERY"),
    raw("e", "WORKS", "ELECTRICAL"),
  ];

  test("trade tasks: aircon install in hardware, cleaning in handover, project management none, delivery none", () => {
    const works = contractWorksLines({ allLines: lines, poLines: [] });
    expect(works.map((w) => w.trade)).toEqual(["AIRCON_INSTALL", "CLEANING", "PROJECT_MGMT", "ELECTRICAL"]);
    const plan = planTradeTasks({ works, existing: [], typeStageKeys: ALL });
    const po = plan.create.filter((t) => t.fulfilmentKind === "po");
    expect(po.find((t) => t.tradeCode === "AIRCON_INSTALL")).toMatchObject({ stageKey: "hardware", fixPhase: "single", label: "AIR CON INSTALLATION" });
    expect(po.find((t) => t.tradeCode === "CLEANING")).toMatchObject({ stageKey: "handover", seq: 950 });
    expect(po.some((t) => t.tradeCode === "PROJECT_MGMT")).toBe(false);
    expect(po.some((t) => t.tradeCode === "DELIVERY")).toBe(false);
  });

  test("an aircon-install-only SO keeps the hardware stage and auto-skips soft furnishing, as when it was WORKS", () => {
    const v = deriveStageViews({ typeStageKeys: ALL, stored: [], lines: [raw("a", "SERVICE", "AIRCON_INSTALL")] });
    const by = Object.fromEntries(v.map((s) => [s.key, s]));
    expect(by.hardware!.state).toBe("not_started");
    expect(by.soft_furnishing).toMatchObject({ state: "skipped", skipSource: "auto" });
    expect(by.hardware!.ownedLineIds).toContain("a");
  });

  test("home stage and group: hardware for the three, soft furnishing for other services", () => {
    for (const c of SITE_TRADE_SERVICES) {
      expect(lineGroup(raw("x", "SERVICE", c))).toBe("WORKS");
      expect(lineHomeStage(raw("x", "SERVICE", c))).toBe("hardware");
    }
    expect(lineHomeStage(raw("x", "SERVICE", "DELIVERY"))).toBe("soft_furnishing");
  });

  test("the reno-item condition still counts them", () => {
    const c = boardConditions([raw("a", "SERVICE", "AIRCON_INSTALL"), raw("d", "SERVICE", "DELIVERY")], new Map());
    expect(c.renoItem).toMatchObject({ condition: "pending_purchased", total: 1 });
    expect(c.furniture).toMatchObject({ condition: "none" });
  });

  test("owner-supplied: the install line still gets its PO; an owner-supplied delivery does not", () => {
    const base = { itemCode: "RN-X", supplyByOwner: true, category: "SERVICE", supplierId: "s1", unitCostSen: 100 };
    expect(needsPurchaseOrder({ ...base, subCategory: "AIRCON_INSTALL" })).toBe(true);
    expect(needsPurchaseOrder({ ...base, subCategory: "DELIVERY" })).toBe(false);
    const row = (id: string, sub: string) => ({
      line_id: id, so_item_id: id, kind: "ITEM" as const, item_code: `RN-${sub}`, description: sub, qty: 1, measure: null, measure_uom: null,
      uom: "LOT", unit_cost_sen: 100, supply_by_owner: true, supplier_id: "s1", supplier_code: "S1", supplier_name: "Sup",
      category: "SERVICE", sub_category: sub, item_description2: null, item_uom: "LOT", ordered_qty: 0,
    });
    const out = groupForPo([row("a", "AIRCON_INSTALL"), row("d", "DELIVERY")]);
    expect(out.groups.flatMap((g) => g.lines.map((l) => l.lineId))).toEqual(["a"]);
    expect(out.groups[0]!.categoryGroup).toBe("SERVICE");
    expect(out.skipped.map((l) => l.lineId)).toEqual(["d"]);
  });

  test("site receipt: an aircon install line is a trade (no supplier DO photo), a service delivery is goods", () => {
    expect(lineGroupOf({ category: "SERVICE", category_group: "SERVICE", sub_category: "AIRCON_INSTALL" })).toBe("WORKS");
    expect(lineGroupOf({ category: "SERVICE", category_group: "SERVICE", sub_category: "DELIVERY" })).toBe("SERVICE");
  });
});
