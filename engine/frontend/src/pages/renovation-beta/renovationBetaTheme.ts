/* The Beta screens' colours. They began as the owner's mockup palette ("Renovation Project Workspace", 23 Oct 2026);
   on 24 Oct 2026 the owner asked whether the system's colours had changed, so Beta now keeps to four families and
   nothing else: one accent green (the teal), one amber (waiting / warning), one red (late / wrong) and neutral greys.
   Blue came back on 26 Oct 2026 for main action buttons only, as the Dream Crafter designs draw them (v10 "Vision",
   v13 "Night Glass"): status pills, chips, building tags and stage letters still come from the four families.

   Every colour here has two values, the light "vision" look and the dark "night" look. BETA and TONES hand out
   `var(--beta-...)` strings, so a screen repaints when the skin changes and nothing re-renders. The values live in
   BETA_SKIN_CSS (rendered by BetaSkin): light on :root, so a page that never hears about a skin (the engine opened on
   its own, the public client link) is light, and dark under html[data-beta-skin="night"], which conts/embed.ts sets
   when Property OS is in its dark theme. Anything that cannot read a CSS variable (a PDF, a canvas) takes BETA_HEX. */

import type { CSSProperties } from "react";

/** [vision, night]. */
type Pair = readonly [string, string];

const GLASS_SHADOW_VISION = "inset 0 1px 0 rgba(255,255,255,1),inset 0 0 0 1px rgba(255,255,255,.35),inset 0 -10px 24px rgba(120,150,255,.08),0 0 0 1px rgba(120,150,255,.14),0 0 40px -12px rgba(110,160,255,.45),0 30px 60px -24px rgba(60,80,160,.35)";
const GLASS_SHADOW_NIGHT = "inset 0 1px 0 rgba(255,255,255,.18),inset 0 0 0 1px rgba(255,255,255,.04),inset 0 -10px 24px rgba(120,150,255,.08),0 0 0 1px rgba(120,150,255,.14),0 0 40px -10px rgba(80,130,255,.35),0 30px 60px -24px rgba(0,0,0,.6)";

/* The page behind the cards, as the Dream Crafter sidebar draws it (src/theme.ts dcGlass in the ERP; copied, the engine
   cannot import from there). */
const PAGE_VISION = "linear-gradient(118deg,rgba(255,255,255,0) 58%,rgba(255,248,226,.85) 66%,rgba(255,255,255,0) 76%),"
  + "radial-gradient(48% 52% at 14% 16%,#F6C9D6 0%,rgba(246,201,214,0) 72%),"
  + "radial-gradient(52% 58% at 90% 34%,#BFE6EA 0%,rgba(191,230,234,0) 72%),"
  + "radial-gradient(46% 46% at 40% 100%,#CBD3FA 0%,rgba(236,227,207,0) 72%),"
  + "linear-gradient(160deg,#E6ECEA 0%,#ECEEF3 50%,#DDE2EC 100%)";
const PAGE_NIGHT = "radial-gradient(45% 40% at 18% 12%,rgba(70,110,255,.35) 0%,rgba(70,110,255,0) 70%),"
  + "radial-gradient(40% 40% at 88% 70%,rgba(150,90,255,.28) 0%,rgba(150,90,255,0) 70%),"
  + "radial-gradient(35% 35% at 50% 100%,rgba(60,180,255,.18) 0%,rgba(60,180,255,0) 70%),"
  + "linear-gradient(160deg,#151823 0%,#0D0F16 100%)";

