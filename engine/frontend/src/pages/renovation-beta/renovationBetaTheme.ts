/* The Beta screens copy the owner's mockup ("Renovation Project Workspace", 23 Oct 2026), so they use its own
   palette rather than the engine's: teal accent on a cool grey ground. Values are the mockup's, unchanged. */

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

/** [text, background] pairs. */
export type BetaTone = readonly [string, string];

/** Days left on a deadline: late, two days or less, later. */
export function betaDueTone(daysLeft: number): BetaTone {
  if (daysLeft < 0) return ["#A12622", "#FDF1F0"];
  if (daysLeft <= 2) return ["#8A4A00", "#FDF1E2"];
  return ["#1A6B66", "#E4F1EF"];
}

/** Calendar chip groups: drawing update, meeting or site visit, design work, deadline. */
export const BETA_CHIP: Readonly<Record<"upd" | "meet" | "work" | "dead", BetaTone>> = {
  upd: ["#B4540A", "#FFF1E0"],
  meet: ["#1F4E8C", "#E8F0FB"],
  work: ["#1A6B66", "#E4F1EF"],
  dead: ["#A12622", "#FDF1F0"],
};

/** Design condition letters A to E (site measure, 3D, 2D, carpentry / site / PO, done). */
export const BETA_STAGE: Readonly<Record<"A" | "B" | "C" | "D" | "E", BetaTone>> = {
  A: ["#5B4B9A", "#EFEBF8"],
  B: ["#1F4E8C", "#E6EEF9"],
  C: ["#1A6B66", "#E1F1EE"],
  D: ["#8A3B6E", "#F6E8F0"],
  E: ["#1E6B3A", "#E3F2E7"],
};

/** Building tag colours, picked from the building name so a building keeps its colour. */
const TAG: readonly BetaTone[] = [
  ["#8E2A22", "#FADCDA"], ["#7A4300", "#FBE3C2"], ["#6B5600", "#F6EDC6"], ["#1E5A33", "#DDF0E3"],
  ["#1F4E8C", "#D9EAF7"], ["#4F3A8A", "#E9E2F5"], ["#7A2E5C", "#F4E1EC"], ["#3F4947", "#E8EDEC"],
];

export function betaTagTone(name: string): BetaTone {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TAG[h % TAG.length];
}

/** Condition pill: [text, background, dot], by the wording of the condition, as the mockup's condPill. */
export function betaConditionTone(text: string): readonly [string, string, string] {
  if (/amendment/i.test(text)) return ["#A12622", "#FADCDA", "#D9534F"];
  if (/New/.test(text)) return ["#8A4A00", "#FBE3C2", "#E08A1E"];
  if (/waiting|booked|Done/i.test(text)) return ["#1E6B3A", "#DDF0E3", "#3E9B5F"];
  if (/^Pending site/.test(text)) return ["#3F4947", "#E8EDEC", "#8C9593"];
  return ["#1F4E8C", "#D9EAF7", "#3A7BD5"];
}
