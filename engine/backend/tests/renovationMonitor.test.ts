import { describe, expect, test } from "vitest";
import {
  QUEUES,
  involvesPerson,
  monitorFlags,
  monitorQueues,
  type MonitorFacts,
  type QueueKey,
} from "../src/services/renovation/monitor";

const TODAY = "2026-10-11";

/** A signed project with everything in order: belongs to no action queue. */
const calm: MonitorFacts = {
  step: "signed",
  hold: null,
  hasSo: true,
  createdAt: "2026-10-01",
  contractSen: 100_000_00,
  receivedSen: 20_000_00,
  receivedPct: 20,
  voOpen: 0,
  quotationsOpen: 0,
  siteMeasured: true,
  has2d: true,
  has3d: true,
  scheduledTasks: 2,
  overdueTasks: 0,
  furniture: "all_arrived",
  renoItem: "all_arrived",
  handedOver: false,
  plannedHandoverDate: null,
};

const q = (over: Partial<MonitorFacts>) => monitorQueues({ ...calm, ...over }, TODAY);
const has = (over: Partial<MonitorFacts>, key: QueueKey) => q(over).includes(key);

describe("a project in order sits only in the ongoing list", () => {
  test("calm signed project", () => {
    expect(monitorQueues(calm, TODAY)).toEqual(["sales_ongoing"]);
  });
  test("every queue has a role and a label", () => {
    expect(new Set(QUEUES.map((x) => x.key)).size).toBe(QUEUES.length);
    for (const x of QUEUES) expect(x.label.length).toBeGreaterThan(0);
  });
});

describe("Sales queues", () => {
  test("no SO yet: an open project without a sales order", () => {
    expect(has({ hasSo: false, step: "design" }, "sales_no_so")).toBe(true);
    expect(has({ hasSo: false, step: "closed" }, "sales_no_so")).toBe(false);
    expect(has({}, "sales_no_so")).toBe(false);
  });
  test("payment behind: received below the step's norm", () => {
    expect(has({ step: "ordering", receivedPct: 39.9 }, "sales_payment_behind")).toBe(true);
    expect(has({ step: "ordering", receivedPct: 40 }, "sales_payment_behind")).toBe(false);
    expect(has({ step: "signed", receivedPct: 0 }, "sales_payment_behind")).toBe(true);
    expect(has({ step: "closed", receivedPct: 50 }, "sales_payment_behind")).toBe(false);
    expect(has({ receivedPct: null }, "sales_payment_behind")).toBe(false);
  });
  test("VO waiting: a VO in draft or sent", () => {
    expect(has({ voOpen: 1 }, "sales_vo_open")).toBe(true);
    expect(has({ voOpen: 0 }, "sales_vo_open")).toBe(false);
  });
  test("quotation open: draft or sent, not converted", () => {
    expect(has({ quotationsOpen: 2 }, "sales_quote_open")).toBe(true);
    expect(has({ quotationsOpen: 0 }, "sales_quote_open")).toBe(false);
  });
  test("all ongoing: everything not closed", () => {
    expect(has({ step: "handover" }, "sales_ongoing")).toBe(true);
    expect(has({ step: "closed" }, "sales_ongoing")).toBe(false);
  });
});

describe("Design queues", () => {
  test("in design: the Design step", () => {
    expect(has({ step: "design", hasSo: false }, "design_in_design")).toBe(true);
    expect(has({ step: "signed" }, "design_in_design")).toBe(false);
  });
  test("site measure not recorded: design to ordering only", () => {
    expect(has({ siteMeasured: false, step: "ordering" }, "design_no_measure")).toBe(true);
    expect(has({ siteMeasured: false, step: "renovation" }, "design_no_measure")).toBe(false);
    expect(has({ siteMeasured: true }, "design_no_measure")).toBe(false);
  });
  test("2D / 3D missing: either kind absent", () => {
    expect(has({ has2d: false }, "design_files_missing")).toBe(true);
    expect(has({ has3d: false }, "design_files_missing")).toBe(true);
    expect(has({ has2d: false, step: "handover" }, "design_files_missing")).toBe(false);
  });
});

