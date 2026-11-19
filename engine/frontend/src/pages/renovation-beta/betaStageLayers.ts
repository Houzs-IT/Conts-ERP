/* The second layer under the project page's stage row (owner, 19 Nov 2026; design canvas "Project stages second layer").
   Only Design and Renovation have one: Design = the works in Design in Project Maintenance, then Variants; Renovation =
   every catalog category, the ones on this project lit. The other stages show one line saying when they complete. */

import { designSteps, ds, measured, stage, stepDone, type BoardModel, type DesignProject } from "./renovationBetaBoard";

export type SubState = "done" | "current" | "later" | "off";
export interface SubStep { key: string; label: string; state: SubState; sub: string; rule: string }
export interface StageLayer { rule: string; steps: SubStep[] | null }

/** When each stage is complete, in the owner's words. */
export const STAGE_RULE: Readonly<Record<string, string>> = {
  signed: "Done when the project is linked to its sales order. Design opens when the first payment is received.",
  design: "Done when every step below is done. The steps are set in Project Maintenance > Design work.",
  ordering: "Done as soon as the sales order has a variation order.",
  renovation: "Every category is shown; the ones on this project light up. Done when all of those are complete.",
  handover: "Completed by hand.",
  closed: "Done when Close is pressed and the final payment is fully settled.",
};

const RULE: Readonly<Record<string, string>> = {
  measure: "Done once the booked measure day has passed, or a measure is recorded.",
  w3d: "Done when Record approval is pressed.",
  w2d: "Done when Record approval is pressed.",
  payment_2: "Done when the second payment is received.",
  carpentry: "Done once its booked day has passed.",
  briefing: "Done once its booked day has passed.",
  variants: "Done when every sales order line has its variants picked.",
};

function detail(m: BoardModel, p: DesignProject, code: string): string {
  switch (code) {
    case "measure": return measured(m, p) && p.measuredOn ? `Measured ${ds(p.measuredOn)}` : p.appts.msr?.d ? `Booked ${ds(p.appts.msr.d)}` : "Not booked";
    case "w3d":
    case "w2d": {
      const g = stage(m, p, code === "w3d" ? "3" : "2");
      return g.st === "ok" ? "Approved" : g.st === "wait" ? `Sent ${g.r.done ? ds(g.r.done) : ""}` : g.st === "work" ? `Due ${ds(g.due)}` : "Not started";
    }
    case "payment_2": return p.paid == null ? p.payment ?? "No SO yet" : p.paid >= 2 ? "Received" : p.payment ?? "Not received";
    case "carpentry": return p.appts.cm?.d ? ds(p.appts.cm.d) : "Not booked";
    case "briefing": return p.appts.sb?.d ? ds(p.appts.sb.d) : "Not booked";
    case "variants": return p.variants.lines === 0 ? "No lines yet" : `${p.variants.lines - p.variants.missing} of ${p.variants.lines}`;
    default: return p.works[code]?.d ? ds(p.works[code].d) : "Not booked";
  }
}

/** Design's steps for one project: done ones, the first open one current, the rest later. */
export function designLayer(m: BoardModel, p: DesignProject): SubStep[] {
  let seenOpen = false;
  return designSteps(m).map(([code, label]) => {
    const done = stepDone(m, p, code);
    const state: SubState = done ? "done" : seenOpen ? "later" : "current";
    if (!done) seenOpen = true;
    return { key: code, label, state, sub: detail(m, p, code), rule: RULE[code] ?? (m.workTypes.find((w) => w.code === code)?.bookable === false ? "Marked done by hand." : "Done once its booked day has passed.") };
  });
}

/** Renovation's categories from the project view, when the server sends them (absent: no second layer yet). */
export function renovationLayer(cats: ReadonlyArray<{ code: string; label: string; onProject: boolean; done: boolean; linesDone?: number; linesTotal?: number }> | undefined): SubStep[] | null {
  if (!cats?.length) return null;
  let seenOpen = false;
  return cats.map((c) => {
    if (!c.onProject) return { key: c.code, label: c.label, state: "off" as const, sub: "Not in SO", rule: "This project has no line in this category." };
    const state: SubState = c.done ? "done" : seenOpen ? "later" : "current";
    if (!c.done) seenOpen = true;
    const sub = c.linesTotal != null ? `${c.linesDone ?? 0} of ${c.linesTotal}` : c.done ? "Done" : "Open";
    return { key: c.code, label: c.label, state, sub, rule: "Done when all its lines are done." };
  });
}

type Cat = { code: string; label: string; onProject: boolean; done: boolean; linesDone?: number; linesTotal?: number };
/** The catalog categories the project view carries for Renovation; read loosely until the server sends them. */
export function renovationCategoriesOf(d: unknown): Cat[] | undefined {
  const v = d as { stageLayers?: { renovation?: { categories?: Cat[] } } };
  return v.stageLayers?.renovation?.categories;
}
