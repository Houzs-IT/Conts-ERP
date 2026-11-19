import { describe, expect, test } from "vitest";
import { designSteps, designTrack, renovationCategories, type StageInputs } from "../src/services/renovation/stageRules";
import { LEGACY_WORK_TYPES } from "../src/services/renovation/workTypes";

const TODAY = "2026-11-19";
const empty: StageInputs = {
  hasSo: true, payment: { contractSen: 100_00, receivedSen: 10_00, paidInstalments: 1 }, workTypes: LEGACY_WORK_TYPES,
  measuredOn: null, appointments: [], works: [], files: [], notes: [], reviews: [], variants: { lines: 0, missing: 0 }, voCount: 0,
  categories: [], lines: [],
};
const step = (i: StageInputs, code: string) => designSteps(i, TODAY).find((s) => s.code === code)!;

describe("Design steps (same rules as the Beta board's Design progress)", () => {
  test("the works In Design in their order, then Variants", () => {
    expect(designSteps(empty, TODAY).map((s) => s.code)).toEqual(["measure", "w3d", "w2d", "payment_2", "carpentry", "briefing", "variants"]);
  });
  test("a work taken out of Design or archived is not a step; a custom work In Design is", () => {
    const workTypes = [
      ...LEGACY_WORK_TYPES.map((w) => (w.code === "payment_2" ? { ...w, inDesign: false } : w.code === "briefing" ? { ...w, active: false } : w)),
      { id: 99, code: "lighting_walk", label: "Lighting walk", rule: "booking" as const, bookable: true, inDesign: true, sortOrder: 70, active: true, system: false },
    ];
    expect(designSteps({ ...empty, workTypes }, TODAY).map((s) => s.code)).toEqual(["measure", "w3d", "w2d", "carpentry", "lighting_walk", "variants"]);
  });
  test("site measure: a recorded measure, or the booked day has passed; today or later is only booked", () => {
    expect(step(empty, "measure")).toMatchObject({ done: false, state: "Not booked" });
    expect(step({ ...empty, measuredOn: "2026-11-25" }, "measure")).toMatchObject({ done: true, date: "2026-11-25", state: "Measured" });
    const appt = (onDate: string, doneAt: string | null = null) => ({ ...empty, appointments: [{ kind: "site_measure", onDate, doneAt }] });
    expect(step(appt("2026-11-18"), "measure")).toMatchObject({ done: true, date: "2026-11-18" });
    expect(step(appt(TODAY), "measure")).toMatchObject({ done: false, state: "Booked" });
    expect(step(appt("2026-11-30", "2026-11-19T02:00:00Z"), "measure").done).toBe(true);
  });
  test("carpentry and briefing read their appointments; another work its newest booking", () => {
    const i = {
      ...empty,
      appointments: [{ kind: "carpentry_measure", onDate: "2026-11-10", doneAt: null }, { kind: "site_briefing", onDate: "2026-12-01", doneAt: null }],
      workTypes: [...LEGACY_WORK_TYPES, { id: 99, code: "lighting_walk", label: "Lighting walk", rule: "booking" as const, bookable: true, inDesign: true, sortOrder: 70, active: true, system: false }],
      works: [{ type: "lighting_walk", onDate: "2026-11-01", done: false }],
    };
    expect(step(i, "carpentry").done).toBe(true);
    expect(step(i, "briefing")).toMatchObject({ done: false, state: "Booked", date: "2026-12-01" });
    expect(step(i, "lighting_walk").done).toBe(true);
  });
  test("3D: newest version approved and no open amendment note", () => {
    const f1 = { id: 1, kind: "3d" as const, version: 1, submittedOn: "2026-11-01" };
    const f2 = { id: 2, kind: "3d" as const, version: 2, submittedOn: "2026-11-10" };
    expect(step({ ...empty, files: [f1] }, "w3d")).toMatchObject({ done: false, state: "Waiting approval" });
    expect(step({ ...empty, files: [f1], reviews: [{ fileId: 1, approvedOn: "2026-11-05" }] }, "w3d")).toMatchObject({ done: true, date: "2026-11-05", state: "Approved" });
    // an older version approved does not approve the newest
    expect(step({ ...empty, files: [f1, f2], reviews: [{ fileId: 1, approvedOn: "2026-11-05" }] }, "w3d").done).toBe(false);
    // a note after the newest version stays open
    const late = { id: 7, kind: "3d" as const, notedOn: "2026-11-12", closedOn: null };
    expect(step({ ...empty, files: [f1, f2], notes: [late], reviews: [{ fileId: 2, approvedOn: "2026-11-11" }] }, "w3d")).toMatchObject({ done: false, state: "Amendment open" });
    // a note answered by a later version, or closed, is not open
    const answered = { id: 8, kind: "3d" as const, notedOn: "2026-11-05", closedOn: null };
    expect(designTrack({ files: [f1, f2], notes: [answered], reviews: [{ fileId: 2, approvedOn: "2026-11-11" }] }, "3d")).toMatchObject({ approved: true, openNotes: 0 });
    expect(step({ ...empty, files: [f1, f2], notes: [{ ...late, closedOn: "2026-11-13" }], reviews: [{ fileId: 2, approvedOn: "2026-11-11" }] }, "w3d").done).toBe(true);
    expect(step(empty, "w2d")).toMatchObject({ done: false, state: "Not started" });
  });
  test("second payment: two instalments fully received", () => {
    expect(step(empty, "payment_2")).toMatchObject({ done: false, state: "Waiting payment" });
    expect(step({ ...empty, payment: { contractSen: 1, receivedSen: 1, paidInstalments: 2 } }, "payment_2").done).toBe(true);
    expect(step({ ...empty, payment: null }, "payment_2")).toMatchObject({ done: false, state: "No sales order" });
  });
  test("variants: lines exist and none misses a required variant", () => {
    expect(step(empty, "variants")).toMatchObject({ done: false, state: "No sales order lines" });
    expect(step({ ...empty, variants: { lines: 4, missing: 1 } }, "variants")).toMatchObject({ done: false, state: "1 of 4 lines missing variants" });
    expect(step({ ...empty, variants: { lines: 4, missing: 0 } }, "variants").done).toBe(true);
  });
});

describe("Renovation categories", () => {
  const categories = [{ code: "CARPENTRY", label: "Carpentry" }, { code: "LIGHTING", label: "Lighting" }, { code: "PAINT", label: "Paint" }];
  test("every catalog category, with the project's lines and how many are delivered", () => {
    const r = renovationCategories({
      categories,
      lines: [
        { category: "CARPENTRY", qty: 2, delivered: 2 }, { category: "CARPENTRY", qty: 1, delivered: 0 },
        { category: "PAINT", qty: 1, delivered: 1 },
      ],
    });
    expect(r).toEqual([
      { code: "CARPENTRY", label: "Carpentry", onProject: true, done: false, linesDone: 1, linesTotal: 2 },
      { code: "LIGHTING", label: "Lighting", onProject: false, done: false, linesDone: 0, linesTotal: 0 },
      { code: "PAINT", label: "Paint", onProject: true, done: true, linesDone: 1, linesTotal: 1 },
    ]);
  });
  test("a line with no catalog category is still counted, under Other", () => {
    const r = renovationCategories({ categories, lines: [{ category: null, qty: 1, delivered: 0 }] });
    expect(r[r.length - 1]).toEqual({ code: "OTHER", label: "Other", onProject: true, done: false, linesDone: 0, linesTotal: 1 });
  });
});
