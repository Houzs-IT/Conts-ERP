import { describe, expect, it } from "vitest";
import { placePanel } from "./pickerPlace";

// Where the picker's drop-down sits (chew 3 Nov 2026: "可能是往下显示", like AutoCount's Proj. No. list): under the
// field when there is room, above it near the bottom of the screen, and always inside the window.
describe("placePanel", () => {
  const view = { width: 1280, height: 800 };

  it("opens under the field, as wide as asked, starting at the field's left edge", () => {
    expect(placePanel({ top: 100, bottom: 130, left: 200, width: 160 }, view, 720)).toEqual({ left: 200, width: 720, top: 134, maxHeight: 420 });
  });

  it("opens upward when the field is near the bottom of the screen", () => {
    expect(placePanel({ top: 700, bottom: 730, left: 200, width: 160 }, view, 720)).toEqual({ left: 200, width: 720, bottom: 104, maxHeight: 420 });
  });

  it("stays inside the window on the right and is never narrower than the field", () => {
    expect(placePanel({ top: 100, bottom: 130, left: 1000, width: 160 }, view, 720)).toEqual({ left: 552, width: 720, top: 134, maxHeight: 420 });
    expect(placePanel({ top: 100, bottom: 130, left: 20, width: 500 }, view, 360).width).toBe(500);
  });

  it("shrinks to the window on a narrow screen and to the room left below", () => {
    expect(placePanel({ top: 100, bottom: 130, left: 40, width: 160 }, { width: 600, height: 800 }, 720)).toEqual({ left: 8, width: 584, top: 134, maxHeight: 420 });
    expect(placePanel({ top: 300, bottom: 330, left: 40, width: 160 }, { width: 1280, height: 600 }, 720)).toEqual({ left: 40, width: 720, top: 334, maxHeight: 258 });
  });
});
