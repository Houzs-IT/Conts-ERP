import { describe, expect, it } from "vitest";
import { BETA, BETA_HEX, BETA_SKIN_CSS, TONES, betaTagTone } from "./renovationBetaTheme";

/** The CSS variable a token points at: "var(--beta-ink)" gives "--beta-ink". */
const nameOf = (v: string): string => /^var\((--beta-[\w-]+)\)$/.exec(v)?.[1] ?? "";

/** How many times the stylesheet defines the variable (light and night, and the reduced-transparency fallback for two). */
const definitions = (name: string): number => BETA_SKIN_CSS.split(`${name}:`).length - 1;

describe("Beta colours", () => {
  it("every token is a variable the stylesheet defines for both skins", () => {
    const names = [...Object.values(BETA), ...Object.values(TONES).flatMap((f) => Object.values(f))].map(nameOf);
    expect(names.every((n) => n !== "")).toBe(true);
    for (const n of names) expect(definitions(n), n).toBeGreaterThanOrEqual(2);
  });

  it("the light values come out as written for PDFs and canvases", () => {
    expect(BETA_HEX.ink).toBe("#111216");
    expect(BETA_HEX.accent).toBe("#0F5F58");
    expect(Object.values(BETA_HEX).some((v) => v.startsWith("var("))).toBe(false);
  });

  it("the dark values sit under the skin attribute and light is the default", () => {
    expect(BETA_SKIN_CSS).toContain(":root{");
    expect(BETA_SKIN_CSS).toContain('html[data-beta-skin="night"]{');
  });

  it("a building keeps its tint, and the tints vary", () => {
    expect(betaTagTone("Legacy OUG")).toEqual(betaTagTone("Legacy OUG"));
    const tints = new Set(["Legacy OUG", "Baron", "Jernih Kajang", "Aster Hill", "Trinity Wellnessa", "Lakeville", "Icon City", "Emerald"].map((n) => betaTagTone(n)[0]));
    expect(tints.size).toBeGreaterThan(1);
  });
});
