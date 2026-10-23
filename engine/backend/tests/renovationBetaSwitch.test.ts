import { describe, expect, test } from "vitest";
import { isBetaEnabled } from "../src/scm/lib/renovation-beta-enabled";

describe("Beta switch (staging only, owner 23 Oct 2026)", () => {
  test("off unless BETA_ENABLED is exactly true", () => {
    expect(isBetaEnabled(undefined)).toBe(false);
    expect(isBetaEnabled(null)).toBe(false);
    expect(isBetaEnabled({})).toBe(false);
    expect(isBetaEnabled({ BETA_ENABLED: "" })).toBe(false);
    expect(isBetaEnabled({ BETA_ENABLED: "false" })).toBe(false);
    expect(isBetaEnabled({ BETA_ENABLED: "yes" })).toBe(false);
  });
  test("on for true, ignoring case and spaces", () => {
    expect(isBetaEnabled({ BETA_ENABLED: "true" })).toBe(true);
    expect(isBetaEnabled({ BETA_ENABLED: " TRUE " })).toBe(true);
  });
});
