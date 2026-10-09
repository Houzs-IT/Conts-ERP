/* Stage views of a renovation project: what each of the 11 stages is right now.

   Stored rows (public.project_stages) hold only what a person decided: started,
   done, or skipped by hand with a reason. Everything else is worked out here on
   every read, in this order of precedence:
     1. manual skip   (stored state 'skipped', always with a reason)
     2. type skip     (the project type does not run this stage)
     3. auto skip     (the sales order has no live line in the stage's groups)
     4. stored state  (not_started / in_progress / done)
   Because 2 and 3 are derived, a variation order that adds furniture lines
   re-opens an auto-skipped Furniture stage without any write.

   A line belongs to the stage its group (or the line's stage override) names.
   When that stage is skipped, the line moves to the next stage that is not
   skipped, so its proof of delivery and billing still have a home. */

import { categoryGroupOf, defaultStageOf, type CatalogGroup } from "../../scm/shared/renovation-catalog";
import {
  AUTO_SKIP_RULE,
  RENO_STAGES,
  STAGE_LABEL,
  UNSKIPPABLE,
  isStageKey,
  stageSeq,
  type StageKey,
} from "../../scm/shared/renovation-stages";

export type StageState = "not_started" | "in_progress" | "done" | "skipped";
export type SkipSource = "manual" | "type" | "auto";

export interface StoredStage {
  stage_key: string;
  state: string;
  skip_reason?: string | null;
  skipped_by?: number | null;
  skipped_at?: string | null;
  started_at?: string | null;
  started_by?: number | null;
  done_at?: string | null;
  done_by?: number | null;
  planned_start?: string | null;
  planned_end?: string | null;
}

/** One live contract line, as the loader reads it (phase 2's reno_doc_lines + SO item + product). */
export interface ContractLine {
  soItemId: string;
  category: string | null;
  group: CatalogGroup | null;
  subCategory: string | null;
  stageOverride: string | null;
  supplyByOwner: boolean;
  qty: number;
  room: string | null;
  description: string | null;
  itemCode: string | null;
}

export interface StageView {
  key: StageKey;
  label: string;
  seq: number;
  inType: boolean;
  state: StageState;
  skipSource: SkipSource | null;
  skipReason: string | null;
  skippedBy: number | null;
  skippedAt: string | null;
  startedAt: string | null;
  doneAt: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  skippable: boolean;
  /** SO item ids this stage owns after skipped stages handed theirs on. */
  ownedLineIds: string[];
}

export interface DeriveStageInput {
  /** The project type's stage keys; null when the type is unknown (all stages run). */
  typeStageKeys: readonly string[] | null;
  stored: readonly StoredStage[];
  /** Live contract lines; null when there is no renovation SO yet or its lines cannot be read. */
  lines: readonly ContractLine[] | null;
}

export function lineGroup(line: Pick<ContractLine, "group" | "category">): CatalogGroup | null {
  return line.group ?? categoryGroupOf(line.category);
}

/** The stage a line belongs to before any skip moves it. */
export function lineHomeStage(line: Pick<ContractLine, "group" | "category" | "stageOverride">): StageKey | null {
  if (isStageKey(line.stageOverride)) return line.stageOverride;
  const group = lineGroup(line);
  if (group) return defaultStageOf(group);
  return defaultStageOf(line.category);
}

function autoSkipped(key: StageKey, lines: readonly ContractLine[] | null): boolean {
  if (lines === null) return false;
  const rule = AUTO_SKIP_RULE[key];
  if (!rule) return false;
  return !lines.some((l) => {
    const g = lineGroup(l);
    return g !== null && rule.includes(g);
  });
}

function normState(s: string | null | undefined): StageState {
  return s === "in_progress" || s === "done" || s === "skipped" ? s : "not_started";
}

export function deriveStageViews(input: DeriveStageInput): StageView[] {
  const storedBy = new Map<string, StoredStage>();
  for (const s of input.stored) storedBy.set(s.stage_key, s);
  const typeKeys = input.typeStageKeys ? new Set(input.typeStageKeys) : null;

  const views: StageView[] = RENO_STAGES.map((key) => {
    const st = storedBy.get(key);
    const unskippable = UNSKIPPABLE.includes(key);
    const inType = typeKeys ? typeKeys.has(key) || unskippable : true;
    const storedState = normState(st?.state);
    let state: StageState = storedState;
    let skipSource: SkipSource | null = null;
    if (!unskippable) {
      if (storedState === "skipped") skipSource = "manual";
      else if (!inType) skipSource = "type";
      else if (autoSkipped(key, input.lines)) skipSource = "auto";
    }
    if (skipSource) state = "skipped";
    else if (storedState === "skipped") state = "not_started";
    return {
      key,
      label: STAGE_LABEL[key],
      seq: stageSeq(key),
      inType,
      state,
      skipSource,
      skipReason: skipSource === "manual" ? (st?.skip_reason ?? null) : null,
      skippedBy: skipSource === "manual" ? (st?.skipped_by ?? null) : null,
      skippedAt: skipSource === "manual" ? (st?.skipped_at ?? null) : null,
      startedAt: st?.started_at ?? null,
      doneAt: st?.done_at ?? null,
      plannedStart: st?.planned_start ?? null,
      plannedEnd: st?.planned_end ?? null,
      skippable: !unskippable,
      ownedLineIds: [],
    };
  });

  for (const line of input.lines ?? []) {
    const home = lineHomeStage(line);
    if (!home) continue;
    const owner = nextNonSkipped(views, home);
    if (owner) views[stageSeq(owner)]!.ownedLineIds.push(line.soItemId);
  }
  return views;
}

/** `from` itself when it is not skipped, else the first later stage that is not. */
export function nextNonSkipped(views: readonly StageView[], from: StageKey): StageKey | null {
  for (let i = stageSeq(from); i < views.length; i++) {
    if (views[i]!.state !== "skipped") return views[i]!.key;
  }
  return null;
}

/** The first stage that is neither done nor skipped; 'closed' once everything is. */
export function currentStage(views: readonly StageView[]): StageKey {
  for (const v of views) {
    if (v.state !== "done" && v.state !== "skipped") return v.key;
  }
  return "closed";
}

export type StageSkipRefusal = "unskippable" | "reason_required" | "already_done" | "unknown_stage";

/** Whether a person may skip this stage by hand. */
export function manualSkipRefusal(view: StageView | undefined, reason: string | null | undefined): StageSkipRefusal | null {
  if (!view) return "unknown_stage";
  if (!view.skippable) return "unskippable";
  if (String(reason ?? "").trim().length < 3) return "reason_required";
  if (view.state === "done") return "already_done";
  return null;
}
