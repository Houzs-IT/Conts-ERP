/* Pure rules behind the Beta project workspace, bundle A (plan section 9). No React, no calls: every function
   takes today (Malaysia time, YYYY-MM-DD) as a value so the rules can be tested on fixed dates. */

import { RENO_STAGES, STAGE_LABEL } from "../../vendor/shared/renovation-stages";
import { CATEGORY_LABEL, type TimelineEntry } from "../projects/renovation/renovationTimelineModel";
import { daysBetween, money, shortDate } from "../projects/renovation/renovationModel";
import type { DesignFile, SiteMeasure, TaskViewV2 } from "../projects/renovation/simpleApi";
import type { BetaDefect, BetaInstalment, BetaPayments, BetaReview, BetaWorkspace, ReminderKind } from "./renovationBetaApi";
import {
  APPT_LABEL, apptLeftText, apptWithDefault, dayWord, deadlineGroups, diff, ds, leftText, ord, todoText,
  type ApptKey, type BoardModel, type DesignProject, type Kind,
} from "./renovationBetaBoard";
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

/** Days from today to a due date: positive = still to go, negative = late. */
export function daysLeft(due: string | null, today: string): number | null {
  return due ? daysBetween(today, day(due)) : null;
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

/** One step of design work the To do card can start: it opens a shared form or writes through the board routes. */
export type DesignOp =
  | { op: "book"; key: ApptKey }
  | { op: "start"; k: Kind }
  | { op: "approve"; k: Kind }
  | { op: "amend"; k: Kind }
  | { op: "dates" }
  | { op: "assign" }
  | { op: "po" };

export type TodoAction =
  | { type: "remind"; label: string; kind: ReminderKind; text: string; phone: string | null }
  | { type: "open"; label: string; tab: BetaTabKey }
  | ({ type: "design"; label: string } & DesignOp);

/** group is the short word the "Next step" box shows after its label, for example "waiting for client".
    more are the extra buttons a row has beside its first action (waiting for client: + Amendment, Client approved). */
export interface TodoRow { id: string; tone: "err" | "warn" | "muted"; group: string; title: string; detail: string | null; action: TodoAction; more?: TodoAction[] }

export interface TodoInput {
  today: string;
  projectName: string;
  /** The project's current stage key (ProjectDetail.currentStage). */
  currentStage: string;
  workspace: Pick<BetaWorkspace, "payments" | "defects">;
}

const lateText = (n: number): string => `${n} day${n === 1 ? "" : "s"} late`;

const RANK = { err: 0, warn: 1, muted: 2 } as const;

/** The payment and defect rows. The design rows come from the board logic (designTodoRows), so they match Calendar. */
export function todoList(input: TodoInput): TodoRow[] {
  const { today, projectName, currentStage, workspace } = input;
  const rows: TodoRow[] = [];

  const strip = paymentStrip(workspace.payments);
  const next = strip?.rows.find((r) => r.status !== "paid");
  if (next) {
    const reach = stageReach(next.stageCode, currentStage);
    if (reach !== "later") {
      const unlocks = next.unlocks ?? "its step";
      rows.push({
        id: `payment-${next.seq}`,
        tone: reach === "reached" ? "warn" : "muted",
        group: "waiting for payment",
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
      group: "defect late",
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

  return rows.sort((a, b) => RANK[a.tone] - RANK[b.tone]);
}

/** This project's rows from the Deadlines logic Calendar uses (everything for who = "All", filtered to the project):
    deadlines, booked appointments, waiting for client, ready to start and to book. The handover date is left out, the
    header already shows it. Wording and buttons follow Calendar's Deadlines view. */
export function designTodoRows(m: BoardModel, p: DesignProject, canAssign: boolean, customerPhone: string | null): TodoRow[] {
  const g = deadlineGroups(m, "All", canAssign);
  const rows: TodoRow[] = [];

  for (const x of [...g.late, ...g.week, ...g.two, ...g.later]) {
    if (x.p.id !== p.id) continue;
    const l = diff(x.due, m.today);
    if (x.type === "due") {
      if (x.k === "h") continue;
      const sub = x.from ? (x.n ? `Amendment started ${ds(x.from)} · ${x.days} ${dayWord(x.days ?? 0)}` : `Started ${ds(x.from)} · SOP ${m.sop[x.k]} days`) : null;
      rows.push({
        id: `due-${x.k}-${x.n}`,
        tone: l < 0 ? "err" : l <= 2 ? "warn" : "muted",
        group: "design deadline",
        title: `${x.what} · ${ds(x.due)}`,
        detail: [leftText(l), x.by ? `${x.k}D by ${x.by.name}` : null, sub].filter(Boolean).join(" · "),
        action: { type: "open", label: "Open drawings", tab: "drawings" },
      });
    } else {
      rows.push({
        id: `appt-${x.ak}`,
        tone: l < 0 ? "err" : "muted",
        group: "appointment",
        title: `${APPT_LABEL[x.ak]}${x.a.t ? ` · ${x.a.t}` : ""} · ${ds(x.due)}`,
        detail: `${apptLeftText(l)} · with ${x.a.with || apptWithDefault(x.p, x.ak)}`,
        action: canAssign ? { type: "design", label: "Edit", op: "book", key: x.ak } : { type: "open", label: "Open drawings", tab: "drawings" },
      });
    }
  }

  for (const x of g.waiting) {
    if (x.p.id !== p.id) continue;
    const ago = diff(m.today, x.sent);
    const label = `${x.k}D${x.n ? ` ${ord(x.n)} amendment` : ""}`;
    rows.push({
      id: `approval-${x.k}-${x.n}`,
      tone: "muted",
      group: "waiting for client",
      title: `${label} sent ${ds(x.sent)}${ago > 0 ? ` · ${ago} ${dayWord(ago)} ago` : ""}`,
      detail: x.p.by[x.k] ? `${x.k}D by ${x.p.by[x.k]?.name}` : null,
      action: {
        type: "remind",
        label: "Remind client",
        kind: "client_approval",
        text: `Hi${p.customer ? ` ${p.customer}` : ""}, a gentle reminder about the ${label} drawing for ${p.title}, sent on ${ds(x.sent)}. Please let us know if you approve it. Thank you.`,
        phone: customerPhone,
      },
      more: [{ type: "design", label: "+ Amendment", op: "amend", k: x.k }, { type: "design", label: "Client approved", op: "approve", k: x.k }],
    });
  }

  for (const x of g.ready) {
    if (x.p.id !== p.id) continue;
    rows.push({
      id: `ready-${x.k}`,
      tone: "muted",
      group: "ready to start",
      title: x.k === "3" ? "3D not started" : "3D approved · 2D not started",
      detail: x.p.by[x.k] ? `${x.k}D by ${x.p.by[x.k]?.name}` : null,
      action: { type: "design", label: `Start ${x.k}D today`, op: "start", k: x.k },
      more: [{ type: "design", label: "Edit", op: "dates" }],
    });
  }

  for (const x of g.todo) {
    if (x.p.id !== p.id) continue;
    const action: TodoAction = x.k === "as" ? { type: "design", label: "Assign", op: "assign" }
      : x.k === "po" ? { type: "design", label: "PO done", op: "po" }
      : { type: "design", label: "Book time", op: "book", key: x.k };
    rows.push({ id: `todo-${x.k}`, tone: "warn", group: "to book", title: todoText(m, x), detail: null, action });
  }

  return rows;
}

/** The To do card's rows: design rows from the board logic, then payment and defect rows, worst first (stable inside a tone). */
export function mergeTodo(design: readonly TodoRow[], other: readonly TodoRow[]): TodoRow[] {
  return [...design, ...other].map((r, i) => ({ r, i })).sort((a, b) => RANK[a.r.tone] - RANK[b.r.tone] || a.i - b.i).map((x) => x.r);
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

/* ---------- Dates as the mockup prints them ---------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function ymd(iso: string | null | undefined): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** "14 Oct" (the mockup never prints the year on a card); "-" when there is no date. Fixed month names, not the browser's locale. */
export function dayMonth(iso: string | null | undefined): string {
  const p = ymd(iso);
  return p ? `${p[2]} ${MONTHS[p[1] - 1] ?? ""}` : "-";
}

/** "15 Nov 2026"; "-" when there is no date. */
export function dayMonthYear(iso: string | null | undefined): string {
  const p = ymd(iso);
  return p ? `${p[2]} ${MONTHS[p[1] - 1] ?? ""} ${p[0]}` : "-";
}

/** A day's heading: "14 Oct", with the year when it is not today's year. */
export function dayHeading(dayValue: string, today: string): string {
  return ymd(dayValue)?.[0] === ymd(today)?.[0] ? dayMonth(dayValue) : dayMonthYear(dayValue);
}

/** The Malaysia-time calendar day (YYYY-MM-DD) of a stored time; a date-only value is returned as it is. */
export function mytDay(at: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  const t = Date.parse(at);
  return Number.isNaN(t) ? at.slice(0, 10) : new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
}

/** "09:40" in Malaysia time; null for a date-only value or a value that is not a time. */
export function mytTime(at: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return null;
  const t = Date.parse(at);
  return Number.isNaN(t) ? null : new Date(t + 8 * 3600e3).toISOString().slice(11, 16);
}

export interface DayGroup<T> { day: string | null; items: T[] }

/** Groups by day in the order each day first appears (callers pass newest first); items without a day come last. */
export function groupByDay<T>(items: readonly T[], dayOf: (item: T) => string | null): Array<DayGroup<T>> {
  const dated = new Map<string, T[]>();
  const undated: T[] = [];
  for (const item of items) {
    const d = dayOf(item);
    if (!d) { undated.push(item); continue; }
    const list = dated.get(d);
    if (list) list.push(item); else dated.set(d, [item]);
  }
  const out: Array<DayGroup<T>> = [...dated].map(([d, list]) => ({ day: d, items: list }));
  if (undated.length > 0) out.push({ day: null, items: undated });
  return out;
}

/** Up to two capital letters for an avatar: "Jia Xin" gives "JX", "Alex" gives "A". */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const first = words.at(0);
  const last = words.at(-1);
  if (!first || !last) return "?";
  return (words.length === 1 ? first.slice(0, 1) : `${first.slice(0, 1)}${last.slice(0, 1)}`).toUpperCase();
}

/* ---------- Payment cards (Overview) ---------- */

export interface PaymentCardView {
  /** paid = green card; alert = red card (the payment a reached step is waiting for); quiet = grey card. */
  look: "paid" | "alert" | "quiet";
  badge: string;
  note: string;
}

/** The mockup's three looks. There is no paid date in the data, so a paid card names only the step it unlocked. */
export function paymentCard(r: Pick<PaymentRow, "status" | "stageCode" | "unlocks">, currentStage: string, handoverOn: string | null): PaymentCardView {
  const { unlocks } = r;
  if (r.status === "paid") return { look: "paid", badge: "Paid", note: unlocks ? `Paid · unlocked ${unlocks}` : "Paid" };
  if (!r.stageCode) {
    return r.status === "billed"
      ? { look: "alert", badge: "Not confirmed", note: "Billed, waiting for payment" }
      : { look: "quiet", badge: "Not billed", note: "Not tied to a step" };
  }
  if (stageReach(r.stageCode, currentStage) !== "later") return { look: "alert", badge: "Not confirmed", note: `Needed before ${unlocks ?? "its step"}` };
  const atHandover = r.stageCode === "handover";
  return { look: "quiet", badge: atHandover ? "At handover" : "Not due yet", note: `Unlocks ${unlocks ?? "its step"}${atHandover && handoverOn ? ` · ${dayMonth(handoverOn)}` : ""}` };
}

/* ---------- To do: the highlighted "Next step" ---------- */

/** The next step is the design waiting for the client when there is one (as in the mockup), else the worst row. */
export function nextStep(rows: readonly TodoRow[]): { next: TodoRow | null; rest: TodoRow[] } {
  const next = rows.find((r) => r.id.startsWith("approval-")) ?? rows.at(0) ?? null;
  return { next, rest: rows.filter((r) => r !== next) };
}

/* ---------- Site progress: the vertical timeline ---------- */

export interface RenovationDays { day: number; total: number; start: string }

type TaskDates = Pick<TaskViewV2, "status" | "planned_start" | "planned_end" | "actual_start" | "actual_end">;

/** "Day N of M": from the earliest start to the latest end of the live site tasks. null when the tasks have no dates. day is 0 before the start. */
export function renovationDays(tasks: readonly TaskDates[], today: string): RenovationDays | null {
  const live = tasks.filter((t) => t.status !== "skipped");
  const starts = live.flatMap((t) => { const d = t.actual_start ?? t.planned_start; return d ? [day(d)] : []; }).sort();
  const ends = live.flatMap((t) => { const d = t.actual_end ?? t.planned_end; return d ? [day(d)] : []; }).sort();
  const start = starts.at(0);
  const end = ends.at(-1);
  if (!start || !end) return null;
  const total = daysBetween(start, end) + 1;
  if (total < 1) return null;
  return { day: Math.min(total, Math.max(0, daysBetween(start, today) + 1)), total, start };
}

export type SiteStepState = "done" | "current" | "late" | "later" | "handover";

export interface SiteStep { id: string; state: SiteStepState; date: string | null; label: string; sub: string | null }

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

function siteStepOf(t: TaskViewV2, today: string): SiteStep {
  const state: SiteStepState = t.status === "done" ? "done" : t.status === "in_progress" ? "current" : t.status === "overdue" || t.status === "late_start" ? "late" : "later";
  const raw = state === "done" ? (t.actual_end ?? t.planned_end ?? t.planned_start)
    : state === "current" ? today
    : state === "late" ? (t.planned_end ?? t.planned_start)
    : (t.planned_start ?? t.planned_end);
  let sub: string | null = null;
  if (state === "done") sub = "Done";
  else if (state === "current") sub = ["In progress", ...(t.assignees ?? []).map((a) => a.name)].join(" · ");
  else if (state === "late") {
    const due = t.status === "overdue" ? (t.planned_end ?? t.planned_start) : (t.planned_start ?? t.planned_end);
    sub = due ? `${plural(Math.max(1, daysBetween(day(due), today)), "day")} late` : "Late";
  }
  return { id: `task-${t.id}`, state, date: raw ? day(raw) : null, label: t.label, sub };
}

/** Live (not skipped) site tasks in date order, then the handover. The current rows are the tasks in progress, dated today. */
export function siteTimeline(tasks: readonly TaskViewV2[], today: string, handoverOn: string | null): SiteStep[] {
  const rows = tasks
    .filter((t) => t.status !== "skipped")
    .map((t) => ({ t, step: siteStepOf(t, today) }))
    .sort((a, b) => (a.step.date ?? "9999").localeCompare(b.step.date ?? "9999") || a.t.seq - b.t.seq || a.t.id - b.t.id)
    .map((r) => r.step);
  if (handoverOn) rows.push({ id: "handover", state: "handover", date: day(handoverOn), label: "Handover", sub: "Final payment · keys to client" });
  return rows;
}

export interface TrimmedTimeline { steps: SiteStep[]; hiddenDone: number; hiddenLater: number }

/** A long list shows the last few finished steps and the next few ahead; showAll keeps everything. The handover always stays. */
export function trimTimeline(steps: readonly SiteStep[], showAll: boolean, keepDone = 3, keepLater = 8): TrimmedTimeline {
  if (showAll) return { steps: [...steps], hiddenDone: 0, hiddenLater: 0 };
  const done = steps.filter((s) => s.state === "done");
  const dropDone = new Set(done.slice(0, Math.max(0, done.length - keepDone)));
  const dropLater = new Set(steps.filter((s) => s.state === "later").slice(keepLater));
  return { steps: steps.filter((s) => !dropDone.has(s) && !dropLater.has(s)), hiddenDone: dropDone.size, hiddenLater: dropLater.size };
}

/* ---------- The stage stepper (header) ---------- */

export interface StepperItem { key: string; label: string; state: "done" | "current" | "later"; sub: string }

export interface StepperInput {
  /** The project's flow steps (ProjectDetailV2.flow), for their labels and for which steps exist. */
  steps: ReadonlyArray<{ key: string; label: string }>;
  /** The flow's current step key. */
  currentKey: string;
  currentIndex: number;
  soDate: string | null;
  handoverOn: string | null;
  tasks: readonly TaskDates[];
  today: string;
}

/** The engine's own order of the flow; the mockup draws Sales order before Design. */
const FLOW_RANK: Readonly<Record<string, number>> = { design: 0, signed: 1, ordering: 2, renovation: 3, handover: 4, closed: 5 };
const MOCKUP_ORDER = ["signed", "design", "ordering", "renovation", "handover", "closed"] as const;

/** The mockup's six circles in its order. Flow at design: Sales order not signed, Design current. Flow at signed: Sales order done, Design current. Ordering or later: both done. */
export function stepperItems(i: StepperInput): StepperItem[] {
  const days = renovationDays(i.tasks, i.today);
  const cur = FLOW_RANK[i.currentKey] ?? i.currentIndex;
  const label = (key: string, fallback: string): string => i.steps.find((s) => s.key === key)?.label ?? fallback;
  return MOCKUP_ORDER.filter((key) => i.steps.some((s) => s.key === key)).map((key): StepperItem => {
    const rank = FLOW_RANK[key] ?? 0;
    if (key === "signed") {
      const done = cur >= 1;
      return { key, label: "Sales order", state: done ? "done" : "later", sub: done ? (i.soDate ? `Signed ${dayMonth(i.soDate)}` : "Signed") : "Not signed yet" };
    }
    const state: StepperItem["state"] = key === "design" ? (cur >= 2 ? "done" : "current") : rank < cur ? "done" : rank === cur ? "current" : "later";
    let sub = "-";
    if (key === "design") sub = state === "done" ? "Design approved" : "In progress";
    else if (key === "ordering") sub = state === "done" ? "Main items ordered" : state === "current" ? "In progress" : "-";
    else if (key === "renovation") {
      if (state === "current") sub = days && days.day > 0 ? `Day ${days.day} of ${days.total}` : days ? `Starts ${dayMonth(days.start)}` : "In progress";
      else if (state === "done") sub = "Done";
    } else if (key === "handover") sub = i.handoverOn ? dayMonth(i.handoverOn) : state === "done" ? "Done" : "-";
    return { key, label: label(key, key), state, sub };
  });
}
