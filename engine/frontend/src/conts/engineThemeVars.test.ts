import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error palette.mjs ships without type declarations
import { recolourCssValue } from "../../conts/palette.mjs";

const LIGHT_HEX_BY_VARIABLE: Record<string, string> = {
  bg: "#eef0ec", surface: "#ffffff", "surface-2": "#f4f6f3", "surface-dim": "#e3e6e0",
  border: "#d6d9d2", "border-subtle": "#e3e6e0", "border-strong": "#c2c6bd",
  ink: "#11140f", "ink-secondary": "#414539",
  "primary-soft": "#e1efed", "primary-ink": "#0c3f39", "accent-soft": "#f3ece0", "accent-ink": "#5a3a14",
  "synced-bg": "#e2f0e9", "err-bg": "#f8eaea", "warning-bg": "#f6efd9", "warning-text": "#6e4d12",
  "expired-bg": "#f7e9e9", "expired-text": "#7a2222",
};

const recolour = recolourCssValue as (value: string) => string;
const toRgbFunction = (hex: string): string => {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  return `rgb(${channels.join(" ")})`;
};

describe("engine theme variables", () => {
  const indexCss = readFileSync(resolve(__dirname, "../index.css"), "utf8");

  it.each(Object.entries(LIGHT_HEX_BY_VARIABLE))(
    "light theme variable --eng-%s keeps the colour the hex palette produced",
    (name, originalHex) => {
      const triple = new RegExp(String.raw`--eng-${name}:\s*(\d+ \d+ \d+);`).exec(indexCss)?.[1];
      expect(triple).toBeDefined();
      expect(recolour(`rgb(${triple})`)).toBe(toRgbFunction(recolour(originalHex)));
    },
  );

  it("light muted ink is the house muted text colour, readable on the dim chip fill", () => {
    const houseTokens = readFileSync(resolve(__dirname, "../../../../tokens.css"), "utf8");
    const houseMuted = /--color-text-muted:\s*(#[0-9a-fA-F]{6});/.exec(houseTokens)?.[1];
    const triple = /--eng-ink-muted:\s*(\d+ \d+ \d+);/.exec(indexCss)?.[1];
    expect(houseMuted).toBeDefined();
    expect(recolour(`rgb(${triple})`)).toBe(toRgbFunction(houseMuted ?? ""));
  });
});
