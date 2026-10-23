/* Pure rules behind the Beta project workspace, bundle A (plan section 9). No React, no calls: every function
   takes today (Malaysia time, YYYY-MM-DD) as a value so the rules can be tested on fixed dates. */

import { RENO_STAGES, STAGE_LABEL } from "../../vendor/shared/renovation-stages";
import { CATEGORY_LABEL, type TimelineEntry } from "../projects/renovation/renovationTimelineModel";
import { addDays, daysBetween, money, shortDate } from "../projects/renovation/renovationModel";
import type { DesignFile, SiteMeasure, TaskViewV2 } from "../projects/renovation/simpleApi";
import type { BetaDefect, BetaInstalment, BetaPayments, BetaReview, BetaSettings, BetaWorkspace, ReminderKind } from "./renovationBetaApi";
import type { BetaTabKey } from "./renovationBetaTabs";

const day = (iso: string): string => iso.slice(0, 10);

/* ---------- Drawings ---------- */

export type DesignKind = "3d" | "2d";

export interface VersionInfo { file: DesignFile; review: BetaReview | null }

export interface ApprovedSet {
  /** Newest first. */
  versions: VersionInfo[];
  /** The newest version that has an approval. */
  approved: VersionInfo | null;
  /** The newest version when it has no approval yet (a newer one than the approved set, or the first one). */
  waiting: VersionInfo | null;
}

export function versionLabel(kind: DesignKind, file: Pick<DesignFile, "version">): string {
  return `${kind.toUpperCase()} v${file.version}`;
}

export function approvedSet(files: readonly DesignFile[], reviews: readonly BetaReview[], kind: DesignKind): ApprovedSet {
  const byFile = new Map(reviews.map((r) => [r.fileId, r]));
  const versions = files
    .filter((f) => f.kind === kind)
    .sort((a, b) => b.version - a.version || b.id - a.id)
    .map((file) => ({ file, review: byFile.get(file.id) ?? null }));
  const approved = versions.find((v) => v.review?.approvedOn) ?? null;
  const newest = versions.at(0) ?? null;
  return { versions, approved, waiting: newest && newest !== approved ? newest : null };
}

export function firstMeasureDate(measures: readonly Pick<SiteMeasure, "done_on">[]): string | null {
  const dates = measures.flatMap((m) => (m.done_on ? [day(m.done_on)] : [])).sort();
  return dates.at(0) ?? null;
}

export interface DesignDeadlines { threeDDue: string | null; twoDDue: string | null }

/** 3D is due design3dDays after the first site measure; 2D design2dDays after the 3D approval. null when the start is unknown. */
export function designDeadlines(measures: readonly Pick<SiteMeasure, "done_on">[], threeD: ApprovedSet, settings: BetaSettings): DesignDeadlines {
  const measured = firstMeasureDate(measures);
  const approvedOn = threeD.approved?.review?.approvedOn ?? null;
  return {
    threeDDue: measured ? addDays(measured, settings.design3dDays) : null,
    twoDDue: approvedOn ? addDays(day(approvedOn), settings.design2dDays) : null,
  };
}

/** Days from today to a due date: positive = still to go, negative = late. */
export function daysLeft(due: string | null, today: string): number | null {
  return due ? daysBetween(today, day(due)) : null;
}

export interface DesignRow {
  kind: "onsite" | DesignKind;
  label: string;
  state: "done" | "waiting" | "open";
  /** The measure date (onsite) or the approval date. */
  doneOn: string | null;
  due: string | null;
  daysLeft: number | null;
  version: string | null;
}

