/* Handover snag list (TODO item 17; migration 0296): checklist templates, a handover check copied from one, and the
   moves on its items. The pure rules only; the routes are routes/renovationBetaHandover.ts.

   A Fail is never marked here: it is reported as a defect with its photo (POST /api/beta/projects/:id/defects with
   checkItemId), which marks the item and keeps the defect's id in one statement. A check may stay open with items
   not yet marked; Finish asks for every item marked. */

import type { BetaRefusal } from "./beta";

type Json = Record<string, unknown>;

export const TEMPLATE_NAME_MAX = 120;
export const TEMPLATE_ITEMS_MAX = 200;
export const ITEM_TEXT_MAX = 300;
export const ITEM_AREA_MAX = 120;
export const ITEM_CRITERIA_MAX = 500;
export const CHECK_NOTE_MAX = 500;

/** What a write answers until migration 0296 is applied. */
export const HANDOVER_NOT_READY = { error: "not_ready", message: "Handover checklists are not switched on yet (migration 0296)." } as const;

export type CheckResult = "pass" | "fail" | "na";

export interface TemplateItemInput { area: string | null; item: string; criteria: string | null }
export interface TemplateInput { name: string; active: boolean; items: TemplateItemInput[] }

const no = (error: string, message: string): { ok: false; error: string; message: string } => ({ ok: false, error, message });

/** Trimmed, inner spaces folded; null when empty. Never cut: a long value is refused by the caller. */
function words(x: unknown): string | null {
  if (x == null) return null;
  const s = String(x).replace(/\s+/g, " ").trim();
  return s || null;
}

/** A template as the settings screen sends it: a name and its items in order (an empty row is dropped). */
export function cleanTemplate(b: Json): BetaRefusal<TemplateInput> {
  const name = words(b.name);
  if (!name) return no("name_required", "Give the checklist a name.");
  if (name.length > TEMPLATE_NAME_MAX) return no("name_too_long", `Keep the name under ${TEMPLATE_NAME_MAX} characters.`);
  if (b.active != null && typeof b.active !== "boolean") return no("active_invalid", "Active must be yes or no.");
  if (!Array.isArray(b.items)) return no("items_required", "Add at least one thing to check.");
  const items: TemplateItemInput[] = [];
  for (const raw of b.items as unknown[]) {
    const r = (raw && typeof raw === "object" ? raw : {}) as Json;
    const item = words(r.item);
    const area = words(r.area);
    const criteria = words(r.criteria);
    if (!item) {
      if (area || criteria) return no("item_required", `Say what to check${area ? ` in ${area}` : ""}.`);
      continue;
    }
    if (item.length > ITEM_TEXT_MAX) return no("item_too_long", `Keep each thing to check under ${ITEM_TEXT_MAX} characters.`);
    if (area && area.length > ITEM_AREA_MAX) return no("area_too_long", `Keep each area under ${ITEM_AREA_MAX} characters.`);
    if (criteria && criteria.length > ITEM_CRITERIA_MAX) return no("criteria_too_long", `Keep "what good looks like" under ${ITEM_CRITERIA_MAX} characters.`);
    items.push({ area, item, criteria });
  }
  if (items.length === 0) return no("items_required", "Add at least one thing to check.");
  if (items.length > TEMPLATE_ITEMS_MAX) return no("too_many_items", `A checklist holds up to ${TEMPLATE_ITEMS_MAX} things to check.`);
  return { ok: true, value: { name, active: b.active !== false, items } };
}

/** The items as the insert reads them: jsonb_to_recordset(...) WITH ORDINALITY gives the order. */
export function templateItemsJson(items: readonly TemplateItemInput[]): string {
  return JSON.stringify(items.map((i) => ({ area: i.area, item: i.item, criteria: i.criteria })));
}

/** Pass, Not applicable or clear (null) from the check screen. Fail goes through the defect report. */
export function cleanItemMark(b: Json): BetaRefusal<{ result: "pass" | "na" | null; note: string | null }> {
  const r = b.result;
  if (r === "fail") return no("fail_needs_defect", "Report the problem with a photo to mark it failed.");
  if (r != null && r !== "pass" && r !== "na") return no("result_invalid", "Mark it Pass or Not applicable.");
  if (b.note != null && typeof b.note !== "string") return no("note_invalid", "The note must be text.");
  const note = words(b.note);
  if (note && note.length > CHECK_NOTE_MAX) return no("note_too_long", `Keep the note under ${CHECK_NOTE_MAX} characters.`);
  return { ok: true, value: { result: (r ?? null) as "pass" | "na" | null, note } };
}

export interface CheckItemState { result: string | null; defectId: number | null }
export interface CheckState { completedAt: string | null }

/** Why an item cannot be marked from the check screen now; null when it can. */
export function itemMarkRefusal(check: CheckState, item: CheckItemState): { error: string; message: string } | null {
  if (check.completedAt) return { error: "check_finished", message: "This check is finished. Reopen it to change a mark." };
  // A Fail stays Fail: its defect is worked in the Defects board (and only goes with the whole project).
  if (item.defectId != null || item.result === "fail") return { error: "defect_raised", message: "This item failed and has a defect. Close the defect in the Defects board instead." };
  return null;
}

/** Why a defect cannot be linked to an item (report a problem from the check); null when it can. */
export function itemFailRefusal(check: CheckState, item: CheckItemState): { error: string; message: string } | null {
  if (check.completedAt) return { error: "check_finished", message: "This check is finished. Reopen it to report a problem from it." };
  if (item.defectId != null) return { error: "defect_raised", message: "This item already has a defect." };
  return null;
}

export interface CheckProgress { total: number; checked: number; passed: number; failed: number; na: number; open: number }

export function checkProgress(items: ReadonlyArray<{ result: string | null }>): CheckProgress {
  const out: CheckProgress = { total: items.length, checked: 0, passed: 0, failed: 0, na: 0, open: 0 };
  for (const i of items) {
    if (i.result === "pass") out.passed += 1;
    else if (i.result === "fail") out.failed += 1;
    else if (i.result === "na") out.na += 1;
    else { out.open += 1; continue; }
    out.checked += 1;
  }
  return out;
}

/** Finish needs every item marked; until then the check simply stays open. */
export function finishRefusal(check: CheckState, progress: CheckProgress): { error: string; message: string } | null {
  if (check.completedAt) return { error: "check_finished", message: "This check is already finished." };
  if (progress.open > 0) {
    return {
      error: "items_unchecked",
      message: `${progress.open} item${progress.open === 1 ? " is" : "s are"} not marked yet. The check stays open until each one is marked.`,
    };
  }
  return null;
}
