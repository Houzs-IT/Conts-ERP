import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");
const readSource = (path: string): string => readFileSync(resolve(SRC, path), "utf8");

const embedCss = readSource("conts/embed.css");
const nightValue = (name: string): string | undefined =>
  new RegExp(`${name}:\\s*([^;]+);`).exec(embedCss)?.[1].trim();

function contrastOnCard(hexColour: string): number {
  const luminance = (hex: string): number => {
    const [red, green, blue] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map((unit) => (unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [lighter, darker] = [luminance(hexColour), luminance("#1C2030")].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

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

  it("the phone shell's colour variables all have night values, and its inks read on the night card", () => {
    const shellBlock = /\.hz-m \{([^}]*)\}/.exec(readSource("mobile/mobile.css"))?.[1] ?? "";
    const colourVariables = [...shellBlock.matchAll(/(--[a-z0-9-]+):\s*#[0-9a-f]{6}/gi)].map((match) => match[1])
      .filter((name) => name !== "--ink-dark" && name !== "--gold-lt");
    const nightShell = /\[data-beta-skin="night"\] \.hz-m \{([^}]*)\}/.exec(embedCss)?.[1] ?? "";
    const nightOf = (name: string): string | undefined => new RegExp(`${name}:\\s*([^;]+);`).exec(nightShell)?.[1].trim();
    expect(colourVariables.length).toBeGreaterThan(10);
    expect(colourVariables.filter((name) => !nightOf(name))).toEqual([]);
    const lowInks = ["--ink", "--ink2", "--mut", "--brand", "--green", "--amber", "--red"]
      .filter((name) => contrastOnCard(nightOf(name) ?? "#000000") < 4.5);
    expect(lowInks).toEqual([]);
  });

  it("night fields take light text, a muted read-only text and a muted placeholder", () => {
    const fieldRule = /:is\(input:not\([^{]+\{([^}]*)\}/.exec(embedCss)?.[1] ?? "";
    const lockedRule = /:is\(input, select, textarea\):is\(\[readonly\], :disabled\) \{([^}]*)\}/.exec(embedCss)?.[1] ?? "";
    const textColourIn = (rule: string): string | undefined => /(?<![-\w])color:\s*(#[0-9A-F]{6})/i.exec(rule)?.[1];
    expect(textColourIn(fieldRule)).toBe("#EEF1F8");
    expect(textColourIn(lockedRule)).toBe("#B9C0D0");
    expect(embedCss).toMatch(/:is\(input, textarea\)::placeholder \{ color: #ADB4C5; \}/);
  });

  it("no field outside the light-only phone app sets an inline fixed light fill or dark text, which night would not reach", () => {
    const listTsx = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "mobile" ? [] : listTsx(path);
      return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
    });
    const offenders: string[] = [];
    for (const file of listTsx(SRC)) {
      const text = readFileSync(file, "utf8");
      if (!/<(input|select|textarea)\b/.test(text)) continue;
      const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node): void => {
        if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && ["input", "select", "textarea"].includes(node.tagName.getText())) {
          const style = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === "style");
          const styleText = style ? style.getText() : "";
          const fixedFill = /background(Color)?:\s*[^,}\n]*?(?<!, )'(#fff|#ffffff|white|#f4f6f3|#fef3c7)'/.test(styleText);
          const fixedInk = /\bcolor:\s*'#11140f'/.test(styleText);
          if (fixedFill || fixedInk) offenders.push(`${relative(SRC, file)}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
    expect(offenders).toEqual([]);
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
