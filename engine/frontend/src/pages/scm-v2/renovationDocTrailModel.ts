import { fmtDate } from "@2990s/shared";
import { todayKl } from "../../mobile/renovationDraftDeliveryModel";

export type TrailKind = "so" | "po" | "production" | "gr" | "do";
export type TrailTone = "done" | "active" | "wait" | "stopped";
export interface TrailStep { kind: TrailKind; id: string; no: string; word: string; tone: TrailTone; date: string | null; who: string | null }
export interface TrailStage { kind: TrailKind; steps: TrailStep[]; tone: TrailTone; summary: string; overdue: boolean }

export const TRAIL_KINDS: readonly TrailKind[] = ["so", "po", "production", "gr", "do"];

const dayOf = (date: string | null): string | null => (date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null);
const isOpen = (s: TrailStep): boolean => s.tone === "active" || s.tone === "wait";

/** A PO's arrival, a production order's or DO's due date: the dates that can run late. */
export function isOverdue(s: TrailStep, today: string = todayKl()): boolean {
  const day = dayOf(s.date);
  return day !== null && isOpen(s) && (s.kind === "po" || s.kind === "production" || s.kind === "do") && day < today;
}

/** One step in words. A missing date drops its connector ("Arrives", ", due") instead of leaving it hanging. */
export function stepCaption(s: TrailStep, fmt: (day: string) => string = fmtDate): string {
  const day = dayOf(s.date);
  const d = day ? fmt(day) : null;
  if (s.kind === "po" && s.word === "Arrives") return d ? `Arrives ${d}` : "ETA pending";
  if ((s.kind === "production" || s.kind === "do") && isOpen(s) && s.word !== "Draft delivery") return d ? `${s.word}, due ${d}` : s.word;
  return d ? `${s.word} ${d}` : s.word;
}

function stageTone(steps: readonly TrailStep[]): TrailTone {
  if (steps.some((s) => s.tone === "active")) return "active";
  if (steps.some((s) => s.tone === "wait")) return "wait";
  return steps.some((s) => s.tone === "done") ? "done" : "stopped";
}

function groupSummary(kind: TrailKind, steps: readonly TrailStep[], today: string): Pick<TrailStage, "summary" | "overdue"> {
  const open = steps.filter(isOpen);
  if (open.length === 0) {
    const stopped = steps.filter((s) => s.tone === "stopped").length;
    return { summary: stopped === 0 ? "All done" : `${steps.length - stopped} done, ${stopped} stopped`, overdue: false };
  }
  const next = open.filter((s) => dayOf(s.date) !== null).sort((a, b) => (dayOf(a.date) ?? "").localeCompare(dayOf(b.date) ?? "")).at(0);
  const undated = open.filter((s) => dayOf(s.date) === null).length;
  const parts = [
    next ? `${kind === "po" ? "Next ETA" : "Next due"} ${fmtDate(dayOf(next.date) ?? "")}` : null,
    undated > 0 ? `${undated} pending ${kind === "po" ? "ETA" : "date"}` : null,
  ];
  return { summary: parts.filter(Boolean).join(" · "), overdue: next ? isOverdue(next, today) : false };
}

/** The five stages in order, each holding its documents; a stage with several gets one summary line. */
export function stagesOf(steps: readonly TrailStep[], today: string = todayKl()): TrailStage[] {
  return TRAIL_KINDS.map((kind) => {
    const mine = steps.filter((s) => s.kind === kind);
    const only = mine.at(0);
    if (!only) return { kind, steps: mine, tone: "wait", summary: "Not yet", overdue: false };
    if (mine.length === 1) return { kind, steps: mine, tone: only.tone, summary: stepCaption(only), overdue: isOverdue(only, today) };
    return { kind, steps: mine, tone: stageTone(mine), ...groupSummary(kind, mine, today) };
  });
}