const BASE_TOKENS = {
  /* Page, text and lines. */
  bg: ["#ECEEF3", "#151823"],
  page: [PAGE_VISION, PAGE_NIGHT],
  surface: ["#FFFFFF", "#1C2030"],
  field: ["rgba(255,255,255,.8)", "rgba(255,255,255,.06)"],
  ink: ["#111216", "#EEF1F8"],
  muted: ["#6B6B6B", "#9AA2B4"],
  text2: ["#4A4A4A", "#B9C0D0"],
  faint: ["#8E8E8E", "#7E869A"],
  line: ["rgba(10,10,10,.1)", "rgba(150,175,255,.18)"],
  lineSoft: ["rgba(10,10,10,.07)", "rgba(150,175,255,.11)"],
  border: ["rgba(10,10,10,.22)", "rgba(150,175,255,.3)"],
  dash: ["#B4B4B4", "#5E6678"],
  scrim: ["rgba(17,18,22,.45)", "rgba(5,7,12,.72)"],
  accent: ["#0F5F58", "#7BE8D8"],
  accentInk: ["#0B4A44", "#A6F2E6"],
  /* A solid fill that carries white text: a done dot, a check, a "today" circle; and a small dark tag or avatar. */
  accentFill: ["#0F5F58", "#1F8F82"],
  avatar: ["#111216", "rgba(120,160,255,.28)"],
  focus: ["#5C96FF", "#9FC0FF"],
  /* Flat tints inside a card: a panel, a table head, a chip, the row that was opened last, a teal highlight. */
  panel: ["rgba(255,255,255,.55)", "rgba(255,255,255,.05)"],
  head: ["rgba(255,255,255,.4)", "rgba(255,255,255,.04)"],
  chip: ["rgba(10,10,10,.05)", "rgba(255,255,255,.08)"],
  row: ["rgba(255,255,255,.82)", "rgba(255,255,255,.06)"],
  pick: ["rgba(230,237,255,.75)", "rgba(80,130,255,.16)"],
  tealSoft: ["rgba(220,240,237,.6)", "rgba(40,200,180,.1)"],
  /* Glass: cards get the background, edge, glow and blur; the solid pair is what reduced transparency swaps in. */
  glass: ["linear-gradient(180deg,rgba(255,255,255,.86),rgba(244,246,251,.62))", "linear-gradient(180deg,rgba(255,255,255,.085),rgba(255,255,255,.025))"],
  glassSolid: ["#F7F8FC", "#1C2030"],
  glassEdge: ["rgba(255,255,255,.8)", "rgba(150,175,255,.24)"],
  glassShadow: [GLASS_SHADOW_VISION, GLASS_SHADOW_NIGHT],
  blur: ["blur(30px) saturate(1.6)", "blur(30px) saturate(1.6)"],
  blurSm: ["blur(12px)", "blur(12px)"],
  /* Buttons: the blue pill for the main action, the glass pill for the rest. */
  blue: ["#2F6BFF", "#7FA6FF"],
  blueSoft: ["#E6EDFF", "rgba(80,130,255,.18)"],
  btnMain: ["linear-gradient(180deg,rgba(92,150,255,.96) 0%,rgba(31,91,234,.92) 100%)", "linear-gradient(180deg,rgba(120,170,255,.55) 0%,rgba(50,100,230,.45) 100%)"],
  btnMainShadow: [
    "inset 0 2px 3px rgba(255,255,255,.55),inset 0 -5px 10px rgba(10,40,140,.3),0 10px 22px -8px rgba(47,107,255,.6),0 0 24px rgba(90,150,255,.55),0 0 0 1px rgba(160,200,255,.6)",
    "inset 0 1px 2px rgba(255,255,255,.55),inset 0 -6px 12px rgba(20,50,160,.35),0 0 0 1px rgba(150,195,255,.7),0 0 28px rgba(70,140,255,.7),0 12px 24px -10px rgba(0,0,0,.6)",
  ],
  btnGlass: ["linear-gradient(180deg,rgba(255,255,255,.82) 0%,rgba(244,246,250,.42) 100%)", "linear-gradient(180deg,rgba(255,255,255,.14) 0%,rgba(255,255,255,.04) 100%)"],
  btnGlassShadow: [
    "inset 0 2px 2px rgba(255,255,255,.95),inset 0 -4px 8px rgba(110,125,160,.18),0 8px 16px -6px rgba(90,105,150,.32),0 1px 2px rgba(40,50,90,.08)",
    "inset 0 1px 1px rgba(255,255,255,.22),0 0 0 1px rgba(170,140,255,.35),0 0 18px -4px rgba(150,110,255,.45),0 10px 20px -10px rgba(0,0,0,.6)",
  ],
  btnEdge: ["rgba(255,255,255,.7)", "rgba(150,175,255,.24)"],
  /* The project stepper: the track, a step not reached yet, the step in progress and a step done. */
  stepTrack: ["rgba(255,255,255,.55)", "rgba(255,255,255,.08)"],
  stepNext: ["linear-gradient(180deg,rgba(255,255,255,.9),rgba(240,244,250,.55))", "linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,.04))"],
  stepNextShadow: [
    "inset 0 2px 2px rgba(255,255,255,.95),inset 0 -3px 6px rgba(110,125,160,.15),0 4px 10px -4px rgba(90,105,150,.3)",
    "inset 0 1px 2px rgba(255,255,255,.2),inset 0 -3px 6px rgba(0,0,0,.2),0 4px 10px -4px rgba(0,0,0,.5)",
  ],
  stepNextEdge: ["rgba(255,255,255,.85)", "rgba(150,175,255,.3)"],
  stepNow: ["#D63C5E", "#FF7A93"],
  /* The four payment tiles: paid, needs attention, and later. */
  payPaid: ["linear-gradient(135deg,#DDF4F2 0%,#C7E4F4 100%)", "linear-gradient(135deg,rgba(40,200,180,.16) 0%,rgba(60,150,255,.1) 100%)"],
  payAlert: ["linear-gradient(135deg,#FFEAD8 0%,#FAD3DE 100%)", "linear-gradient(135deg,rgba(245,190,80,.16) 0%,rgba(255,120,170,.1) 100%)"],
  payLater: ["linear-gradient(135deg,#FFFFFF 0%,#EEF1F8 100%)", "linear-gradient(135deg,rgba(255,255,255,.07) 0%,rgba(255,255,255,.02) 100%)"],
  payEdge: ["rgba(255,255,255,.9)", "rgba(255,255,255,.55)"],
  payLaterEdge: ["rgba(255,255,255,.7)", "rgba(150,175,255,.18)"],
  /* The amber "to book / to do" panel of the calendar. */
  tbPanel: ["#FDF6E8", "rgba(245,190,80,.1)"],
  tbEdge: ["#EBD3A0", "rgba(245,190,80,.35)"],
} as const satisfies Record<string, Pair>;

