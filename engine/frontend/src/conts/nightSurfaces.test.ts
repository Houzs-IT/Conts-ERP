import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");
const readSource = (path: string): string => readFileSync(resolve(SRC, path), "utf8");

const embedCss = readSource("conts/embed.css");
const nightValue = (name: string): string | undefined =>
  new RegExp(`${name}:\\s*([^;]+);`).exec(embedCss)?.[1].trim();

function withoutVariables(css: string): string {
  let stripped = css;
  for (let previous = ""; previous !== stripped; ) {
    previous = stripped;
    stripped = stripped.replace(/var\([^()]*(\([^()]*\))?[^()]*\)/g, "");
  }
  return stripped;
}

const bareColours = (css: string): string[] => withoutVariables(css).match(/#[0-9a-f]{3,8}\b/gi) ?? [];

function ruleBodies(css: string, selectorPattern: RegExp): Array<[string, string]> {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((rule): [string, string] => [rule[1].trim(), rule[2]])
    .filter(([selector]) => selectorPattern.test(selector));
}

function bareColoursIn(path: string, selectorPattern: RegExp): string[] {
  const bodies = ruleBodies(readSource(path), selectorPattern);
  expect(bodies.length).toBeGreaterThan(0);
  return bodies.flatMap(([selector, body]) => bareColours(body).map((colour) => `${path} ${selector} ${colour}`));
}

describe("night surfaces the engine paints with fixed light colours", () => {
  it("shared cards, their header and title take night-aware colours", () => {
    expect(bareColoursIn("pages/scm-v2/SalesOrderDetail.module.css", /^\.card(Header|Title)?$/)).toEqual([]);
  });

  it("the Outstanding module tiles are not fixed white", () => {
    const tileStyles = readSource("pages/scm-v2/Outstanding.tsx").split("\n").filter((line) => /background:|border:|boxShadow:/.test(line));
    expect(tileStyles.filter((line) => /#ffffff|'#16695f'|px #16695f/.test(line))).toEqual([]);
  });

  it("a DateField's box is the same sunken fill and edge as the night input inside it", () => {
    expect(bareColoursIn("vendor/scm/components/DateField.module.css", /^\.wrap$/)).toEqual([]);
    const dateField = readSource("vendor/scm/components/DateField.module.css");
    expect(dateField).toContain("var(--field-fill,");
    expect(dateField).toContain("var(--field-edge,");
    const nightInput = /:is\(input:not\([^{]+\{\s*background-color:\s*(#[0-9A-Fa-f]{6});\s*border-color:\s*(#[0-9A-Fa-f]{6});/.exec(embedCss);
    expect(nightInput?.slice(1)).toEqual([nightValue("--field-fill"), nightValue("--field-edge")]);
  });

  it("shared field and select text follows the night ink", () => {
    expect(bareColoursIn("pages/scm-v2/SalesOrderDetail.module.css", /^\.fieldInput,\s*\.fieldSelect$|\.fieldInput:disabled|\.fieldLabel$|\.selectChevron$/)).toEqual([]);
  });

  it("filter pills and their chosen state are not white and near-black on night", () => {
    expect([
      ...bareColoursIn("pages/scm-v2/Inventory.module.css", /\.(chip|whFilterButton|codeChip)\b/),
      ...bareColoursIn("vendor/scm/components/DeliveryPlanningBoard.module.css", /\.regionChip/),
    ]).toEqual([]);
    const creditNoteTabs = /role="tablist" aria-label="Note kind"[\s\S]*?<\/div>/.exec(readSource("pages/scm-v2/CreditNotes.tsx"))?.[0] ?? "";
    expect(creditNoteTabs).toContain("--badge-pill-chosen-bg");
    expect(bareColours(creditNoteTabs)).toEqual([]);
  });

  it("warehouse rack stat values read on the dark card", () => {
    const statInk = /const STAT_INK[^}]+\}/.exec(readSource("pages/scm-v2/WarehouseRacks.tsx"))?.[0] ?? "";
    expect(statInk).not.toBe("");
    expect(bareColours(statInk)).toEqual([]);
  });

  it("statement and ledger errors use the night error ink and the account range fields get an edge", () => {
    const errorLines = ["pages/scm-v2/Reports.tsx", "pages/scm-v2/GeneralLedger.tsx"].flatMap((path) =>
      readSource(path).split("\n").filter((line) => line.includes("did not load")),
    );
    expect(errorLines.length).toBe(3);
    expect(errorLines.filter((line) => !line.includes("--badge-error-fg"))).toEqual([]);
    expect(nightValue("--badge-error-fg")).toBe("#FF9B90");
    const ledger = readSource("pages/scm-v2/GeneralLedger.tsx");
    for (const label of ["From account", "To account"]) {
      const rangeField = ledger.split("\n").find((line) => line.includes(`aria-label="${label}"`)) ?? "";
      expect(rangeField).toContain("var(--field-edge-width,0px)");
    }
    expect(nightValue("--field-edge-width")).toBe("1px");
  });
});
