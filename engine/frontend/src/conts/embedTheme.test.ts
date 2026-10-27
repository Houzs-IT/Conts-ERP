import { describe, expect, it } from "vitest";
import { betaSkinFor } from "./embed";

describe("Theme hand-off", () => {
  it("Property OS's dark theme is the night skin, light the vision one, anything else nothing", () => {
    expect(betaSkinFor("dark")).toBe("night");
    expect(betaSkinFor("light")).toBe("vision");
    expect(betaSkinFor("sepia")).toBeNull();
    expect(betaSkinFor(undefined)).toBeNull();
  });
});
