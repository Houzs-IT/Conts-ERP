/* The second layer of the project stages (owner, 19 Nov 2026): the Design steps and the Renovation categories.
   Pure: the facts come from stageLoad.ts, today (Malaysia day) from the caller.

   Design steps are the works marked In Design in Project Maintenance > Design work (workTypes.ts), in their order, then
   Variants. Same rules as the Beta board's Design progress (frontend renovationBetaBoard.ts stepDone):
     measure        a site measure recorded, or the booked site measure's day has passed (or it is ticked done)
     carpentry      the booked carpentry measure's day has passed (or ticked done)
     briefing       the booked site briefing's day has passed (or ticked done)
     w3d / w2d      the newest 3D / 2D file is approved and every amendment note on it is answered
     payment_2      the second instalment is fully received
     variants       the project's sales orders have lines and every one carries its category-required variants
     any other work its newest calendar booking's day has passed (or it is ticked done)

   Renovation categories: every category of the catalog (scm.product_category_groups), and for each the live lines of
   the project's sales orders in it. A line is done when its delivered quantity covers the line (delivery orders that are
   not draft or cancelled, less delivery returns): every renovation line ends in a delivery order, a bought item when it
   arrives on site, an on-site works line when its site receipt raises the DO, a service when Complete is pressed. */

import type { WorkType } from "./workTypes";

export type DesignKind = "3d" | "2d";

export interface StageAppointment { kind: string; onDate: string; doneAt: string | null }
export interface StageWork { type: string; onDate: string; done: boolean }
export interface StageFile { id: number; kind: DesignKind; version: number; submittedOn: string }
export interface StageNote { id: number; kind: DesignKind; notedOn: string; closedOn: string | null }
export interface StageReview { fileId: number; approvedOn: string | null }
export interface StageLine { category: string | null; qty: number; delivered: number }

/** Everything the Design steps and Renovation categories read, per project (stageLoad.ts). */
export interface StageInputs {
  /** A live (not cancelled) sales order of any kind is linked to the project. */
  hasSo: boolean;
  /** The project's money as the Beta workspace reads it (projectPayments.ts); null when there is no sales order. */
  payment: { contractSen: number; receivedSen: number; paidInstalments: number } | null;
  workTypes: readonly WorkType[];
  /** The first recorded site measure (project_design_records kind site_measure). */
  measuredOn: string | null;
  appointments: readonly StageAppointment[];
  /** The newest calendar booking of each work, by its code. */
  works: readonly StageWork[];
  files: readonly StageFile[];
  notes: readonly StageNote[];
  reviews: readonly StageReview[];
  variants: { lines: number; missing: number };
  /** Variation orders on the project's sales orders that are not cancelled or rejected. */
  voCount: number;
  /** The catalog's categories in their order. */
  categories: ReadonlyArray<{ code: string; label: string }>;
  /** Live lines of the project's sales orders (credit lines left out). */
  lines: readonly StageLine[];
}

export interface DesignStepStatus {
  /** The work's code in Project Maintenance, or "variants". */
  code: string;
  label: string;
  done: boolean;
  /** The day it was done or is booked for (YYYY-MM-DD); null when there is none. */
  date: string | null;
  /** A short state text: "Done", "Booked", "Not booked", "Approved", "Waiting approval", ... */
  state: string;
}

export interface RenovationCategoryStatus {
  code: string;
  label: string;
  /** The project's sales orders have lines in this category. */
  onProject: boolean;
  /** Every line of the category is delivered; always false for a category not on the project. */
  done: boolean;
  linesDone: number;
  linesTotal: number;
}

const APPOINTMENT_OF: Readonly<Record<string, string>> = { measure: "site_measure", carpentry: "carpentry_measure", briefing: "site_briefing" };

/** The 3D or 2D track: approved when the newest version is approved and every amendment note is answered. A note is
    answered when it is closed, or when a later version was submitted on or after its day; each later version answers
    one note, in order (the same reading as the Beta board). */
