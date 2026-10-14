/* Procurement details of a renovation project (owner, 14 Oct 2026): a PO date and a
   delivery date per product category (scm.product_category_groups) and per
   sub-category (scm.product_sub_categories). A sub-category FOLLOWS its category
   unless it is set to its own dates ('own') or to no dates ('none').
   Stored in public.project_procurement_dates (migration 0111); sub_code '' is the
   category row. Pure: input rules and the view; the route reads and writes.

   TODO(auto-PO): these effective dates are meant to drive automatic purchase
   order creation later (raise the POs of a sub-category's SO lines on its
   effective poDate, expected delivery = deliveryDate). Nothing creates a PO from
   them yet. Read `effective` of each sub, never `stored`. */

import type { Refusal } from "./records";

export type ProcMode = "follow" | "own" | "none";
export const PROC_MODES: readonly ProcMode[] = ["follow", "own", "none"];

export interface ProcDates { poDate: string | null; deliveryDate: string | null }
export interface SubSetting extends ProcDates { mode: ProcMode }

export interface ProcRow {
  group_code: string;
  sub_code: string;
  po_date: string | null;
  delivery_date: string | null;
  mode: string;
  updated_at: string | null;
  updated_by: string | null;
}
export interface GroupDefRow { code: string; label: string; sort_order: number }
export interface SubDefRow { group_code: string; code: string; label: string; sort_order: number }

export interface ProcSubView {
  code: string;
  label: string;
  mode: ProcMode;
  stored: ProcDates;
  effective: ProcDates;
  updatedAt: string | null;
  updatedBy: string | null;
}
export interface ProcGroupView extends ProcDates {
  code: string;
  label: string;
  updatedAt: string | null;
  updatedBy: string | null;
  subs: ProcSubView[];
}

const NONE: ProcDates = { poDate: null, deliveryDate: null };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const no = (error: string, message: string) => ({ ok: false as const, error, message });

/** The dates a sub-category actually uses. No stored row = follow. */
export function effectiveSubDates(category: ProcDates, sub: SubSetting | undefined): ProcDates {
  if (!sub || sub.mode === "follow") return { poDate: category.poDate, deliveryDate: category.deliveryDate };
  if (sub.mode === "none") return { ...NONE };
  return { poDate: sub.poDate, deliveryDate: sub.deliveryDate };
}

function realDate(x: unknown): string | null | false {
  if (x == null || x === "") return null;
  const s = String(x);
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : false;
}

export function cleanCategoryDates(b: Record<string, unknown>): Refusal<ProcDates> {
  const po = realDate(b.poDate);
  const del = realDate(b.deliveryDate);
  if (po === false || del === false) return no("date_invalid", "Give the dates as YYYY-MM-DD, or leave them empty.");
  if (po && del && del < po) return no("delivery_before_po", "The delivery date cannot be before the PO date.");
  return { ok: true, value: { poDate: po, deliveryDate: del } };
}

export function cleanSubDates(b: Record<string, unknown>): Refusal<SubSetting> {
  const mode = String(b.mode ?? "");
  if (!(PROC_MODES as readonly string[]).includes(mode)) return no("mode_invalid", "Choose follow the category, own dates or no dates.");
  if (mode !== "own") return { ok: true, value: { mode: mode as ProcMode, ...NONE } };
  const d = cleanCategoryDates(b);
  if (!d.ok) return d;
  return { ok: true, value: { mode: "own", ...d.value } };
}

const asMode = (m: string): ProcMode => ((PROC_MODES as readonly string[]).includes(m) ? (m as ProcMode) : "follow");

export function buildProcurementView(groups: readonly GroupDefRow[], subs: readonly SubDefRow[], rows: readonly ProcRow[]): ProcGroupView[] {
  const byKey = new Map(rows.map((r) => [`${r.group_code}\u0000${r.sub_code}`, r]));
  const order = <T extends { sort_order: number; code: string }>(a: T, b: T) => a.sort_order - b.sort_order || a.code.localeCompare(b.code);
  return [...groups].sort(order).map((g) => {
    const cat = byKey.get(`${g.code}\u0000`);
    const catDates: ProcDates = { poDate: cat?.po_date ?? null, deliveryDate: cat?.delivery_date ?? null };
    return {
      code: g.code,
      label: g.label,
      ...catDates,
      updatedAt: cat?.updated_at ?? null,
      updatedBy: cat?.updated_by ?? null,
      subs: subs.filter((s) => s.group_code === g.code).sort(order).map((s) => {
        const r = byKey.get(`${g.code}\u0000${s.code}`);
        const setting: SubSetting | undefined = r ? { mode: asMode(r.mode), poDate: r.po_date, deliveryDate: r.delivery_date } : undefined;
        return {
          code: s.code,
          label: s.label,
          mode: setting?.mode ?? "follow",
          stored: setting && setting.mode === "own" ? { poDate: setting.poDate, deliveryDate: setting.deliveryDate } : { ...NONE },
          effective: effectiveSubDates(catDates, setting),
          updatedAt: r?.updated_at ?? null,
          updatedBy: r?.updated_by ?? null,
        };
      }),
    };
  });
}
