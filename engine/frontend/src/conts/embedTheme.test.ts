import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { betaSkinFor } from "./embed";
import { BETA_SKIN_CSS } from "../pages/renovation-beta/renovationBetaTheme";

describe("Theme hand-off", () => {
  it("Property OS's dark theme is the night skin, light the vision one, anything else nothing", () => {
    expect(betaSkinFor("dark")).toBe("night");
    expect(betaSkinFor("light")).toBe("vision");
    expect(betaSkinFor("sepia")).toBeNull();
    expect(betaSkinFor(undefined)).toBeNull();
  });

  it("every screen's page backdrop (embed.css) is the Beta screens' page, light and night", () => {
    const css = readFileSync(resolve(__dirname, "embed.css"), "utf8");
    const pages = [...css.matchAll(/--conts-page:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(pages).toHaveLength(2);
    for (const page of pages) expect(BETA_SKIN_CSS).toContain(`--beta-page:${page}`);
  });

  it("the night table (embed.css) takes the Beta night surface, so Beta's night ink stays readable on it", () => {
    const css = readFileSync(resolve(__dirname, "embed.css"), "utf8");
    const row = /--dt-row:\s*([^;]+);/.exec(css)?.[1].trim();
    const night = BETA_SKIN_CSS.slice(BETA_SKIN_CSS.indexOf('html[data-beta-skin="night"]{'));
    expect(night).toContain(`--beta-surface:${row};`);
    expect(css).toMatch(/\[data-beta-skin="night"\] \.dt-table:not\(\.bg-surface \.dt-table\) \.text-ink \{ color: #EEF1F8; \}/);
    expect(night).toContain("--beta-ink:#EEF1F8;");
  });
});
