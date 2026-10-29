/* Person access by product category: who sees which line (PLAN-category-rbac.md v2, phase 1). Pure pieces only, no database. */
import { describe, expect, it } from "vitest";
import { keepVisiblePos, lineVisible, scopeOfRows, type CategoryScope } from "./categoryAccess";
import { scopeVos, type VoLine, type VoRow } from "./renovation/betaVoPo";

const scopeOf = (rows: Array<[string, string | null]>): CategoryScope => {
  const scope = scopeOfRows(rows.map(([group_code, sub_code]) => ({ group_code, sub_code })));
  if (!scope) throw new Error("no scope");
  return scope;
};

describe("lineVisible", () => {
  it("shows everything when there is no scope (a person with no rows)", () => {
    expect(lineVisible(null, "SOFT", "CURTAIN_BLINDS")).toBe(true);
    expect(lineVisible(null, null, null)).toBe(true);
    expect(scopeOfRows([])).toBeNull();
  });

  it("a group ticked whole shows all its sub-categories and lines without one", () => {
    const scope = scopeOf([["SOFT", null]]);
    expect(lineVisible(scope, "SOFT", "CURTAIN_BLINDS")).toBe(true);
    expect(lineVisible(scope, "SOFT", "BEDDING")).toBe(true);
    expect(lineVisible(scope, "SOFT", null)).toBe(true);
    expect(lineVisible(scope, "WORKS", "PAINTING")).toBe(false);
  });

  it("a single sub-category shows only that one", () => {
    const scope = scopeOf([["SOFT", "CURTAIN_BLINDS"]]);
    expect(lineVisible(scope, "SOFT", "CURTAIN_BLINDS")).toBe(true);
    expect(lineVisible(scope, "SOFT", "BEDDING")).toBe(false);
    expect(lineVisible(scope, "SOFT", null)).toBe(false);
    // The same sub code under another group is another sub-category.
    expect(lineVisible(scope, "WORKS", "CURTAIN_BLINDS")).toBe(false);
  });

  it("uncategorised lines need the Uncategorised tick", () => {
    expect(lineVisible(scopeOf([["SOFT", null]]), null, null)).toBe(false);
    expect(lineVisible(scopeOf([["SOFT", null], ["OTHER", null]]), null, null)).toBe(true);
    expect(lineVisible(scopeOf([["OTHER", null]]), "SOFT", "CURTAIN_BLINDS")).toBe(false);
  });
});

describe("rows to scope", () => {
  it("rows of any shape make a scope, none make none", () => {
    expect(scopeOfRows([])).toBeNull();
    const scope = scopeOf([["SOFT", null], ["WORKS", "PAINTING"], ["OTHER", null]]);
    expect([...scope.groups]).toEqual(["SOFT"]);
    expect([...scope.subs]).toEqual(["WORKS/PAINTING"]);
    expect(scope.other).toBe(true);
  });
});

describe("a PO is visible when one of its lines is", () => {
  const pending = [{ id: "a", po: "PO1" }, { id: "b", po: "PO2" }];
  const scope = scopeOf([["SOFT", null]]);
  it("keeps only POs that hold a visible line", () => {
    expect(keepVisiblePos(pending, (x) => x.po, ["PO2", "PO2"], scope).map((x) => x.id)).toEqual(["b"]);
    expect(keepVisiblePos(pending, (x) => x.po, [], scope)).toEqual([]);
  });
  it("keeps everything when there is no scope", () => {
    expect(keepVisiblePos(pending, (x) => x.po, [], null)).toEqual(pending);
  });
});

describe("VOs under a category scope", () => {
  const line = (categoryCode: string | null, subCode: string | null, amountSen: number): VoLine => ({
    itemCode: null, description: "", room: null, qty: 1, lineQty: 1, measure: null, amountSen, change: "add", goesTo: "po", fromItemCode: null, categoryCode, subCode,
  });
  const vo = (no: string, lines: VoLine[], netSen: number | null): VoRow => ({
    key: no, label: "", source: "amendment", no, soDocNo: "SO-1", title: null, status: "", statusLabel: "", bucket: "approved", date: null, raisedBy: null,
    approvedBy: null, approvedAt: null, recorded: true, netSen, href: "", lines,
  });
  const scope = scopeOf([["SOFT", "CURTAIN_BLINDS"]]);

  it("keeps every VO when there is no scope", () => {
    const all = [vo("A", [line("WORKS", "PAINTING", 100)], 100)];
    expect(scopeVos(all, null)).toEqual(all);
  });

  it("drops a VO whose lines are all hidden, keeps one with no lines, and nets a partly hidden one again", () => {
    const out = scopeVos([
      vo("HIDDEN", [line("WORKS", "PAINTING", 100)], 100),
      vo("EMPTY", [], 0),
      vo("PART", [line("WORKS", "PAINTING", 100), line("SOFT", "CURTAIN_BLINDS", 40)], 140),
    ], scope);
    expect(out.map((v) => v.no)).toEqual(["EMPTY", "PART"]);
    expect(out[1]?.lines).toHaveLength(1);
    expect(out[1]?.netSen).toBe(40);
  });
});
