/* Pure helpers for the renovation screens: labels, tones, dates, error text. */

import type { StageState, SupplyCondition, TaskStatus, UnitKeyStatus } from "./renovationApi";

export type Tone = "ok" | "warn" | "err" | "muted" | "info";

export const SUPPLY_LABEL: Record<SupplyCondition, string> = {
  none: "No items",
  pending_purchased: "Pending purchased",
  pending_arrived: "Pending arrived",
  all_arrived: "All arrived",
};

export function supplyTone(c: SupplyCondition | null | undefined): Tone {
  if (c === "all_arrived") return "ok";
  if (c === "pending_arrived") return "info";
  if (c === "pending_purchased") return "warn";
  return "muted";
}

export function supplyLabel(c: SupplyCondition | null | undefined): string {
  return c ? SUPPLY_LABEL[c] : "Not available";
}

export const UNIT_KEY_LABEL: Record<UnitKeyStatus, string> = {
  not_collected: "Not collected",
  collected: "With us",
  returned: "Returned",
  unknown: "Not recorded",
};

export const STAGE_STATE_LABEL: Record<StageState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
  skipped: "Skipped",
};

export function stageTone(s: StageState): Tone {
  return s === "done" ? "ok" : s === "in_progress" ? "info" : s === "skipped" ? "muted" : "muted";
}

export const SKIP_SOURCE_TEXT: Record<"manual" | "type" | "auto", string> = {
  manual: "Skipped by hand",
  type: "Not in this project type",
  auto: "Nothing on the sales order for this stage",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  skipped: "Skipped",
  done: "Done",
  in_progress: "In progress",
  overdue: "Overdue",
  late_start: "Late start",
  planned: "Planned",
  unscheduled: "No dates",
};

export function taskTone(s: TaskStatus): Tone {
  if (s === "done") return "ok";
  if (s === "overdue" || s === "late_start") return "err";
  if (s === "in_progress") return "info";
  return "muted";
}

export const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-synced-bg text-synced border-synced/30",
  warn: "bg-warning-bg text-warning-text border-warning-text/20",
  err: "bg-err-bg text-err border-err/30",
  info: "bg-primary/10 text-primary border-primary/30",
  muted: "bg-surface-dim text-ink-secondary border-border",
};

export function money(sen: number | null | undefined): string {
  if (sen == null) return "-";
  return `RM ${(sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

/** YYYY-MM-DD plus n days (calendar drag). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** Every date from `from` to `to` inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** A task's planned range moved by `delta` days, keeping its length. A task with
    only one date moves that date. */
export function shiftRange(start: string | null, end: string | null, delta: number): { start: string | null; end: string | null } {
  return { start: start ? addDays(start, delta) : null, end: end ? addDays(end, delta) : null };
}

const ERROR_TEXT: Record<string, string> = {
  hardware_gate_closed: "Not ready for site works yet.",
  unskippable: "This cannot be skipped.",
  reason_required: "Give a reason of at least 3 characters.",
  already_done: "It is already done.",
  stage_blocked: "This stage still has open items.",
  stage_skipped: "Un-skip the stage first.",
  not_skipped_by_hand: "Only a stage skipped by hand can be un-skipped.",
  po_task_completes_on_receipt: "A subcontracted task completes when its purchase order is received on site.",
  snags_open: "Close every snag before the customer signs the handover.",
  renovation_read_failed: "Project facts could not be read, so nothing was changed. Try again.",
  end_before_start: "The end date is before the start date.",
  use_skip_with_reason: "Skip this item with a reason instead.",
};

const BLOCKER_TEXT: Record<string, string> = {
  checklist_open: "checklist items open",
  pod_missing: "lines without proof of delivery",
  tasks_open: "tasks not done",
  snags_open: "snags open",
  handover_unsigned: "handover form not signed",
  hardware_gate_closed: "hardware gate closed",
  stage_skipped: "stage is skipped",
  already_done: "already done",
};

/** "3 checklist items open, 1 lines without proof of delivery" from ["checklist_open:3", "pod_missing:1"]. */
export function blockerText(blockers: readonly string[]): string {
  return blockers
    .map((b) => {
      const [code, n] = b.split(":");
      const t = BLOCKER_TEXT[code!] ?? code!.replace(/_/g, " ");
      return n ? `${n} ${t}` : t;
    })
    .join(", ");
}

/** Human text for an API error thrown by api/client (HttpError carries the body). */
export function errorText(e: unknown): string {
  const raw = (e as { rawBody?: string } | null)?.rawBody ?? (e as Error | null)?.message ?? String(e);
  try {
    const j = JSON.parse(String(raw)) as { error?: string; message?: string; messages?: string[]; blockers?: string[] };
    if (j.messages?.length) return `${ERROR_TEXT[j.error ?? ""] ?? ""} ${j.messages.join(" ")}`.trim();
    if (j.blockers?.length) return `${ERROR_TEXT[j.error ?? ""] ?? "Not yet:"} ${blockerText(j.blockers)}.`;
    if (j.message) return j.message;
    if (j.error) return ERROR_TEXT[j.error] ?? j.error.replace(/_/g, " ");
  } catch {
    /* not JSON */
  }
  return String(raw);
}

/** Where a task's bar sits in a window of days: first column index and span,
    clipped to the window; null when it falls outside or has no dates. */
export function barPlacement(start: string | null, end: string | null, from: string, to: string): { col: number; span: number; clippedStart: boolean; clippedEnd: boolean } | null {
  const s = start ?? end;
  const e = end ?? start;
  if (!s || !e) return null;
  if (e < from || s > to) return null;
  const cs = s < from ? from : s;
  const ce = e > to ? to : e;
  return { col: daysBetween(from, cs), span: daysBetween(cs, ce) + 1, clippedStart: s < from, clippedEnd: e > to };
}

/** Monday of the week holding `iso`. */
export function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

/** Tasks active on a day (for the phone list). */
export function activeOn<T extends { planned_start: string | null; planned_end: string | null }>(tasks: readonly T[], day: string): T[] {
  return tasks.filter((t) => {
    const s = t.planned_start ?? t.planned_end;
    const e = t.planned_end ?? t.planned_start;
    return !!s && !!e && s <= day && e >= day;
  });
}
