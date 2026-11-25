import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BETA_SKIN_CSS } from "./renovationBetaTheme";

type Rgba = readonly [number, number, number, number];
type Skin = "vision" | "night";

const TEXT_MIN_RATIO = 4.5;
const UI_MIN_RATIO = 3;

function parseColour(colour: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (hex) {
    const digits = hex[1];
    const channelAt = (at: number): number => parseInt(digits.slice(at, at + 2), 16);
    return [channelAt(0), channelAt(2), channelAt(4), 1];
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(colour.trim());
  if (!rgba) throw new Error(`not a flat colour: ${colour}`);
  const [red = 0, green = 0, blue = 0, alpha = 1] = rgba[1].split(",").map(Number);
  return [red, green, blue, alpha];
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground[3];
  const mix = (channel: 0 | 1 | 2): number => foreground[channel] * alpha + background[channel] * (1 - alpha);
  return [mix(0), mix(1), mix(2), 1];
}

function luminance(colour: Rgba): number {
  const linear = (channel: number): number => {
    const unit = channel / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(colour[0]) + 0.7152 * linear(colour[1]) + 0.0722 * linear(colour[2]);
}

function contrastRatio(first: Rgba, second: Rgba): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

function tokensOf(skin: Skin): Map<string, string> {
  const block = skin === "vision" ? /:root\{([^}]*)\}/.exec(BETA_SKIN_CSS) : /html\[data-beta-skin="night"\]\{([^}]*)\}/.exec(BETA_SKIN_CSS);
  const declarations = block?.[1] ?? "";
  return new Map([...declarations.matchAll(/--beta-([\w-]+):([^;]+)/g)].map((match) => [match[1], match[2].trim()]));
}

/* The glass card over the darkest point of the page glow: the lowest-contrast place a card's text can land. */
const CARD_UNDER_GLASS: Record<Skin, Rgba> = {
  vision: composite(parseColour("rgba(244,246,251,.62)"), parseColour("#DDE2EC")),
  night: composite(parseColour("rgba(255,255,255,.085)"), parseColour("#151823")),
};

const TINTS_ON_CARD = ["chip", "pick", "row", "panel", "head", "field", "tealSoft"] as const;
const STATE_WASHES: Record<Skin, readonly string[]> = {
  vision: ["rgba(17,18,22,.05)", "rgba(0,0,0,.10)"],
  night: ["rgba(255,255,255,.06)", "rgba(255,255,255,.10)"],
};

function worstRatioOnCard(skin: Skin, textToken: string): number {
  const tokens = tokensOf(skin);
  const text = parseColour(tokens.get(textToken) ?? "");
  const card = CARD_UNDER_GLASS[skin];
  const tintColours = TINTS_ON_CARD.map((tint) => tokens.get(tint) ?? "").concat(STATE_WASHES[skin], tokens.get("raised") ?? "");
  const backgrounds = [card, ...tintColours.map((tint) => composite(parseColour(tint), card))];
  return Math.min(...backgrounds.map((background) => contrastRatio(composite(text, background), background)));
}

describe("Dream Crafter palette contrast", () => {
  for (const skin of ["vision", "night"] as const) {
    it.each(["ink", "text2", "muted", "faint", "accent", "accentInk"])(`%s text keeps 4.5:1 on every tint of a ${skin} card`, (textToken) => {
      expect(worstRatioOnCard(skin, textToken)).toBeGreaterThanOrEqual(TEXT_MIN_RATIO);
    });

    it(`the control edge, focus ring and step dot edge keep 3:1 on a ${skin} card`, () => {
      for (const token of ["border", "btnGlassEdge", "focus", "stepNextEdge", "tone-grey-dot"]) {
        const tokens = tokensOf(skin);
        const card = CARD_UNDER_GLASS[skin];
        expect(contrastRatio(composite(parseColour(tokens.get(token) ?? ""), card), card), token).toBeGreaterThanOrEqual(UI_MIN_RATIO);
      }
    });
  }

  it("each status ink keeps 4.5:1 on its own soft and strong pill, both skins", () => {
    for (const skin of ["vision", "night"] as const) {
      const tokens = tokensOf(skin);
      const card = CARD_UNDER_GLASS[skin];
      for (const family of ["accent", "amber", "red", "grey", "blue"]) {
        for (const pill of ["soft", "strong"]) {
          const background = composite(parseColour(tokens.get(`tone-${family}-${pill}`) ?? ""), card);
          const ink = composite(parseColour(tokens.get(`tone-${family}-ink`) ?? ""), background);
          expect(contrastRatio(ink, background), `${skin} ${family} ${pill}`).toBeGreaterThanOrEqual(TEXT_MIN_RATIO);
        }
      }
    }
  });

  it("white text keeps 4.5:1 on every solid fill it sits on", () => {
    for (const skin of ["vision", "night"] as const) {
      const tokens = tokensOf(skin);
      for (const fill of ["accentFill", "amberFill"]) {
        expect(contrastRatio(parseColour(tokens.get("onFill") ?? ""), parseColour(tokens.get(fill) ?? "")), `${skin} ${fill}`).toBeGreaterThanOrEqual(TEXT_MIN_RATIO);
      }
    }
  });
});

describe("Dream Crafter values the main app copies", () => {
  const mainAppTheme = readFileSync(resolve(__dirname, "../../../../../src/theme.ts"), "utf8");
  const embedCss = readFileSync(resolve(__dirname, "../../conts/embed.css"), "utf8");

  it("the main-app sidebar uses the same ink, secondary and muted text as the Beta screens", () => {
    for (const skin of ["vision", "night"] as const) {
      const tokens = tokensOf(skin);
      const expectedLine = `ink: '${tokens.get("ink") ?? ""}', text: '${tokens.get("text2") ?? ""}', muted: '${tokens.get("muted") ?? ""}', faint: '${tokens.get("faint") ?? ""}'`;
      expect(mainAppTheme, skin).toContain(expectedLine);
    }
  });

  it("embed.css night muted text is the Beta night muted, and the failing old grey is gone", () => {
    expect(embedCss).toContain(tokensOf("night").get("muted") ?? "missing");
    expect(embedCss.toUpperCase()).not.toContain("#9AA2B4");
  });
});
