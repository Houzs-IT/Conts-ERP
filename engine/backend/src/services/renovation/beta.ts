/* Beta project workspace, bundle A (owner, 23 Oct 2026; routes/renovationBeta.ts). Pure rules: input checks for
   the bodies, the defect repair loop, and the instalment status of the payments strip. No database here. */

import type { BillingView } from "../../scm/lib/renovation-billing";
import { normTrigger } from "./billing";

export type BetaRefusal<T> = { ok: true; value: T } | { ok: false; error: string; message: string };
const no = (error: string, message: string): { ok: false; error: string; message: string } => ({ ok: false, error, message });

export const BETA_TRADES = ["carpenter", "electrician", "plumber", "painter", "plaster", "hacking", "aircon", "tiler", "other"] as const;
export type BetaTrade = (typeof BETA_TRADES)[number];
export const BETA_REMINDER_KINDS = ["client_approval", "client_answer", "defect", "payment"] as const;
export type BetaReminderKind = (typeof BETA_REMINDER_KINDS)[number];

export const DEFECT_DESCRIPTION_MAX = 1000;
export const DEFECT_LOCATION_MAX = 120;
export const BETA_NOTE_MAX = 500;
export const BETA_REMINDER_MAX = 1000;
export const BETA_DEFAULT_3D_DAYS = 10;
export const BETA_DEFAULT_2D_DAYS = 12;

type Json = Record<string, unknown>;
const isTrade = (x: unknown): x is BetaTrade => typeof x === "string" && (BETA_TRADES as readonly string[]).includes(x);
const isReminderKind = (x: unknown): x is BetaReminderKind => typeof x === "string" && (BETA_REMINDER_KINDS as readonly string[]).includes(x);