/** The families, each as ink (text), soft (pill background), strong (a deeper background), dot and line. Blue is the
 *  designs' "in progress / pending" condition pill (v10 and v13); it is not used for anything else. */
const TONE_TOKENS = {
  accent: { ink: ["#0F5F58", "#7BE8D8"], soft: ["#DCF0ED", "rgba(40,200,180,.16)"], strong: ["#C8E8E3", "rgba(40,200,180,.26)"], dot: ["#1A7A72", "#2CC9B4"], line: ["#A9D2CC", "rgba(40,200,180,.4)"] },
  amber: { ink: ["#7A4F00", "#F7CD73"], soft: ["#F8EED9", "rgba(245,190,80,.16)"], strong: ["#F3E2BC", "rgba(245,190,80,.26)"], dot: ["#B07A1A", "#F2B84B"], line: ["#EBD3A0", "rgba(245,190,80,.4)"] },
  red: { ink: ["#962D25", "#FF9B90"], soft: ["#F6E3E0", "rgba(255,110,100,.16)"], strong: ["#F1D0CB", "rgba(255,110,100,.26)"], dot: ["#A3322A", "#FF6E64"], line: ["#E3AEA9", "rgba(255,110,100,.4)"] },
  grey: { ink: ["#4A4A4A", "#B9C0D0"], soft: ["#F0F0F0", "rgba(255,255,255,.07)"], strong: ["#E3E3E3", "rgba(255,255,255,.12)"], dot: ["#8E8E8E", "#7E869A"], line: ["#C9CED8", "rgba(150,175,255,.28)"] },
  blue: { ink: ["#303030", "#DDE2EE"], soft: ["#E6EDFF", "rgba(80,130,255,.18)"], strong: ["#D3E0FF", "rgba(80,130,255,.28)"], dot: ["#111216", "#EEF1F8"], line: ["#B9CCFF", "rgba(80,130,255,.4)"] },
} as const satisfies Record<string, Record<string, Pair>>;

type BetaToken = keyof typeof BASE_TOKENS;
type ToneFamily = keyof typeof TONE_TOKENS;
type ToneKey = keyof (typeof TONE_TOKENS)["accent"];

const cssVar = (name: string): string => `var(--beta-${name})`;

/** Every colour as `var(--beta-name)`: what a style prop takes. */
export const BETA: { readonly [K in BetaToken]: string } = (() => {
  const out: Record<string, string> = {};
  for (const name of Object.keys(BASE_TOKENS)) out[name] = cssVar(name);
  // Object.keys loses the key names; the table above is the only source of them.
  return out as { readonly [K in BetaToken]: string };
})();

export const TONES: { readonly [F in ToneFamily]: { readonly [K in ToneKey]: string } } = (() => {
  const out: Record<string, Record<string, string>> = {};
  for (const [family, keys] of Object.entries(TONE_TOKENS)) {
    out[family] = Object.fromEntries(Object.keys(keys).map((k) => [k, cssVar(`tone-${family}-${k}`)]));
  }
  return out as { readonly [F in ToneFamily]: { readonly [K in ToneKey]: string } };
})();

/** The light values as written, for what cannot read a CSS variable (a PDF, a canvas). Take the plain colours from it;
    the gradients and shadows are only for CSS. */
export const BETA_HEX: { readonly [K in BetaToken]: string } = (() => {
  const out: Record<string, string> = {};
  for (const [name, [vision]] of Object.entries(BASE_TOKENS)) out[name] = vision;
  return out as { readonly [K in BetaToken]: string };
})();

