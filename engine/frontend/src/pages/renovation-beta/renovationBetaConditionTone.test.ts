import { describe, expect, it } from "vitest";
import { TONES, betaConditionTone } from "./renovationBetaTheme";

/** The condition pill colours of the designs (v10 / v13 condC): red amendment, amber new or waiting, teal booked or
 *  done, grey for a pending site measure, blue for everything else. */
describe("betaConditionTone", () => {
  const family = (text: string): string => {
    const [ink] = betaConditionTone(text);
    return (Object.keys(TONES) as (keyof typeof TONES)[]).find((k) => TONES[k].ink === ink) ?? "none";
  };
  it.each([
    ["3D amendment", "red"], ["2D amendment", "red"],
    ["New · team not assigned", "amber"], ["3D sent · waiting client", "amber"],
    ["Carpentry measure booked", "accent"], ["Site briefing booked", "accent"], ["Done all design", "accent"],
    ["Pending site measure", "grey"],
    ["3D in progress", "blue"], ["2D in progress", "blue"], ["Pending 3D design", "blue"], ["Pending carpentry measure", "blue"], ["Pending PO", "blue"],
  ])("%s is %s", (words, expected) => expect(family(words)).toBe(expected));
});
