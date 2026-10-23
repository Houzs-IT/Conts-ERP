import { describe, expect, it } from "vitest";
import type { TaskViewV2 } from "../projects/renovation/simpleApi";
import type { BetaPayments } from "./renovationBetaApi";
import type { SiteStep } from "./renovationBetaModel";
import type { DefectTicket, SiteDelivery } from "./renovationBetaSiteApi";
import { areaChips, dueLine, filterDeliveries, overdueCount, photosByPo, siteStepsPlus, ticketColumns } from "./renovationBetaSiteModel";

const photo = (id: string, area: string | null, image = true) => ({ id, path: `/x/${id}`, name: id, image, area, at: null, source: "site" as const });
const delivery = (over: Partial<SiteDelivery>): SiteDelivery => ({
  type: "goods_received", id: "g", no: "GRN-1", at: null, status: "RECEIVED", from: null, poNumber: null, poIds: [], areas: [], photos: [], ...over,
});

describe("Site & photos", () => {
  const list = [
    delivery({ id: "g1", areas: ["Kitchen"], poIds: ["po-1"], photos: [photo("a", "Kitchen"), photo("b", null), photo("c", "Living")] }),
    delivery({ id: "d1", type: "delivery_order", areas: ["Master bedroom"], photos: [photo("p", null)] }),
  ];

  it("offers only rooms a delivery carries, in the sales order's order, then rooms only a delivery names", () => {
    expect(areaChips(["Bathroom 1", "Kitchen", "Master bedroom"], list)).toEqual(["Kitchen", "Master bedroom", "Living"]);
  });

  it("keeps the deliveries for an area with that area's photos and the untagged ones", () => {
    expect(filterDeliveries(list, "kitchen").map((d) => [d.id, d.photos.map((p) => p.id)])).toEqual([["g1", ["a", "b"]]]);
    expect(filterDeliveries(list, "Living").map((d) => [d.id, d.photos.map((p) => p.id)])).toEqual([["g1", ["c"]]]);
    expect(filterDeliveries(list, "Master bedroom").map((d) => d.id)).toEqual(["d1"]);
    expect(filterDeliveries(list, "")).toHaveLength(2);
  });

  it("counts photos per purchase order from its goods receipts", () => {
    expect(photosByPo(list).get("po-1")).toBe(3);
  });
});

const ticket = (over: Partial<DefectTicket>): DefectTicket => ({
  id: 1, phase: "snag", location: null, description: null, trade: null, dueDate: null, reportedAt: null, reportedByName: null, photoKey: null, afterPhotoKey: null,
  fixedAt: null, fixedByName: null, closedAt: null, closedByName: null, redoCount: 0, assigneeId: null, assigneeName: null, assigneePhone: null, lastRedoNote: null, ...over,
});

describe("Defect pipeline", () => {
  const today = "2026-10-24";
  const all = [
    ticket({ id: 1, dueDate: "2026-10-30" }),
    ticket({ id: 2, dueDate: "2026-10-20" }),
    ticket({ id: 3 }),
    ticket({ id: 4, fixedAt: "2026-10-23T02:00:00Z" }),
    ticket({ id: 5, fixedAt: "2026-10-20T02:00:00Z", closedAt: "2026-10-21T02:00:00Z" }),
  ];

  it("puts late ones first in To fix and splits by state", () => {
    const c = ticketColumns(all, today);
    expect(c.to_fix.map((t) => t.id)).toEqual([2, 1, 3]);
    expect(c.check.map((t) => t.id)).toEqual([4]);
    expect(c.done.map((t) => t.id)).toEqual([5]);
    expect(overdueCount(all, today)).toBe(1);
  });

  it("words the fix-by line, overdue in red", () => {
    const fmt = (d: string) => d;
    expect(dueLine(all[1], today, fmt)).toEqual({ text: "Overdue 4 days · was due 2026-10-20", late: true });
    expect(dueLine(all[0], today, fmt)).toEqual({ text: "Fix by 2026-10-30", late: false });
    expect(dueLine(ticket({ dueDate: today }), today, fmt)?.text).toBe("Fix by today");
    expect(dueLine(ticket({ dueDate: "2026-10-01", fixedAt: "2026-10-02T00:00:00Z" }), today, fmt)).toBeNull();
  });
});

describe("Site progress", () => {
  const task = (id: number, stage: string, po: string | null): TaskViewV2 => ({ id, stage_key: stage, purchase_order_id: po } as unknown as TaskViewV2);
  const steps: SiteStep[] = [
    { id: "task-1", state: "done", date: "2026-10-01", label: "Hacking", sub: "Done" },
    { id: "task-2", state: "current", date: "2026-10-24", label: "Cabinets", sub: null },
    { id: "handover", state: "handover", date: "2026-11-20", label: "Handover", sub: null },
  ];
  const payments: BetaPayments = {
    state: "ok", contractSen: 100, receivedSen: 10, instalments: [
      { seq: 1, label: "Deposit", amountSen: 10, paidSen: 10, status: "paid", stageCode: "design", trigger: "x" },
      { seq: 2, label: "2nd", amountSen: 50, paidSen: 0, status: "billed", stageCode: "hardware", trigger: "x" },
      { seq: 3, label: "Final", amountSen: 40, paidSen: 0, status: "not_billed", stageCode: "handover", trigger: "x" },
    ],
  };

  it("adds the photos and the payment a step waits for", () => {
    const rows = siteStepsPlus(steps, [task(1, "hardware", "po-1"), task(2, "hardware", "po-2")], payments, new Map([["po-2", 4]]));
    expect(rows.map((r) => [r.id, r.photos, r.waitsFor])).toEqual([
      ["task-1", 0, null],
      ["task-2", 4, "Waits for 2nd payment"],
      ["handover", 0, "Waits for 3rd payment"],
    ]);
  });

  it("says nothing about payments when they are hidden", () => {
    expect(siteStepsPlus(steps, [task(2, "hardware", null)], { state: "hidden" }, new Map()).every((r) => r.waitsFor == null)).toBe(true);
  });
});