export function designTrack(i: Pick<StageInputs, "files" | "notes" | "reviews">, kind: DesignKind): {
  hasFile: boolean; approved: boolean; approvedOn: string | null; openNotes: number;
} {
  const files = i.files.filter((f) => f.kind === kind).sort((a, b) => a.version - b.version);
  const newest = files[files.length - 1];
  const notes = i.notes.filter((n) => n.kind === kind).sort((a, b) => a.notedOn.localeCompare(b.notedOn) || a.id - b.id);
  const later = files.slice(1);
  const used = new Set<number>();
  let openNotes = 0;
  for (const n of notes) {
    if (n.closedOn != null) continue;
    const answer = later.find((f) => !used.has(f.id) && f.submittedOn >= n.notedOn);
    if (answer) used.add(answer.id);
    else openNotes += 1;
  }
  const approvedOn = newest ? i.reviews.find((r) => r.fileId === newest.id)?.approvedOn ?? null : null;
  return { hasFile: !!newest, approved: !!newest && approvedOn != null && openNotes === 0, approvedOn, openNotes };
}

function booked(on: string | null | undefined, done: boolean, today: string, doneText = "Done"): Omit<DesignStepStatus, "code" | "label"> {
  if (!on) return { done: false, date: null, state: "Not booked" };
  if (done || on < today) return { done: true, date: on, state: doneText };
  return { done: false, date: on, state: "Booked" };
}

/** The Design steps of one project, in order: the works In Design (active), then Variants. */
export function designSteps(i: StageInputs, today: string): DesignStepStatus[] {
  const works = i.workTypes.filter((w) => w.inDesign && w.active).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const out: DesignStepStatus[] = works.map((w): DesignStepStatus => {
    const head = { code: w.code, label: w.label };
    switch (w.code) {
      case "measure": {
        const a = i.appointments.find((x) => x.kind === APPOINTMENT_OF.measure);
        if (i.measuredOn) return { ...head, done: true, date: i.measuredOn, state: "Measured" };
        return { ...head, ...booked(a?.onDate, a?.doneAt != null, today) };
      }
      case "carpentry":
      case "briefing": {
        const a = i.appointments.find((x) => x.kind === APPOINTMENT_OF[w.code]);
        return { ...head, ...booked(a?.onDate, a?.doneAt != null, today) };
      }
      case "w3d":
      case "w2d": {
        const t = designTrack(i, w.code === "w3d" ? "3d" : "2d");
        if (t.approved) return { ...head, done: true, date: t.approvedOn, state: "Approved" };
        if (!t.hasFile) return { ...head, done: false, date: null, state: "Not started" };
        return { ...head, done: false, date: null, state: t.openNotes > 0 ? "Amendment open" : "Waiting approval" };
      }
      case "payment_2": {
        if (!i.payment) return { ...head, done: false, date: null, state: "No sales order" };
        const done = i.payment.paidInstalments >= 2;
        return { ...head, done, date: null, state: done ? "Received" : "Waiting payment" };
      }
      default: {
        const e = i.works.find((x) => x.type === w.code);
        return { ...head, ...booked(e?.onDate, !!e?.done, today) };
      }
    }
  });
  const v = i.variants;
  out.push({
    code: "variants", label: "Variants", date: null,
    done: v.lines > 0 && v.missing === 0,
    state: v.lines === 0 ? "No sales order lines" : v.missing === 0 ? "All variants picked" : `${v.missing} of ${v.lines} lines missing variants`,
  });
  return out;
}

/** A line not in any catalog category is counted under this code, so it still holds Renovation open. */
export const OTHER_CATEGORY = "OTHER";

/** Every catalog category with the project's lines in it; a category the lines name that the catalog does not have is
    added at the end, so no line is left uncounted. */
export function renovationCategories(i: Pick<StageInputs, "categories" | "lines">): RenovationCategoryStatus[] {
  const byCode = new Map<string, { done: number; total: number }>();
  for (const l of i.lines) {
    const code = l.category?.trim() || OTHER_CATEGORY;
    const s = byCode.get(code) ?? { done: 0, total: 0 };
    s.total += 1;
    if (Number(l.delivered) >= Number(l.qty)) s.done += 1;
    byCode.set(code, s);
  }
  const known = new Set(i.categories.map((c) => c.code));
  const extra = [...byCode.keys()].filter((k) => !known.has(k)).sort()
    .map((code) => ({ code, label: code === OTHER_CATEGORY ? "Other" : code }));
  return [...i.categories, ...extra].map((c) => {
    const s = byCode.get(c.code) ?? { done: 0, total: 0 };
    return { code: c.code, label: c.label, onProject: s.total > 0, done: s.total > 0 && s.done === s.total, linesDone: s.done, linesTotal: s.total };
  });
}
