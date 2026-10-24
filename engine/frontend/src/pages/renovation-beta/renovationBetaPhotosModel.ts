/* Site & photos as one timeline (owner, 24 Oct 2026): every photo and video of the project, newest first to the
   minute, under day headings; inside a day one card per event (one DO's POD, one defect's before / after, one
   upload of progress photos), each with its time and a category chip. Pure rules, tested on fixed data. */

import type { PhotoCategory, ProjectPhoto } from "./renovationBetaMediaApi";

export type PhotoFilter = "all" | "progress" | "do" | "gr" | "po" | "measure" | "defect";

export const CATEGORY_CHIP: Readonly<Record<PhotoCategory, string>> = {
  progress: "Progress", do: "DO", gr: "GR", po: "PO", measure: "Measure", defect: "Defect",
};

/** The filter chips in the owner's order; PO only when there is a PO photo. */
export function photoFilters(photos: readonly ProjectPhoto[]): PhotoFilter[] {
  const base: PhotoFilter[] = ["all", "progress", "do", "gr", "measure", "defect"];
  return photos.some((p) => p.category === "po") ? [...base.slice(0, 4), "po", ...base.slice(4)] : base;
}

export function countBy(photos: readonly ProjectPhoto[]): Record<PhotoFilter, number> {
  const out: Record<PhotoFilter, number> = { all: photos.length, progress: 0, do: 0, gr: 0, po: 0, measure: 0, defect: 0 };
  for (const p of photos) out[p.category]++;
  return out;
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The areas a photo is tagged with, in the sales order's order, then any other. */
export function photoAreas(soAreas: readonly string[], photos: readonly ProjectPhoto[]): string[] {
  const named: string[] = [];
  for (const p of photos) if (p.area && !named.some((x) => same(x, p.area as string))) named.push(p.area);
  return [...soAreas.filter((a) => named.some((x) => same(x, a))), ...named.filter((a) => !soAreas.some((x) => same(x, a)))];
}

export function filterPhotos(photos: readonly ProjectPhoto[], filter: PhotoFilter, area: string): ProjectPhoto[] {
  return photos.filter((p) => (filter === "all" || p.category === filter) && (!area || (p.area != null && same(p.area, area))));
}

/** The Malaysian day of an ISO time. */
export const mytDayOf = (iso: string): string => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 10);

/** "3:42 pm" in Malaysian time; null when there is no time. */
export function clockOf(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + 8 * 3600e3);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Today · 24 Oct", "Yesterday · 23 Oct", "21 Oct", "3 Dec 2025". */
export function dayTitle(day: string, today: string): string {
  const [y, mo, d] = day.split("-").map(Number);
  const short = `${d} ${MONTHS.at(mo - 1) ?? ""}`;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (day === today) return `Today · ${short}`;
  if (day === yesterday) return `Yesterday · ${short}`;
  return String(y) === today.slice(0, 4) ? short : `${short} ${y}`;
}

export interface PhotoCard {
  key: string;
  at: string | null;
  category: PhotoCategory;
  title: string;
  /** "POD", "Before / After", a site step ... */
  label: string | null;
  items: ProjectPhoto[];
}

export interface PhotoDay { day: string | null; cards: PhotoCard[] }

/** Days newest first; in a day, photos that follow each other with the same event become one card. The list must
    already be newest first (the server sorts it). Undated photos come last, under "No date". */
export function photoTimeline(photos: readonly ProjectPhoto[]): PhotoDay[] {
  const days: PhotoDay[] = [];
  for (const p of photos) {
    const day = p.at ? mytDayOf(p.at) : null;
    let g = days.at(-1);
    if (!g || g.day !== day) { g = { day, cards: [] }; days.push(g); }
    const last = g.cards.at(-1);
    if (last && last.key === p.group.key) {
      last.items.push(p);
      continue;
    }
    g.cards.push({ key: p.group.key, at: p.at, category: p.category, title: p.group.title, label: null, items: [p] });
  }
  for (const d of days) {
    for (const c of d.cards) {
      const labels = [...new Set(c.items.map((i) => i.label).filter((x): x is string => !!x))];
      c.label = c.category === "progress" ? null : labels.join(" / ") || null;
    }
  }
  return days;
}

/** "2 photos", "1 video", "2 photos, 1 video". */
export function mediaCount(items: ReadonlyArray<Pick<ProjectPhoto, "kind">>): string {
  const photos = items.filter((i) => i.kind === "image").length;
  const videos = items.filter((i) => i.kind === "video").length;
  const files = items.length - photos - videos;
  const part = (n: number, w: string): string | null => (n ? `${n} ${w}${n === 1 ? "" : "s"}` : null);
  return [part(photos, "photo"), part(videos, "video"), part(files, "file")].filter(Boolean).join(", ") || "0 photos";
}

/** The card's one line: "3:42 pm · DO TC-DO-2610-003 · POD · 2 photos". */
export function cardLine(c: PhotoCard): string {
  return [clockOf(c.at), c.title, c.label, mediaCount(c.items)].filter(Boolean).join(" · ");
}
