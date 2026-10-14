import { describe, expect, it } from "vitest";
import { renoPoCategoryClashes, renoPoCategoryRefusal } from "./renovationPoCategory";
import type { RenoDocInfo } from "../../vendor/scm/lib/renovation-doc-print";

const info = (over: Partial<NonNullable<RenoDocInfo["info"]>> = {}, lines: RenoDocInfo["lines"] = {}): RenoDocInfo => ({
  ready: true,
  info: { projectId: 7, projectCode: "RN-1", projectName: "B-8-2", building: "", unitNo: "", soDocNos: [], poNumbers: [], categoryGroup: "WORKS", subCategory: "", ...over },
  lines,
});
const groups: Record<string, string> = { "TILE-1": "WORKS", "SOFA-1": "FURNITURE", "LAMP-1": "LIGHTING" };
const groupOf = (code: string) => groups[code];

describe("renoPoCategoryRefusal", () => {
  it("turns the database refusal in a failed save's body into plain words", () => {
    const err = Object.assign(new Error("The system hit a problem."), {
      body: JSON.stringify({ error: "insert_failed", reason: "A renovation purchase order holds one category: this PO is WORKS, the line SOFA-1 is FURNITURE. Raise a separate PO for FURNITURE." }),
    });
    expect(renoPoCategoryRefusal(err)).toBe(
      "A renovation purchase order holds one category: this PO is Works, the line SOFA-1 is Furniture. Raise a separate PO for Furniture.",
    );
  });

  it("is null for any other failure", () => {
    expect(renoPoCategoryRefusal(new Error("Network error"))).toBeNull();
    expect(renoPoCategoryRefusal(Object.assign(new Error("x"), { body: '{"error":"insert_failed","reason":"duplicate key"}' }))).toBeNull();
    expect(renoPoCategoryRefusal(null)).toBeNull();
  });
});

describe("renoPoCategoryClashes", () => {
  it("names a new line of another category before Save", () => {
    const out = renoPoCategoryClashes(info(), [{ rid: "a", itemCode: "TILE-1" }, { rid: "b", itemCode: "SOFA-1" }], groupOf);
    expect([...out.keys()]).toEqual(["b"]);
    expect(out.get("b")).toContain("this PO is Works, the line SOFA-1 is Furniture");
  });

  it("takes the category from the first new line when the PO has none yet", () => {
    const out = renoPoCategoryClashes(info({ categoryGroup: "" }), [{ rid: "a", itemCode: "LAMP-1" }, { rid: "b", itemCode: "TILE-1" }], groupOf);
    expect(out.get("b")).toContain("this PO is Lighting");
  });

  it("uses a line saved earlier on the page when the PO's own category was not read yet", () => {
    const out = renoPoCategoryClashes(info({ categoryGroup: "" }), [{ rid: "a", itemId: "x", itemCode: "SOFA-1" }, { rid: "b", itemCode: "TILE-1" }], groupOf);
    expect(out.get("b")).toContain("this PO is Furniture");
  });

  it("never checks a PO without a project, or lines already saved", () => {
    expect(renoPoCategoryClashes(info({ projectId: null }), [{ rid: "b", itemCode: "SOFA-1" }], groupOf).size).toBe(0);
    expect(renoPoCategoryClashes(null, [{ rid: "b", itemCode: "SOFA-1" }], groupOf).size).toBe(0);
    expect(renoPoCategoryClashes(info(), [{ rid: "b", itemId: "y", itemCode: "SOFA-1" }], groupOf).size).toBe(0);
  });
});