/** A real calendar day written YYYY-MM-DD (2026-02-31 is refused). */
export function isIsoDay(x: unknown): x is string {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const d = new Date(`${x}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x;
}

const text = (x: unknown, max: number): string | null => {
  if (x == null) return null;
  const s = String(x).trim();
  return s ? s.slice(0, max) : null;
};

/** A photo must be one this project's own uploads wrote (renovation/<id>/...). */
function photoKeyOk(key: string, projectId: number): boolean {
  const prefix = `renovation/${projectId}/`;
  return key.startsWith(prefix) && key.length > prefix.length;
}

export interface DefectReportInput {
  location: string | null;
  description: string;
  trade: BetaTrade | null;
  dueDate: string | null;
  photoKey: string;
}

export function cleanDefectReport(b: Json, projectId: number): BetaRefusal<DefectReportInput> {
  const description = text(b.description, DEFECT_DESCRIPTION_MAX);
  if (!description) return no("description_required", "Say what is wrong.");
  const photoKey = typeof b.photoKey === "string" ? b.photoKey.trim() : "";
  if (!photoKey) return no("photo_required", "Add a photo of the problem.");
  if (!photoKeyOk(photoKey, projectId)) return no("invalid_photo_key", "That photo does not belong to this project.");
  if (b.trade != null && b.trade !== "" && !isTrade(b.trade)) return no("trade_invalid", "Pick who fixes it from the list.");
  if (b.dueDate != null && b.dueDate !== "" && !isIsoDay(b.dueDate)) return no("date_invalid", "Give the fix-by date as YYYY-MM-DD.");
  return {
    ok: true,
    value: {
      location: text(b.location, DEFECT_LOCATION_MAX),
      description,
      trade: isTrade(b.trade) ? b.trade : null,
      dueDate: typeof b.dueDate === "string" && b.dueDate !== "" ? b.dueDate : null,
      photoKey,
    },
  };
}

export function cleanDefectFixed(b: Json, projectId: number): BetaRefusal<{ afterPhotoKey: string | null }> {
  if (b.afterPhotoKey == null || b.afterPhotoKey === "") return { ok: true, value: { afterPhotoKey: null } };
  if (typeof b.afterPhotoKey !== "string" || !photoKeyOk(b.afterPhotoKey.trim(), projectId)) {
    return no("invalid_photo_key", "That photo does not belong to this project.");
  }
  return { ok: true, value: { afterPhotoKey: b.afterPhotoKey.trim() } };
}

export function cleanDefectRedo(b: Json): BetaRefusal<{ note: string | null }> {
  if (b.note != null && typeof b.note !== "string") return no("note_invalid", "The note must be text.");
  return { ok: true, value: { note: text(b.note, BETA_NOTE_MAX) } };
}

/** open = still to fix, fixed = marked fixed and waiting for the check, closed = checked and done. */
export type DefectState = "open" | "fixed" | "closed";
export interface DefectFlags { fixedAt: unknown; closedAt: unknown }
export type DefectMove = "fixed" | "redo" | "close";

export function defectState({ fixedAt, closedAt }: DefectFlags): DefectState {
  if (closedAt != null) return "closed";
  return fixedAt != null ? "fixed" : "open";
}

/** null when the move is allowed, else the 409 answer. */
export function defectMoveRefusal(move: DefectMove, flags: DefectFlags): { error: string; message: string } | null {
  const state = defectState(flags);
  if (state === "closed") return { error: "defect_closed", message: "This problem is already closed." };
  if (move === "fixed" && state === "fixed") return { error: "already_fixed", message: "This problem is already marked fixed." };
  if (move === "redo" && state !== "fixed") return { error: "not_fixed", message: "Only a problem marked fixed can be sent back." };
  return null;
}

export interface DesignSentInput { sentOn: string; dueOn: string }

export function cleanDesignSent(b: Json): BetaRefusal<DesignSentInput> {
  if (!isIsoDay(b.sentOn)) return no("date_invalid", "Give the day it was sent as YYYY-MM-DD.");
  if (!isIsoDay(b.dueOn)) return no("date_invalid", "Give the day the answer is due as YYYY-MM-DD.");
  if (b.dueOn < b.sentOn) return no("due_before_sent", "The answer cannot be due before the day it was sent.");
  return { ok: true, value: { sentOn: b.sentOn, dueOn: b.dueOn } };
}

export interface DesignApprovalInput { approvedOn: string; approvedByName: string; note: string | null }

export function cleanDesignApproval(b: Json): BetaRefusal<DesignApprovalInput> {
  if (!isIsoDay(b.approvedOn)) return no("date_invalid", "Give the approval day as YYYY-MM-DD.");
  const approvedByName = text(b.approvedByName, 120);
  if (!approvedByName) return no("name_required", "Say who approved it.");
  if (b.note != null && typeof b.note !== "string") return no("note_invalid", "The note must be text.");
  return { ok: true, value: { approvedOn: b.approvedOn, approvedByName, note: text(b.note, BETA_NOTE_MAX) } };
}

export interface BetaSettingsInput { design3dDays: number; design2dDays: number }

export function cleanBetaSettings(b: Json): BetaRefusal<BetaSettingsInput> {
  const days = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= 365;
  if (!days(b.design3dDays) || !days(b.design2dDays)) return no("days_invalid", "Give whole days from 1 to 365.");
  return { ok: true, value: { design3dDays: b.design3dDays, design2dDays: b.design2dDays } };
}

export interface BetaReminderInput { kind: BetaReminderKind; text: string }

export function cleanBetaReminder(b: Json): BetaRefusal<BetaReminderInput> {
  if (!isReminderKind(b.kind)) return no("kind_invalid", "Pick what the reminder is about.");
  const msg = typeof b.text === "string" ? b.text.trim() : "";
  if (!msg) return no("text_required", "The reminder needs its message.");
  if (msg.length > BETA_REMINDER_MAX) return no("text_too_long", `A reminder can be up to ${BETA_REMINDER_MAX} characters.`);
  return { ok: true, value: { kind: b.kind, text: msg } };
}

/** "2D v3", the label the timeline and the Drawings tab use for one design file. */
export function designLabel(kind: string, version: number): string {
  return `${kind === "2d" ? "2D" : kind === "3d" ? "3D" : "File"} v${version}`;
}

export type InstalmentStatus = "paid" | "billed" | "not_billed";

/** paid = a bill exists and what was received covers it; billed = a bill exists, not fully paid; not_billed = no bill. */
export function instalmentStatus(bill: { amountSen: number; paidSen: number } | null): InstalmentStatus {
  if (!bill) return "not_billed";
  return bill.paidSen >= bill.amountSen ? "paid" : "billed";
}

export interface BetaInstalment {
  seq: number; label: string; amountSen: number; paidSen: number; status: InstalmentStatus; stageCode: string | null; trigger: string;
}
export type BetaPayments =
  | { state: "hidden" }
  | { state: "none" }
  | { state: "ok"; contractSen: number; receivedSen: number; instalments: BetaInstalment[] };

/** The payments strip from phase 2's billing view (null = no live SO, so nothing to show). */
export function paymentsOf(view: BillingView | null): BetaPayments {
  if (!view) return { state: "none" };
  return {
    state: "ok",
    contractSen: view.revisedContractSen,
    receivedSen: view.receivedSen,
    instalments: view.instalments.map((i): BetaInstalment => {
      const bill = i.bill ? { amountSen: i.bill.amountSen, paidSen: i.bill.kind === "INVOICE" ? i.bill.paidSen : 0 } : null;
      return {
        seq: i.seq,
        label: i.label || `Instalment ${i.seq}`,
        amountSen: bill ? bill.amountSen : i.amountSen,
        paidSen: bill?.paidSen ?? 0,
        status: instalmentStatus(bill),
        stageCode: i.stageCode,
        trigger: normTrigger(i.trigger),
      };
    }),
  };
}
