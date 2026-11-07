import { describe, expect, it } from "vitest";
import { voCell } from "./renovationBetaHomeModel";

describe("voCell", () => {
  it("counts the VOs still open", () => {
    expect(voCell({ count: 3, approved: 2 })).toBe("1 open");
  });

  it("says approved when none is open", () => {
    expect(voCell({ count: 2, approved: 2 })).toBe("2 approved");
  });

  it("is empty for a project with no VO", () => {
    expect(voCell({ count: 0, approved: 0 })).toBeNull();
    expect(voCell(null)).toBeNull();
    expect(voCell(undefined)).toBeNull();
  });
});