describe("Renovation queues", () => {
  test("to arrange: signed or ordering with no scheduled site task", () => {
    expect(has({ step: "signed", scheduledTasks: 0 }, "reno_to_arrange")).toBe(true);
    expect(has({ step: "ordering", scheduledTasks: 0 }, "reno_to_arrange")).toBe(true);
    expect(has({ step: "ordering", scheduledTasks: 1 }, "reno_to_arrange")).toBe(false);
    expect(has({ step: "design", hasSo: false, scheduledTasks: 0 }, "reno_to_arrange")).toBe(false);
  });
  test("renovation in progress: the Renovation step", () => {
    expect(has({ step: "renovation", receivedPct: 70 }, "reno_in_progress")).toBe(true);
    expect(has({}, "reno_in_progress")).toBe(false);
  });
  test("overdue tasks: any site task past its dates", () => {
    expect(has({ overdueTasks: 1 }, "reno_overdue")).toBe(true);
    expect(has({ overdueTasks: 0 }, "reno_overdue")).toBe(false);
  });
});

describe("Admin queue", () => {
  test("paid, items not arrived: money in, furniture or reno items pending", () => {
    expect(has({ furniture: "pending_arrived" }, "admin_paid_not_arrived")).toBe(true);
    expect(has({ renoItem: "pending_purchased" }, "admin_paid_not_arrived")).toBe(true);
    expect(has({ furniture: "pending_arrived", receivedSen: 0 }, "admin_paid_not_arrived")).toBe(false);
    expect(has({ furniture: "pending_arrived", receivedSen: null }, "admin_paid_not_arrived")).toBe(false);
    expect(has({ furniture: "none", renoItem: "all_arrived" }, "admin_paid_not_arrived")).toBe(false);
  });
});

describe("Boss queues", () => {
  test("in defect: the IN DEFECT hold, not ON HOLD", () => {
    expect(has({ hold: "in_defect" }, "boss_in_defect")).toBe(true);
    expect(has({ hold: "on_hold" }, "boss_in_defect")).toBe(false);
  });
  test("overdue: late tasks or a passed planned handover", () => {
    expect(has({ overdueTasks: 2 }, "boss_overdue")).toBe(true);
    expect(has({ plannedHandoverDate: "2026-10-10" }, "boss_overdue")).toBe(true);
    expect(has({ plannedHandoverDate: "2026-10-11" }, "boss_overdue")).toBe(false);
    expect(has({ plannedHandoverDate: "2026-10-10", handedOver: true }, "boss_overdue")).toBe(false);
  });
  test("closed: the Closed step", () => {
    expect(has({ step: "closed" }, "boss_closed")).toBe(true);
    expect(has({}, "boss_closed")).toBe(false);
  });
});

describe("red flags", () => {
  const fl = (over: Partial<MonitorFacts>) => monitorFlags({ ...calm, ...over }, TODAY);
  test("a calm project has none", () => {
    expect(fl({})).toEqual([]);
  });
  test("IN DEFECT and overdue tasks", () => {
    expect(fl({ hold: "in_defect", overdueTasks: 1 })).toEqual(["in_defect", "task_overdue"]);
  });
  test("no SO more than 14 days after the project was created", () => {
    expect(fl({ hasSo: false, step: "design", createdAt: "2026-09-26" })).toContain("no_so_after_days");
    expect(fl({ hasSo: false, step: "design", createdAt: "2026-09-27" })).not.toContain("no_so_after_days");
    expect(fl({ hasSo: false, step: "design", createdAt: "2026-09-27T12:00:00Z" })).not.toContain("no_so_after_days");
  });
  test("handed over but not fully paid; hidden money raises nothing", () => {
    expect(fl({ handedOver: true, step: "handover" })).toContain("handed_over_unpaid");
    expect(fl({ handedOver: true, step: "closed", receivedSen: 100_000_00 })).not.toContain("handed_over_unpaid");
    expect(fl({ handedOver: true, step: "handover", contractSen: null, receivedSen: null })).not.toContain("handed_over_unpaid");
  });
});

describe("person filter: my projects", () => {
  const p = { salesPersonId: 1, designerPersonId: 2, renoPicPersonId: 3, crewIds: [7, 8] };
  test("everyone when no person is picked", () => {
    expect(involvesPerson(p, null)).toBe(true);
  });
  test("sales, designer, renovation PIC or crew", () => {
    for (const id of [1, 2, 3, 7, 8]) expect(involvesPerson(p, id)).toBe(true);
    expect(involvesPerson(p, 9)).toBe(false);
  });
});
