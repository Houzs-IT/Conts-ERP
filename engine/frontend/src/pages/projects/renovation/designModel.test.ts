import { describe, expect, test } from "vitest";
import { currentDesignStep, designStatus, subDateEdit, twoDTimeline } from "./designModel";

const file = (id: number, submitted: string | null, uploaded: string) => ({ id, submitted_on: submitted, uploaded_at: uploaded });
const note = (id: number, noted: string, closedBy: number | null) => ({ id, noted_on: noted, closed_by_file_id: closedBy });

describe("2D versions and amendment requests", () => {
  test("versions are numbered V1..Vn by submit date (upload time, then id, break ties), whatever their stored version", () => {
    const t = twoDTimeline([file(9, "2026-10-12", "2026-10-12T05:00:00Z"), file(4, "2026-10-02", "2026-10-13T01:00:00Z"), file(7, null, "2026-10-08T02:00:00Z")], []);
    expect(t.versions.map((v) => [v.file.id, v.number])).toEqual([[9, 3], [7, 2], [4, 1]]);
    expect(t.state).toBe("submitted");
  });
  test("an open request puts 2D in Amending; the version that closed a request lists it", () => {
    const files = [file(1, "2026-10-01", "2026-10-01T01:00:00Z"), file(2, "2026-10-06", "2026-10-06T01:00:00Z")];
    const t = twoDTimeline(files, [note(10, "2026-10-03", 2), note(11, "2026-10-04", 2), note(12, "2026-10-08", null)]);
    expect(t.state).toBe("amending");
    expect(t.openCount).toBe(1);
    expect(t.versions[0]).toMatchObject({ number: 2 });
    expect(t.versions[0]!.answered.map((n) => n.id)).toEqual([10, 11]);
    expect(t.requests.map((r) => [r.note.id, r.open, r.answeredBy])).toEqual([[12, true, null], [11, false, 2], [10, false, 2]]);
  });
  test("no version yet: nothing submitted, even with a request", () => {
    expect(twoDTimeline([], []).state).toBe("none");
    expect(twoDTimeline([], [note(1, "2026-10-01", null)]).state).toBe("none");
  });
});

describe("which design step opens by default", () => {
  test("the first step that is not done: Onsite, then 3D, then 2D", () => {
    expect(currentDesignStep({ onsite: 0, threeD: 0, twoD: 0 })).toBe("onsite");
    expect(currentDesignStep({ onsite: 2, threeD: 0, twoD: 0 })).toBe("3d");
    expect(currentDesignStep({ onsite: 1, threeD: 1, twoD: 0 })).toBe("2d");
    expect(currentDesignStep({ onsite: 1, threeD: 3, twoD: 1 })).toBe("2d");
  });
});

describe("typing a sub-category date (procurement)", () => {
  const sub = { mode: "follow" as const, effective: { poDate: "2026-10-20", deliveryDate: "2026-10-30" } };
  test("a date makes it its own, keeping the other date it showed", () => {
    expect(subDateEdit(sub, "po", "2026-10-22")).toEqual({ mode: "own", poDate: "2026-10-22", deliveryDate: "2026-10-30" });
    expect(subDateEdit(sub, "delivery", "2026-11-02")).toEqual({ mode: "own", poDate: "2026-10-20", deliveryDate: "2026-11-02" });
  });
  test("emptying one date keeps the other as its own; emptying both means no dates", () => {
    expect(subDateEdit(sub, "po", null)).toEqual({ mode: "own", poDate: null, deliveryDate: "2026-10-30" });
    const half = { mode: "own" as const, effective: { poDate: null, deliveryDate: "2026-10-30" } };
    expect(subDateEdit(half, "delivery", null)).toEqual({ mode: "none" });
  });
});

describe("design status line and request numbers", () => {
  test("plain status for the card header", () => {
    expect(designStatus({ onsite: 0, threeD: 0, twoD: 0 }, "none")).toBe("Waiting for onsite");
    expect(designStatus({ onsite: 1, threeD: 0, twoD: 0 }, "none")).toBe("Waiting for 3D");
    expect(designStatus({ onsite: 1, threeD: 1, twoD: 0 }, "none")).toBe("Waiting for 2D");
    expect(designStatus({ onsite: 1, threeD: 1, twoD: 2 }, "amending")).toBe("2D amending");
    expect(designStatus({ onsite: 1, threeD: 1, twoD: 2 }, "submitted")).toBe("2D submitted");
  });
  test("requests are numbered #1.. in the order they were made", () => {
    const t = twoDTimeline([file(1, "2026-10-01", "2026-10-01T01:00:00Z")], [note(12, "2026-10-08", null), note(10, "2026-10-03", null)]);
    expect(t.requests.map((r) => [r.note.id, r.number])).toEqual([[12, 2], [10, 1]]);
  });
});
