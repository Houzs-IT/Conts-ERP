import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import postcss, { type Declaration, type Root, type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import {
  contsNightPostcss,
  contsPalettePostcss,
  isNightMappedFile,
  mapRuleForNight,
  pickSelectorsIn,
  recolourCssValue,
} from "../../conts/palette.mjs";

const SRC_DIR = resolve(__dirname, "..");
// Written as "#" + digits so the build-time palette swap (contsPaletteVite) leaves these Houzs literals as they are.
const WHITE = "#" + "fff";
const WHITE_LONG = "#" + "ffffff";
const INK = "#" + "11140f";
const BORDER = "#" + "d6d9d2";
const SURFACE_DIM = "#" + "e3e6e0";
const PETROL = "#" + "16695f";
const PETROL_DEEP = "#" + "0c3f39";
const MUTED = "#" + "767b6e";
const FESTIVE_RED = "#" + "b8331f";

function firstRule(css: string): Rule {
  const rule = postcss.parse(css).first;
  if (rule?.type !== "rule") throw new Error(`not a rule: ${css}`);
  return rule;
}

function declValues(rule: Rule): Record<string, string> {
  const values: Record<string, string> = {};
  rule.walkDecls((decl) => {
    values[decl.prop] = decl.value;
  });
  return values;
}

describe("night mapping of one rule", () => {
  it("maps white as a background to the surface", () => {
    const rule = firstRule(`.card { background: ${WHITE}; }`);
    mapRuleForNight(rule);
    expect(declValues(rule).background).toBe("rgb(var(--eng-surface))");
  });

  it("keeps white as text and lists it", () => {
    const rule = firstRule(`.chip { color: ${WHITE_LONG}; }`);
    const left = mapRuleForNight(rule);
    expect(declValues(rule).color).toBe(WHITE_LONG);
    expect(left).toEqual([{ prop: "color", hex: "ffffff", reason: "white or pale text keeps its own fill" }]);
  });

  it("maps inks by role, in any letter case", () => {
    const rule = firstRule(`.meta { color: ${MUTED.toUpperCase()}; fill: ${INK}; stroke: ${FESTIVE_RED}; }`);
    mapRuleForNight(rule);
    expect(declValues(rule)).toEqual({
      color: `var(--fg-muted, ${MUTED})`,
      fill: "rgb(var(--eng-ink))",
      stroke: `var(--c-festive-b, ${FESTIVE_RED})`,
    });
  });

  it("maps borders inside shorthands and the paler border tone", () => {
    const rule = firstRule(`.row { border-bottom: 1px solid ${BORDER}; border-top: 1px dashed ${SURFACE_DIM}; }`);
    mapRuleForNight(rule);
    expect(declValues(rule)).toEqual({
      "border-bottom": "1px solid rgb(var(--eng-border))",
      "border-top": "1px dashed rgb(var(--eng-border-subtle))",
    });
  });

  it("maps a dark accent fill and its white text together to the chosen-pill pair", () => {
    const rule = firstRule(`.on { background: ${PETROL}; color: ${WHITE}; border-color: ${PETROL}; }`);
    const left = mapRuleForNight(rule);
    expect(declValues(rule)).toEqual({
      background: `var(--conts-pick-fill, ${PETROL})`,
      color: `var(--conts-pick-ink, ${WHITE})`,
      "border-color": `var(--conts-pick-fill, ${PETROL})`,
    });
    expect(left).toEqual([]);
  });

  it("leaves a dark accent fill alone when its text is set by an unrelated rule", () => {
    const rule = firstRule(`.bar { background: ${PETROL_DEEP}; }`);
    const left = mapRuleForNight(rule);
    expect(declValues(rule).background).toBe(PETROL_DEEP);
    expect(left).toEqual([{ prop: "background", hex: "0c3f39", reason: "dark accent fill without white text in the same rule" }]);
  });

  it("carries the chosen-pill pair to the pill's hover and its insides", () => {
    const root: Root = postcss.parse(
      `.on { background: ${PETROL}; color: ${WHITE}; } .on:hover:not(:disabled) { background: ${PETROL_DEEP}; } .on .dot { background: ${WHITE}; }`,
    );
    const picks = pickSelectorsIn(root);
    const [, hover, dot] = root.nodes;
    if (hover.type !== "rule" || dot.type !== "rule") throw new Error("expected three rules");
    mapRuleForNight(hover, picks);
    mapRuleForNight(dot, picks);
    expect(declValues(hover).background).toBe(`var(--conts-pick-fill, ${PETROL_DEEP})`);
    expect(declValues(dot).background).toBe(`var(--conts-pick-ink, ${WHITE})`);
  });

  it("leaves literals in properties with no colour role, in urls, with alpha and in custom properties", () => {
    const svg = `url("data:image/svg+xml,<svg fill='${WHITE}'/>")`;
    const rule = firstRule(`.x { box-shadow: 0 0 0 1px ${BORDER}; background: ${svg}; color: ${PETROL}80; --ink: ${INK}; }`);
    const left = mapRuleForNight(rule);
    expect(declValues(rule)).toEqual({
      "box-shadow": `0 0 0 1px ${BORDER}`,
      background: svg,
      color: `${PETROL}80`,
      "--ink": INK,
    });
    expect(left).toEqual([{ prop: "box-shadow", hex: "d6d9d2", reason: "property has no colour role" }]);
  });

  it("leaves a literal that is already a variable's fallback", () => {
    const rule = firstRule(`.ok { color: var(--c-secondary-a, ${INK}); }`);
    expect(mapRuleForNight(rule)).toEqual([{ prop: "color", hex: "11140f", reason: "already a variable fallback" }]);
    expect(declValues(rule).color).toBe(`var(--c-secondary-a, ${INK})`);
  });

  it("maps only the engine's own CSS, not the theme files", () => {
    expect(isNightMappedFile(join(SRC_DIR, "pages/scm-v2/Inventory.module.css"))).toBe(true);
    expect(isNightMappedFile(join(SRC_DIR, "conts/embed.css"))).toBe(false);
    expect(isNightMappedFile(join(SRC_DIR, "index.css"))).toBe(false);
    expect(isNightMappedFile(join(SRC_DIR, "vendor/design-system/tokens.css"))).toBe(false);
    expect(isNightMappedFile(resolve(SRC_DIR, "../node_modules/x/y.css"))).toBe(false);
  });

  it("leaves rules that only apply on night", async () => {
    const css = `:global(html[data-beta-skin="night"]) .x { background: ${WHITE}; }`;
    const mapped = await postcss([contsNightPostcss()]).process(css, { from: join(SRC_DIR, "pages/scm-v2/Example.module.css") });
    expect(mapped.css).toBe(css);
  });
});

function lightVariables(): Map<string, string> {
  const variables = new Map<string, string>();
  for (const file of ["vendor/design-system/tokens.css", "index.css"]) {
    postcss.parse(readFileSync(join(SRC_DIR, file), "utf8")).walkRules(":root", (rule: Rule) => {
      rule.walkDecls(/^--/, (decl: Declaration) => {
        variables.set(decl.prop, recolourCssValue(decl.value));
      });
    });
  }
  return variables;
}

function resolveLight(value: string, variables: Map<string, string>): string {
  return value
    .replace(/rgb\(var\((--eng-[\w-]+)\)\)/g, (_whole, name: string) => `rgb(${variables.get(name) ?? "missing"})`)
    .replace(/var\((--[\w-]+), ([^()]+)\)/g, (_whole, name: string, fallback: string) => variables.get(name) ?? fallback);
}

function canonicalColours(value: string): string {
  return value
    .replace(/#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/gi, (_whole, digits: string) => {
      const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits;
      return `rgb(${[0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)).join(",")})`;
    })
    .replace(/rgb\((\d+)[\s,]+(\d+)[\s,]+(\d+)\)/g, "rgb($1,$2,$3)")
    .toLowerCase();
}

function lightValues(root: Root, variables: Map<string, string>): string[] {
  const values: string[] = [];
  root.walkDecls((decl) => {
    values.push(canonicalColours(`${decl.prop}: ${resolveLight(decl.value, variables)}`));
  });
  return values;
}

const cssFiles = readdirSync(SRC_DIR, { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".css"))
  .map((path) => join(SRC_DIR, path));

describe("light output with the night step", () => {
  const variables = lightVariables();

  it("finds the engine's CSS files", () => {
    expect(cssFiles.length).toBeGreaterThan(30);
  });

  it.each(cssFiles.map((file) => [file.slice(SRC_DIR.length + 1), file]))("%s keeps every light colour", async (_name, file) => {
    const source = readFileSync(file, "utf8");
    const before = await postcss([contsPalettePostcss()]).process(source, { from: file });
    const after = await postcss([contsNightPostcss(), contsPalettePostcss()]).process(source, { from: file });
    expect(lightValues(after.root, variables)).toEqual(lightValues(before.root, variables));
  });
});
