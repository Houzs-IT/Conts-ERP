import { describe, expect, it } from "vitest";
import type { EmptySources, ProjectPhoto } from "./renovationBetaMediaApi";
import { countBy, emptyMessage, emptySourceLines, filterPhotos, photoFilters, photoTimeline } from "./renovationBetaPhotosModel";
import { timelineTarget } from "./renovationBetaModel";

const NONE: EmptySources = { production: [], do: [], gr: [], po: [] };
const photo = (id: string, category: ProjectPhoto["category"], at: string, extra: Partial<ProjectPhoto> = {}): ProjectPhoto => ({
  id, path: `/x/${id}`, kind: "image", name: id, at, area: null, category, label: null, group: { key: `${category}:1`, title: "t" }, note: null, ...extra,
});

describe("Site & photos", () => {
  it("offers Production and PO only where the project has them", () => {
    expect(photoFilters([], NONE)).toEqual(["all", "progress", "do", "gr", "measure", "defect"]);
    expect(photoFilters([], { ...NONE, production: ["TC-PRO-1"], po: ["TC-PO-1"] })).toEqual(["all", "progress", "production", "do", "gr", "po", "measure", "defect"]);
    expect(photoFilters([photo("a", "production", "2026-11-07T03:00:00Z")], NONE)).toContain("production");
  });

  it("a production photo carried to its DO counts on the DO chip and once on All", () => {
    const list = [photo("a", "production", "2026-11-07T03:00:00Z"), photo("b", "do", "2026-11-07T03:00:00Z", { repeat: true })];
    expect(countBy(list)).toMatchObject({ all: 1, production: 1, do: 1 });
    expect(filterPhotos(list, "all", "").map((p) => p.id)).toEqual(["a"]);
    expect(filterPhotos(list, "do", "").map((p) => p.id)).toEqual(["b"]);
  });

  it("one production order makes one card per day", () => {
    const days = photoTimeline([
      photo("a", "production", "2026-11-07T03:00:00Z"), photo("b", "production", "2026-11-07T01:00:00Z"), photo("c", "production", "2026-11-05T03:00:00Z"),
    ]);
    expect(days.map((d) => [d.day, d.cards.length, d.cards[0].items.length])).toEqual([["2026-11-07", 1, 2], ["2026-11-05", 1, 1]]);
  });

  it("names the documents without a photo, briefly, per source", () => {
    const empty: EmptySources = { production: ["P1"], do: ["D1", "D2", "D3", "D4", "D5"], gr: [], po: ["O1"] };
    expect(emptySourceLines(empty, "all")).toEqual(["Production orders: P1", "DOs: D1, D2, D3 and 2 more", "POs: O1"]);
    expect(emptySourceLines(empty, "po")).toEqual(["POs: O1"]);
    expect(emptySourceLines(empty, "defect")).toEqual([]);
  });

  it("says why a view is empty", () => {
    expect(emptyMessage("all", "", false)).toMatch(/^No photos on this project yet\./);
    expect(emptyMessage("production", "", true)).toMatch(/Production Order/);
    expect(emptyMessage("do", "Kitchen", true)).toBe("No DO photos are tagged Kitchen.");
  });
});

describe("Timeline: where Open lands", () => {
  const doc = (kind: NonNullable<Parameters<typeof timelineTarget>[0]["doc"]>["kind"]) => ({ category: "system" as const, title: "x", doc: { kind, id: "abc", no: "NO-1" } });

  it("opens a document's own tab, on the document", () => {
    expect(timelineTarget(doc("do"))).toEqual({ label: "Open NO-1", tab: "do", focus: ["do", "NO-1"] });
    expect(timelineTarget(doc("gr"))).toEqual({ label: "Open NO-1", tab: "gr", focus: ["gr", "NO-1"] });
    expect(timelineTarget(doc("po"))).toEqual({ label: "Open NO-1", tab: "po" });
    expect(timelineTarget(doc("so"))).toEqual({ label: "Open NO-1", tab: "po" });
    expect(timelineTarget(doc("vo"))).toEqual({ label: "Open NO-1", tab: "vo" });
  });

  it("opens the page of a document with no tab", () => {
    expect(timelineTarget(doc("production"))).toEqual({ label: "Open NO-1", href: "/scm/production-orders/abc" });
    expect(timelineTarget(doc("invoice"))).toEqual({ label: "Open NO-1", href: "/scm/sales-invoices/abc" });
  });

  it("a note about a supplier opens nothing; a defect opens Defects", () => {
    expect(timelineTarget({ category: "supplier", title: null })).toBeNull();
    expect(timelineTarget({ category: "site", title: "Defect reported" })).toMatchObject({ tab: "defects" });
  });
});