/** Both skins as one stylesheet: light on :root, dark under the attribute, and the solid fallback for people who ask for less
    transparency (the glass cards lose their blur and take a solid colour). Dark form controls (color-scheme) and the page
    backdrop apply only while a Beta screen is open: the attribute stays on <html> for the engine's other screens too. */
export const BETA_SKIN_CSS: string = (() => {
  const rows = (i: 0 | 1): string => [
    ...Object.entries(BASE_TOKENS).map(([name, pair]) => `--beta-${name}:${pair[i]}`),
    ...Object.entries(TONE_TOKENS).flatMap(([family, keys]) => Object.entries(keys).map(([k, pair]) => `--beta-tone-${family}-${k}:${pair[i]}`)),
  ].join(";");
  return `:root{${rows(0)}}
html[data-beta-skin="night"]{${rows(1)}}
@media (prefers-reduced-transparency:reduce){:root,html[data-beta-skin="night"]{--beta-glass:var(--beta-glassSolid);--beta-blur:none;--beta-blurSm:none}}
html.beta-page body,html.beta-page main.paper-grain{background:var(--beta-page)}
html.beta-page[data-beta-skin="night"]{color-scheme:dark}`;
})();

/* ---------- Shared looks (inline styles that more than one file uses) ---------- */

/** A glass card: background, edge, glow and blur. The blur sits on cards only, never on the page. */
export const GLASS: CSSProperties = {
  background: BETA.glass, border: `1px solid ${BETA.glassEdge}`, boxShadow: BETA.glassShadow, backdropFilter: BETA.blur, WebkitBackdropFilter: BETA.blur,
};

/** The glossy blue pill of a main action. */
export const PILL_MAIN: CSSProperties = {
  border: `1px solid ${BETA.btnEdge}`, borderRadius: 999, background: BETA.btnMain, boxShadow: BETA.btnMainShadow, color: "#FFFFFF",
  backdropFilter: BETA.blurSm, WebkitBackdropFilter: BETA.blurSm,
};

/** The glass pill of every other button. */
export const PILL_GLASS: CSSProperties = {
  border: `1px solid ${BETA.btnEdge}`, borderRadius: 999, background: BETA.btnGlass, boxShadow: BETA.btnGlassShadow, color: BETA.ink,
  backdropFilter: BETA.blurSm, WebkitBackdropFilter: BETA.blurSm,
};

/** [text, background] pairs. */
export type BetaTone = readonly [string, string];

const pair = (f: ToneFamily, strong = false): BetaTone => [TONES[f].ink, strong ? TONES[f].strong : TONES[f].soft];

/** Days left on a deadline: late, two days or less, later. */
export function betaDueTone(daysLeft: number): BetaTone {
  if (daysLeft < 0) return pair("red");
  if (daysLeft <= 2) return pair("amber");
  return pair("accent");
}

/** Calendar chip groups: drawing update, meeting or site visit, design work, deadline. */
export const BETA_CHIP: Readonly<Record<"upd" | "meet" | "work" | "dead", BetaTone>> = {
  upd: pair("amber"),
  meet: pair("grey"),
  work: pair("accent"),
  dead: pair("red"),
};

/** Design condition letters A to E (site measure, 3D, 2D, carpentry / site / PO, done): grey until done. */
export const BETA_STAGE: Readonly<Record<"A" | "B" | "C" | "D" | "E", BetaTone>> = {
  A: pair("grey"),
  B: pair("grey"),
  C: pair("grey"),
  D: pair("grey"),
  E: pair("accent"),
};

const TAG_FAMILIES = ["red", "amber", "accent", "grey"] as const satisfies readonly ToneFamily[];

/** Building tags are labels, not states: the design tints each building, so the tint comes from the name (the design's
    own string hash) and one building always gets the same one. */
export function betaTagTone(name: string): BetaTone {
  let x = 0;
  for (let i = 0; i < name.length; i++) x = (x * 31 + name.charCodeAt(i)) >>> 0;
  return pair(TAG_FAMILIES[x % TAG_FAMILIES.length]);
}

/** Condition pill: [text, background, dot], by the wording of the condition, as the mockup's condPill. */
export function betaConditionTone(text: string): readonly [string, string, string] {
  if (/amendment/i.test(text)) return [TONES.red.ink, TONES.red.soft, TONES.red.dot];
  if (/New|waiting/i.test(text)) return [TONES.amber.ink, TONES.amber.soft, TONES.amber.dot];
  if (/booked|Done/i.test(text)) return [TONES.accent.ink, TONES.accent.soft, TONES.accent.dot];
  if (/^Pending site/.test(text)) return [TONES.grey.ink, TONES.grey.soft, TONES.grey.dot];
  return [TONES.blue.ink, TONES.blue.soft, TONES.blue.dot];
}
