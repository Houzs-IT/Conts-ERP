import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");
const readSource = (path: string): string => readFileSync(resolve(SRC, path), "utf8");

const embedCss = readSource("conts/embed.css");
const nightValue = (name: string): string | undefined =>
  new RegExp(`${name}:\\s*([^;]+);`).exec(embedCss)?.[1].trim();

function contrast(firstHex: string, secondHex: string): number {
  const luminance = (hex: string): number => {
    const [red, green, blue] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map((unit) => (unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [lighter, darker] = [luminance(firstHex), luminance(secondHex)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

const contrastOnCard = (hexColour: string): number => contrast(hexColour, "#1C2030");

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
    expect(dateField).toContain("background: var(--input-bg-muted)");
    expect(dateField).toContain("border: 1px solid var(--input-border-soft)");
    expect(nightValue("--input-bg-muted")).toBe(nightValue("--input-bg"));
    expect(nightValue("--input-border-soft")).toBe(nightValue("--input-border"));
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

  it("night fields take their fill, text and edge from the paired input tokens, never fixed colours", () => {
    const fieldRule = /:is\(input:not\([^{]+\{([^}]*)\}/.exec(embedCss)?.[1] ?? "";
    const lockedRule = /:is\(input, select, textarea\):is\(\[readonly\], :disabled\) \{([^}]*)\}/.exec(embedCss)?.[1] ?? "";
    expect(fieldRule.replace(/\s+/g, " ").trim()).toBe("background-color: var(--input-bg); border-color: var(--input-border); color: var(--input-fg);");
    expect(lockedRule.replace(/\s+/g, " ").trim()).toBe("background-color: var(--input-bg-locked); border-color: var(--input-border-locked); color: var(--input-fg-muted);");
    expect(embedCss).toMatch(/:is\(input, textarea\)::placeholder \{ color: var\(--input-fg-muted\); \}/);
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
      expect(rangeField).toContain("var(--input-border-width,0px)");
    }
    expect(nightValue("--input-border-width")).toBe("1px");
  });
});

describe("form control tokens", () => {
  const engineRoot = readSource("index.css");
  const designTokens = readSource("vendor/design-system/tokens.css");
  const PAIRED_TOKENS = ["--input-bg", "--input-bg-muted", "--input-bg-locked", "--input-fg", "--input-fg-muted", "--input-border", "--input-border-soft", "--input-border-locked"];
  const palette = new Map(
    [...readFileSync(resolve(SRC, "../conts/palette.mjs"), "utf8").matchAll(/'([0-9a-f]{6})': '([0-9a-f]{6})'/g)].map((match) => [match[1], match[2]]),
  );
  const expandHex = (hex: string): string => (hex.length === 4 ? `#${[...hex.slice(1)].map((digit) => digit + digit).join("")}` : hex).toLowerCase();
  const lightHexOf = (name: string): string => {
    const value = new RegExp(`${name}:\\s*([^;]+);`).exec(engineRoot)?.[1].trim() ?? "";
    const literal = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value);
    if (literal) return `#${literal.slice(1).map((channel) => Number(channel).toString(16).padStart(2, "0")).join("")}`;
    const channels = /^rgb\(var\((--eng-[a-z0-9-]+)\)\)$/.exec(value);
    if (channels) {
      const triple = new RegExp(`${channels[1]}:\\s*(\\d+) (\\d+) (\\d+);`).exec(engineRoot)?.slice(1) ?? [];
      return `#${triple.map((channel) => Number(channel).toString(16).padStart(2, "0")).join("")}`;
    }
    const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value)?.[1];
    return expandHex(alias ? new RegExp(`${alias}:\\s*(#[0-9a-fA-F]{3,6})`).exec(designTokens)?.[1] ?? "" : value);
  };
  const shippedLight = (name: string): string => {
    const hex = lightHexOf(name);
    return `#${palette.get(hex.slice(1)) ?? hex.slice(1)}`;
  };
  const FIELD_LITERALS = /#fff\b|#ffffff\b|\bwhite\b|#f4f6f3\b|#11140f\b|#767b6e\b|#d6d9d2\b/i;
  const INPUT_LIKE = /\b(input|select|textarea)\b|[.#][\w-]*(input|Input|select|Select|field|Field|search|Search|textarea|Textarea|picker|Picker|combo|Combo)[\w-]*/;
  const NOT_A_FIELD = /label|Label|wrap|Wrap|row|Row|grid|Grid|list|List|item|Item|hint|Hint|error|Error|title|Title/;

  it("every paired token has a light value in index.css and a night value in embed.css", () => {
    expect(PAIRED_TOKENS.filter((name) => !new RegExp(`${name}:`).test(engineRoot))).toEqual([]);
    expect(PAIRED_TOKENS.filter((name) => !nightValue(name))).toEqual([]);
    expect(designTokens).toMatch(/--line:/);
  });

  it("field text reaches 4.5:1 on its fill in light, as the build ships it, and on night", () => {
    const pairs: Array<[string, string]> = [["--input-fg", "--input-bg"], ["--input-fg", "--input-bg-muted"], ["--input-fg-muted", "--input-bg-muted"], ["--input-fg-muted", "--input-bg-locked"]];
    const failures = pairs.flatMap(([ink, fill]) => [
      ["light", contrast(shippedLight(ink), shippedLight(fill))] as const,
      ["night", contrast(nightValue(ink) ?? "#000000", nightValue(fill) ?? "#000000")] as const,
    ].filter(([, ratio]) => ratio < 4.5).map(([theme, ratio]) => `${theme} ${ink} on ${fill} ${ratio.toFixed(2)}`));
    expect(failures).toEqual([]);
    expect(contrast(nightValue("--input-border") ?? "#000000", nightValue("--input-bg") ?? "#000000")).toBeGreaterThanOrEqual(3);
  });

  it("an editable field's outline reaches 3:1 on its fill in light, as the build ships it", () => {
    const edges: Array<[string, string]> = [["--input-border", "--input-bg"], ["--input-border", "--input-bg-muted"], ["--input-border-soft", "--input-bg-muted"]];
    const failures = edges.map(([edge, fill]) => [`${edge} on ${fill}`, contrast(shippedLight(edge), shippedLight(fill))] as const)
      .filter(([, ratio]) => ratio < 3).map(([pair, ratio]) => `${pair} ${ratio.toFixed(2)}`);
    expect(failures).toEqual([]);
  });

  it("no field rule outside the light-only phone app paints a fixed neutral fill, text or edge, so night always reaches it", () => {
    const listCss = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "mobile" ? [] : listCss(path);
      return /\.css$/.test(name) ? [path] : [];
    });
    const offenders = listCss(SRC)
      .filter((file) => !/conts[\\/]embed\.css$|[\\/]index\.css$|design-system[\\/]tokens\.css$/.test(file))
      .flatMap((file) => [...readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, selector]) => INPUT_LIKE.test(selector) && !(NOT_A_FIELD.test(selector) && !/\b(input|select|textarea)\b/.test(selector)))
        .flatMap(([, selector, body]) => body.split(";")
          .filter((declaration) => /^\s*(color|background(-color)?|border(-(top|right|bottom|left))?(-color)?)\s*:/.test(declaration))
          .filter((declaration) => FIELD_LITERALS.test(withoutVariables(declaration)))
          .map((declaration) => `${relative(SRC, file)} ${selector.trim()} ${declaration.trim()}`)));
    expect(offenders).toEqual([]);
  });
});
