/* The renovation project Timeline (owner, 15 Oct 2026): wire types, the note types and the filter chips.
   Shapes mirror engine/backend/src/services/renovation/timeline.ts. The look follows the service case
   timeline (pages/ServiceCases.tsx). */

import { api } from "../../../api/client";

export type TimelineNoteType = "customer" | "design" | "supplier" | "site" | "sales";
export type TimelineCategory = "system" | TimelineNoteType;
export type TimelineFilter = "all" | TimelineCategory;

export interface TimelineEntry {
  id: string;
  at: string;
  dateOnly: boolean;
  category: TimelineCategory;
  title: string | null;
  body: string | null;
  by: string | null;
  noteId?: number;
}

export interface TimelineView { projectId: number; notesReady: boolean; entries: TimelineEntry[] }

/** The labels shown on chips and in the note type picker; rename here. */
export const CATEGORY_LABEL: Readonly<Record<TimelineCategory, string>> = {
  system: "System",
  customer: "Customer",
  design: "Design",
  supplier: "Supplier",
  site: "Site",
  sales: "Sales",
};

export const NOTE_TYPES: readonly TimelineNoteType[] = ["customer", "design", "supplier", "site", "sales"];
export const FILTERS: readonly TimelineFilter[] = ["all", "system", ...NOTE_TYPES];
export const NOTE_MAX = 2000;

/** Chip and ring colours per category, matching the service case timeline where the category exists there. */
export const CHIP_CLASS: Readonly<Record<TimelineCategory, string>> = {
  system: "border border-border-subtle bg-bg text-ink-muted",
  customer: "bg-amber-100 text-amber-800",
  design: "bg-violet-100 text-violet-800",
  supplier: "bg-primary/10 text-primary",
  site: "bg-emerald-100 text-emerald-800",
  sales: "bg-accent-soft text-accent",
};
export const RING_CLASS: Readonly<Record<TimelineCategory, string>> = {
  system: "border-border",
  customer: "border-amber-500",
  design: "border-violet-500",
  supplier: "border-primary",
  site: "border-emerald-500",
  sales: "border-accent",
};

export function filterEntries(entries: readonly TimelineEntry[], f: TimelineFilter): TimelineEntry[] {
  return f === "all" ? [...entries] : entries.filter((e) => e.category === f);
}

export function countByCategory(entries: readonly TimelineEntry[]): Record<TimelineFilter, number> {
  const out = Object.fromEntries(FILTERS.map((f) => [f, 0])) as Record<TimelineFilter, number>;
  for (const e of entries) {
    out.all += 1;
    out[e.category] += 1;
  }
  return out;
}

const R = "/api/renovation";
export const timelineApi = {
  list: (projectId: number) => api.get<TimelineView>(`${R}/${projectId}/timeline`),
  addNote: (projectId: number, b: { type: TimelineNoteType; note: string }) => api.post<{ id: number }>(`${R}/${projectId}/timeline/notes`, b),
  archiveNote: (noteId: number) => api.post<{ ok: true }>(`${R}/timeline/notes/${noteId}/archive`, {}),
};
