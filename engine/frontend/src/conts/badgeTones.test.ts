import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Rgba = readonly [number, number, number, number];

const TEXT_MIN_RATIO = 4.5;
const NIGHT_CARD: Rgba = [28, 32, 48, 1];
const NIGHT_ROW_ALT: Rgba = [35, 39, 54, 1];

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

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const embedCss = readFileSync(resolve(__dirname, "embed.css"), "utf8");
const nightBadges = new Map(
  [...embedCss.matchAll(/(--badge-[a-z0-9-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
);
const usedBadges = new Set(
  sourceFiles(resolve(__dirname, "..")).flatMap((file) => [...readFileSync(file, "utf8").matchAll(/--badge-[a-z0-9-]+/g)].map((match) => match[0])),
);

describe("badge tones on the night skin", () => {
  it("every badge variable the screens use has a night value", () => {
    const missing = [...usedBadges].filter((name) => !nightBadges.has(name));
    expect(missing).toEqual([]);
  });

  it("every badge ink keeps 4.5:1 on its own tint over the dark card and the striped row", () => {
    const failures: string[] = [];
    for (const [name, value] of nightBadges) {
      if (!name.endsWith("-fg")) continue;
      const tint = nightBadges.get(name.replace(/-fg$/, "-bg"));
      for (const row of [NIGHT_CARD, NIGHT_ROW_ALT]) {
        const background = tint ? composite(parseColour(tint), row) : row;
        const ratio = contrastRatio(parseColour(value), background);
        if (ratio < TEXT_MIN_RATIO) failures.push(`${name} ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
