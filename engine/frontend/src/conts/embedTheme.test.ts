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

  it("night re-points the engine's neutral colours and the design tokens in one block", () => {
    const css = readFileSync(resolve(__dirname, "embed.css"), "utf8");
    const row = /--dt-row:\s*([^;]+);/.exec(css)?.[1].trim();
    const night = BETA_SKIN_CSS.slice(BETA_SKIN_CSS.indexOf('html[data-beta-skin="night"]{'));
    expect(css).toContain("--eng-surface: 28 32 48;");
    expect(css).toContain("--c-cream: #1C2030;");
    expect(night).toContain(`--beta-surface:${row};`);
    expect(night).toContain("--beta-ink:#EEF1F8;");
  });

  it("no night rule is guarded by a white-card exclusion", () => {
    const css = readFileSync(resolve(__dirname, "embed.css"), "utf8");
    const nightRules = css.split(/\r?\n/).filter((line) => line.includes('data-beta-skin="night"'));
    expect(nightRules.length).toBeGreaterThan(0);
    for (const rule of nightRules) expect(rule).not.toContain(":not(.bg-surface");
  });

  it("the night Mail Center (embed.css) takes the Beta night surface and inks", () => {
    const css = readFileSync(resolve(__dirname, "embed.css"), "utf8");
    const night = BETA_SKIN_CSS.slice(BETA_SKIN_CSS.indexOf('html[data-beta-skin="night"]{'));
    expect(css).toContain('[data-beta-skin="night"] .mail-center .bg-surface { background: #1C2030; }');
    expect(night).toContain("--beta-surface:#1C2030;");
    for (const [ink, token] of [["#EEF1F8", "ink"], ["#B9C0D0", "text2"], ["#ADB4C5", "muted"]]) {
      expect(css).toMatch(new RegExp(`\\.mail-center :is\\(\\[class\\^="text-ink[^)]*\\) \\{ color: ${ink}; \\}`));
      expect(night).toContain(`--beta-${token}:${ink};`);
    }
  });

  it("the night Chart of accounts cards (embed.css) are dark and re-point the type colours", () => {
    const css = readFileSync(resolve(__dirname, "embed.css"), "utf8");
    expect(css).toMatch(/\[data-beta-skin="night"\] \.coa-card \{\s*background: #1C2030;[^}]*--coa-asset: #7FD1A8;/);
  });
});