/** Overview: where design stands. waiting = a version went to the client and is not approved. */
export function designProgress(files: readonly DesignFile[], measures: readonly SiteMeasure[], ws: Pick<BetaWorkspace, "reviews" | "settings">, today: string): DesignRow[] {
  const threeD = approvedSet(files, ws.reviews, "3d");
  const twoD = approvedSet(files, ws.reviews, "2d");
  const { threeDDue, twoDDue } = designDeadlines(measures, threeD, ws.settings);
  const measured = firstMeasureDate(measures);
  const row = (kind: DesignKind, set: ApprovedSet, due: string | null): DesignRow => {
    const state = set.approved ? "done" : set.waiting?.review?.sentOn ? "waiting" : "open";
    const shown = set.approved ?? set.waiting;
    return {
      kind,
      label: kind.toUpperCase(),
      state,
      doneOn: set.approved?.review?.approvedOn ? day(set.approved.review.approvedOn) : null,
      due: state === "done" ? null : due,
      daysLeft: state === "done" ? null : daysLeft(due, today),
      version: shown ? versionLabel(kind, shown.file) : null,
    };
  };
  return [
    { kind: "onsite", label: "Onsite", state: measured ? "done" : "open", doneOn: measured, due: null, daysLeft: null, version: null },
    row("3d", threeD, threeDDue),
    row("2d", twoD, twoDDue),
  ];
}

/* ---------- Defects ---------- */

export type DefectColumn = "to_fix" | "check" | "done";

export function defectColumn(d: Pick<BetaDefect, "closedAt" | "fixedAt">): DefectColumn {
  return d.closedAt ? "done" : d.fixedAt ? "check" : "to_fix";
}

/** Whole days past the fix-by date; 0 when not late, when there is no date, or once the defect is fixed or closed. */
export function defectDaysLate(d: Pick<BetaDefect, "closedAt" | "fixedAt" | "dueDate">, today: string): number {
  if (!d.dueDate || defectColumn(d) !== "to_fix") return 0;
  return Math.max(0, daysBetween(day(d.dueDate), today));
}

export function groupDefects(defects: readonly BetaDefect[]): Record<DefectColumn, BetaDefect[]> {
  const out: Record<DefectColumn, BetaDefect[]> = { to_fix: [], check: [], done: [] };
  for (const d of defects) out[defectColumn(d)].push(d);
  // Earliest fix-by date first; no date last.
  out.to_fix.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.id - b.id);
  return out;
}

/** "N of M closed" for the handover: only snags count, as the server's handover rule does. */
export function snagProgress(defects: readonly Pick<BetaDefect, "phase" | "closedAt">[]): { closed: number; total: number } {
  const snags = defects.filter((d) => d.phase === "snag");
  return { closed: snags.filter((d) => d.closedAt).length, total: snags.length };
}

/* ---------- WhatsApp ---------- */

/** Digits for wa.me: Malaysian 0-prefixed numbers become 60...; null when the number cannot be a phone number. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("600")) digits = `60${digits.slice(3)}`; // "+60 012..." typed with the 0 kept
  else if (digits.startsWith("0")) digits = `60${digits.slice(1)}`;
  else if (digits.startsWith("1") && digits.length >= 9 && digits.length <= 10) digits = `60${digits}`; // 12-345 6789 typed without the 0
  return digits.length >= 9 && digits.length <= 15 ? digits : null;
}

export function whatsappLink(phone: string | null | undefined, text: string): string {
  const number = whatsappNumber(phone);
  return `https://wa.me/${number ?? ""}?text=${encodeURIComponent(text)}`;
}

/* ---------- Payments ---------- */

export interface PaymentRow extends BetaInstalment { unlocks: string | null; statusLabel: string }

export interface PaymentStrip { contractSen: number; receivedSen: number; receivedPct: number | null; rows: PaymentRow[] }

const STATUS_LABEL: Record<BetaInstalment["status"], string> = { paid: "Paid", billed: "Billed", not_billed: "Not billed" };

/** The step an instalment unlocks, by its name; null when it is not tied to a step. */
export function stageName(code: string | null): string | null {
  if (!code) return null;
  return (STAGE_LABEL as Partial<Record<string, string>>)[code] ?? code;
}

