import { describe, expect, it } from "vitest";
import { slaWriteFor, stepSlaViewOf } from "../src/services/renovation/stepSla";
import { renovationListScope } from "../src/services/renovation/listScope";

const steps = [
  { key: "design" as const, label: "Design", defaultDays: 14 },
  { key: "signed" as const, label: "Signed", defaultDays: null },
  { key: "renovation" as const, label: "Renovation", defaultDays: 45 },
  { key: "closed" as const, label: "Closed", defaultDays: null },
];

describe("step SLA view", () => {
  it("counts days in the step against the copied days and says how far over", () => {
    const v = stepSlaViewOf({ current: "design", steps, rows: [{ step_key: "design", entered_on: "2026-10-01", sla_days: 14, sla_source: "default" }], today: "2026-10-20" });
    expect(v).toMatchObject({ daysIn: 19, days: 14, overdueBy: 5, totalDays: 59 });
    expect(v.steps.map((s) => s.key)).toEqual(["design", "signed", "renovation"]);
  });

  it("is not overdue on the last allowed day, nor without an SLA", () => {
    expect(stepSlaViewOf({ current: "design", steps, rows: [{ step_key: "design", entered_on: "2026-10-01", sla_days: 14, sla_source: "default" }], today: "2026-10-15" }).overdueBy).toBeNull();
    expect(stepSlaViewOf({ current: "signed", steps, rows: [{ step_key: "signed", entered_on: "2026-01-01", sla_days: null, sla_source: null }], today: "2026-10-15" }).overdueBy).toBeNull();
  });

  it("a project's own number wins over the default, also in the total", () => {
    const v = stepSlaViewOf({ current: "renovation", steps, rows: [{ step_key: "renovation", entered_on: "2026-10-01", sla_days: 60, sla_source: "project" }], today: "2026-10-02" });
    expect(v.days).toBe(60);
    expect(v.totalDays).toBe(74);
    expect(v.steps.find((s) => s.key === "renovation")).toMatchObject({ days: 60, source: "project", defaultDays: 45 });
  });
});

describe("what to write when a project is seen in a step", () => {
  it("copies the default and the entry day the first time", () => {
    expect(slaWriteFor({ current: "design", entryDay: "2026-09-01", defaultDays: 14, today: "2026-10-16", row: undefined }))
      .toEqual({ enteredOn: "2026-09-01", days: 14, source: "default" });
  });
  it("uses today when the data does not say when the step was entered", () => {
    expect(slaWriteFor({ current: "signed", entryDay: null, defaultDays: null, today: "2026-10-16", row: undefined }))
      .toEqual({ enteredOn: "2026-10-16", days: null, source: null });
  });
  it("keeps what was copied when the default changes later", () => {
    expect(slaWriteFor({ current: "design", entryDay: "2026-09-01", defaultDays: 30, today: "2026-10-16", row: { entered_on: "2026-09-01", sla_days: 14, sla_source: "default" } })).toBeNull();
  });
  it("takes the first default set after the step was entered without one", () => {
    expect(slaWriteFor({ current: "design", entryDay: "2026-09-01", defaultDays: 30, today: "2026-10-16", row: { entered_on: "2026-09-01", sla_days: null, sla_source: null } }))
      .toEqual({ enteredOn: "2026-09-01", days: 30, source: "default" });
  });
  it("fills the entry day of a step whose days were set ahead of time, keeping those days", () => {
    expect(slaWriteFor({ current: "renovation", entryDay: "2026-10-10", defaultDays: 45, today: "2026-10-16", row: { entered_on: null, sla_days: 60, sla_source: "project" } }))
      .toEqual({ enteredOn: "2026-10-10", days: 60, source: "project" });
  });
  it("writes nothing for Closed", () => {
    expect(slaWriteFor({ current: "closed", entryDay: null, defaultDays: 5, today: "2026-10-16", row: undefined })).toBeNull();
  });
});

describe("list filter Overdue", () => {
  const rows = [
    { id: 1, step: "design", createdAt: null, plannedHandover: null, handedOverAt: null, overdue: true },
    { id: 2, step: "design", createdAt: null, plannedHandover: null, handedOverAt: null, overdue: false },
    { id: 3, step: "renovation", createdAt: null, plannedHandover: null, handedOverAt: null, overdue: true },
  ];
  it("keeps only overdue projects, together with a picked step", () => {
    expect(renovationListScope(rows, { steps: [], hideClosed: false, overdue: true, from: "", to: "" }).onlyIds).toEqual([1, 3]);
    expect(renovationListScope(rows, { steps: ["design"], hideClosed: false, overdue: true, from: "", to: "" }).onlyIds).toEqual([1]);
  });
  it("uses the SLA total to end the calendar bar when there is no planned handover", () => {
    const r = [{ id: 9, step: "design", createdAt: null, plannedHandover: null, handedOverAt: null, startDate: "2026-01-01", slaDays: 100 }];
    expect(renovationListScope(r, { steps: [], hideClosed: false, from: "2026-04-01", to: "2026-04-30" }).rangeIds).toEqual([9]);
    expect(renovationListScope(r, { steps: [], hideClosed: false, from: "2026-06-01", to: "2026-06-30" }).rangeIds).toEqual([]);
  });
});
