/* The Beta screens' colours. They began as the owner's mockup palette ("Renovation Project Workspace", 23 Oct 2026);
   on 24 Oct 2026 the owner asked whether the system's colours had changed, so Beta now keeps to four families and
   nothing else: one accent green (the teal), one amber (waiting / warning), one red (late / wrong) and neutral greys.
   Blue, purple, magenta, orange and the second green the mockup carried are gone: status pills, chips, building tags
   and stage letters all come from these tokens, so a pill reads the same on every screen. */

export const BETA = {
  bg: "#F6F8F8",
  surface: "#FFFFFF",
  ink: "#17201F",
  muted: "#55605E",
  line: "#E3E8E7",
  lineSoft: "#EEF1F0",
  border: "#C3CCCA",
  accent: "#1A6B66",
  accentInk: "#0F4A46",
  focus: "#7FB3AD",
} as const;

/** The four families, each as ink (text), soft (pill background) and dot. */
export const TONES = {
  accent: { ink: BETA.accent, soft: "#E4F1EF", strong: "#CDE6E2", dot: BETA.accent, line: "#A9D2CC" },
  amber: { ink: "#8A4A00", soft: "#FDF1E2", strong: "#FBE3C2", dot: "#D98A1F", line: "#F2CC94" },
  red: { ink: "#A12622", soft: "#FDF1F0", strong: "#FADCDA", dot: "#C62828", line: "#E8A5A2" },
  grey: { ink: "#3F4947", soft: "#EEF2F1", strong: "#E3E8E7", dot: "#8C9593", line: BETA.border },
} as const;

/** [text, background] pairs. */
export type BetaTone = readonly [string, string];

const pair = (f: keyof typeof TONES, strong = false): BetaTone => [TONES[f].ink, strong ? TONES[f].strong : TONES[f].soft];

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

/** Building tags are labels, not states: one neutral look for every building. */
export function betaTagTone(_name: string): BetaTone {
  return [TONES.grey.ink, TONES.grey.strong];
}

/** Condition pill: [text, background, dot], by the wording of the condition, as the mockup's condPill. */
export function betaConditionTone(text: string): readonly [string, string, string] {
  if (/amendment/i.test(text)) return [TONES.red.ink, TONES.red.soft, TONES.red.dot];
  if (/New/.test(text)) return [TONES.amber.ink, TONES.amber.soft, TONES.amber.dot];
  if (/waiting|booked|Done/i.test(text)) return [TONES.accent.ink, TONES.accent.soft, TONES.accent.dot];
  return [TONES.grey.ink, TONES.grey.soft, TONES.grey.dot];
}