export function paymentStrip(payments: BetaPayments): PaymentStrip | null {
  if (payments.state !== "ok") return null;
  const rows = [...payments.instalments]
    .sort((a, b) => a.seq - b.seq)
    .map((i) => ({ ...i, unlocks: stageName(i.stageCode), statusLabel: STATUS_LABEL[i.status] }));
  const { contractSen, receivedSen } = payments;
  return { contractSen, receivedSen, receivedPct: contractSen > 0 ? Math.round((receivedSen / contractSen) * 100) : null, rows };
}

/** reached = the project is at that step or past it; next = the step right after; later = further on. */
export function stageReach(stageCode: string | null, currentStage: string): "reached" | "next" | "later" {
  if (!stageCode) return "reached";
  const at = RENO_STAGES.findIndex((s) => s === stageCode);
  const now = RENO_STAGES.findIndex((s) => s === currentStage);
  if (at < 0 || now < 0) return "reached"; // an unknown step cannot be told apart, so it is not hidden
  return at <= now ? "reached" : at === now + 1 ? "next" : "later";
}

/* ---------- Site progress (Overview) ---------- */

export interface SiteProgress { total: number; done: number; pct: number; late: number; open: TaskViewV2[] }

const TASK_RANK: Record<string, number> = { overdue: 0, late_start: 0, in_progress: 1, planned: 2, unscheduled: 3 };

/** Skipped tasks are left out. open = what is still to do, late ones first, then by planned start. */
export function siteProgress(tasks: readonly TaskViewV2[]): SiteProgress {
  const live = tasks.filter((t) => t.status !== "skipped");
  const done = live.filter((t) => t.status === "done").length;
  const open = live
    .filter((t) => t.status !== "done")
    .sort((a, b) => (TASK_RANK[a.status] ?? 4) - (TASK_RANK[b.status] ?? 4) || (a.planned_start ?? "9999").localeCompare(b.planned_start ?? "9999") || a.id - b.id);
  return {
    total: live.length,
    done,
    pct: live.length ? Math.round((done / live.length) * 100) : 0,
    late: open.filter((t) => t.status === "overdue" || t.status === "late_start").length,
    open,
  };
}

/* ---------- To do ---------- */

export type TodoAction =
  | { type: "remind"; label: string; kind: ReminderKind; text: string; phone: string | null }
  | { type: "open"; label: string; tab: BetaTabKey };

export interface TodoRow { id: string; tone: "err" | "warn" | "muted"; title: string; detail: string | null; action: TodoAction }

export interface TodoInput {
  today: string;
  projectName: string;
  customerName: string | null;
  customerPhone: string | null;
  /** The project's current stage key (ProjectDetail.currentStage). */
  currentStage: string;
  files: readonly DesignFile[];
  measures: readonly SiteMeasure[];
  workspace: BetaWorkspace;
}

const lateText = (n: number): string => `${n} day${n === 1 ? "" : "s"} late`;

/** One row per thing that needs a person, worst first. Each row has exactly one action. */
export function todoList(input: TodoInput): TodoRow[] {
  const { today, projectName, customerName, customerPhone, currentStage, files, measures, workspace } = input;
  const rows: TodoRow[] = [];
  const threeD = approvedSet(files, workspace.reviews, "3d");
  const sets: Array<[DesignKind, ApprovedSet]> = [["3d", threeD], ["2d", approvedSet(files, workspace.reviews, "2d")]];
  const { threeDDue, twoDDue } = designDeadlines(measures, threeD, workspace.settings);

  for (const [kind, set] of sets) {
    const { waiting } = set;
    const sentOn = waiting?.review?.sentOn ?? null;
    if (waiting && sentOn) {
      const label = versionLabel(kind, waiting.file);
      const dueOn = waiting.review?.dueOn ?? null;
      const left = daysLeft(dueOn, today);
      const late = left != null && left < 0;
      rows.push({
        id: `approval-${waiting.file.id}`,
        tone: late ? "err" : "muted",
        title: `${label} sent ${shortDate(sentOn)}, waiting for the client`,
        detail: dueOn ? `Answer due ${shortDate(dueOn)}${late ? ` (${lateText(-left)})` : ""}` : "No answer date set",
        action: {
          type: "remind",
          label: "Remind client",
          kind: "client_approval",
          text: `Hi${customerName ? ` ${customerName}` : ""}, a gentle reminder about the ${label} drawing for ${projectName}, sent on ${shortDate(sentOn)}. Please let us know if you approve it${dueOn ? ` by ${shortDate(dueOn)}` : ""}. Thank you.`,
          phone: customerPhone,
        },
      });
    } else if (!set.approved) {
      // The design team's own deadline matters only while nothing has gone to the client.
      const due = kind === "3d" ? threeDDue : twoDDue;
      const left = daysLeft(due, today);
      if (due && left != null && left <= 3) {
        rows.push({
          id: `deadline-${kind}`,
          tone: left < 0 ? "err" : "warn",
          title: left < 0 ? `${kind.toUpperCase()} drawing is ${lateText(-left)}` : `${kind.toUpperCase()} drawing due ${shortDate(due)}`,
          detail: left < 0 ? `It was due ${shortDate(due)}` : left === 0 ? "Due today" : `${left} day${left === 1 ? "" : "s"} left`,
          action: { type: "open", label: "Open drawings", tab: "drawings" },
        });
      }
    }
  }

  const strip = paymentStrip(workspace.payments);
  const next = strip?.rows.find((r) => r.status !== "paid");
  if (next) {
    const reach = stageReach(next.stageCode, currentStage);
    if (reach !== "later") {
      const unlocks = next.unlocks ?? "its step";
      rows.push({
        id: `payment-${next.seq}`,
        tone: reach === "reached" ? "warn" : "muted",
        title: `Instalment ${next.seq} (${next.label}) is ${next.status === "billed" ? "billed, not paid" : "not billed"}`,
        detail: `${money(next.amountSen)}. ${unlocks} is ${reach === "reached" ? "reached" : "the next step"}.`,
        action: {
          type: "remind",
          label: "Ask Sales",
          kind: "payment",
          text: `Hi, ${projectName}: instalment ${next.seq} (${next.label}, ${money(next.amountSen)}) is ${next.status === "billed" ? "billed but not paid yet" : "not billed yet"}. ${unlocks} is ${reach === "reached" ? "reached" : "the next step"}. Please follow up.`,
          phone: null,
        },
      });
    }
  }

  for (const d of workspace.defects) {
    const late = defectDaysLate(d, today);
    if (late <= 0) continue;
    const where = d.location ?? "the unit";
    rows.push({
      id: `defect-${d.id}`,
      tone: "err",
      title: `Defect at ${where} is ${lateText(late)}`,
      detail: d.description,
      action: {
        type: "remind",
        label: "Remind",
        kind: "defect",
        text: `Defect to fix at ${where} (${projectName}): ${d.description ?? "see the project"}. It was due ${shortDate(d.dueDate)}, ${lateText(late)}. Please fix it and tell us when it is done.`,
        phone: null,
      },
    });
  }

  const rank = { err: 0, warn: 1, muted: 2 } as const;
  return rows.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

/* ---------- Timeline ---------- */

const RECORD_TITLE = /\bapproved\b|key passed|handover signed|handed over/i;

/** Approvals, key passes and the handover are the entries that settle a question; the screen tags them RECORD. */
export function isRecordEntry(e: Pick<TimelineEntry, "title">): boolean {
  return RECORD_TITLE.test(e.title ?? "");
}

/** Every word typed must appear somewhere in the entry (title, text, who, type); case does not matter. */
export function searchEntries(entries: readonly TimelineEntry[], query: string): TimelineEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((e) => {
    const hay = [e.title, e.body, e.by, CATEGORY_LABEL[e.category], isRecordEntry(e) ? "record" : ""].join("\n").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

function csvCell(v: string | null | undefined): string {
  let s = v ?? "";
  // A cell that starts with these is read as a formula by Excel; a leading apostrophe keeps it text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvDate(e: Pick<TimelineEntry, "at" | "dateOnly">): string {
  if (e.dateOnly) return day(e.at);
  const t = Date.parse(e.at);
  return Number.isNaN(t) ? e.at : new Date(t + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
}

/** CSV text (CRLF lines) with a header row; dates in Malaysia time. */
export function timelineCsv(entries: readonly TimelineEntry[]): string {
  const lines = [["Date", "Type", "Record", "Title", "Details", "By"]];
  for (const e of entries) lines.push([csvDate(e), CATEGORY_LABEL[e.category], isRecordEntry(e) ? "RECORD" : "", e.title ?? "", e.body ?? "", e.by ?? ""]);
  return lines.map((l) => l.map(csvCell).join(",")).join("\r\n");
}

/* ---------- Site & photos ---------- */

export type FeedSource = "receipt" | "onsite" | "defect_before" | "defect_after";

export interface FeedItem { id: string; source: FeedSource; key: string; at: string | null; room: string | null; caption: string; image: boolean }

export interface FeedInput {
  rooms: ReadonlyArray<{ room: string; photos: ReadonlyArray<{ id: string; r2_key: string; location: string | null; caption?: string | null; grn_number?: string | null; taken_at?: string | null }> }>;
  measures: readonly SiteMeasure[];
  defects: readonly BetaDefect[];
}

const IMAGE_KEY = /\.(png|jpe?g|webp|gif|heic)$/i;
export const NO_ROOM = "No room";

/** One list, newest first. Photos without a date (some receipt photos) come after the dated ones, in the order given. */
export function siteFeed({ rooms, measures, defects }: FeedInput): FeedItem[] {
  const items: FeedItem[] = [];
  for (const g of rooms) {
    for (const p of g.photos) {
      items.push({
        id: `receipt-${p.id}`,
        source: "receipt",
        key: p.r2_key,
        at: p.taken_at ?? null,
        room: p.location?.trim() || null,
        caption: p.caption || (p.grn_number ? `Receipt ${p.grn_number}` : "Site receipt photo"),
        image: IMAGE_KEY.test(p.r2_key),
      });
    }
  }
  for (const m of measures) {
    for (const f of m.files ?? []) {
      items.push({ id: `onsite-${f.id}`, source: "onsite", key: f.r2_key, at: m.done_on, room: null, caption: f.file_name, image: IMAGE_KEY.test(f.r2_key) || (f.content_type ?? "").startsWith("image/") });
    }
  }
  for (const d of defects) {
    const where = d.location?.trim() || null;
    const what = d.description ?? "Defect";
    if (d.photoKey) items.push({ id: `defect-${d.id}-before`, source: "defect_before", key: d.photoKey, at: d.reportedAt, room: where, caption: `Before: ${what}`, image: true });
    if (d.afterPhotoKey) items.push({ id: `defect-${d.id}-after`, source: "defect_after", key: d.afterPhotoKey, at: d.fixedAt ?? d.reportedAt, room: where, caption: `After: ${what}`, image: true });
  }
  // Array.sort is stable, so undated items keep their order.
  return items.sort((a, b) => (a.at && b.at ? b.at.localeCompare(a.at) : a.at ? -1 : b.at ? 1 : 0));
}

/** The rooms to offer in the filter: those that have a photo, in alphabetical order. */
export function feedRooms(items: readonly FeedItem[]): string[] {
  return [...new Set(items.flatMap((i) => (i.room ? [i.room] : [])))].sort((a, b) => a.localeCompare(b));
}

export function filterFeed(items: readonly FeedItem[], room: string): FeedItem[] {
  if (!room) return [...items];
  return items.filter((i) => (room === NO_ROOM ? !i.room : i.room === room));
}
