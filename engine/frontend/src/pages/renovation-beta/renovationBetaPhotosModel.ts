/* Site & photos as one timeline (owner, 24 Oct 2026): every photo and video of the project, newest first to the
   minute, under day headings; inside a day one card per event (one DO's POD, one defect's before / after, one
   upload of progress photos), each with its time and a category chip. Pure rules, tested on fixed data. */

import { fmtDate, fmtDayMonth } from "../../vendor/shared/format";
import type { EmptySources, PhotoCategory, ProjectPhoto } from "./renovationBetaMediaApi";

export type PhotoFilter = "all" | "progress" | "production" | "do" | "gr" | "po" | "measure" | "defect";

export const CATEGORY_CHIP: Readonly<Record<PhotoCategory, string>> = {
  progress: "Progress", production: "Production", do: "DO", gr: "GR", po: "PO", measure: "Measure", defect: "Defect",
};

/** The filter chips in the owner's order; Production and PO only where the project has such a document or photo. */
export function photoFilters(photos: readonly ProjectPhoto[], empty: EmptySources): PhotoFilter[] {
  const has = (c: "production" | "po"): boolean => empty[c].length > 0 || photos.some((p) => p.category === c);
  return ["all", "progress", ...(has("production") ? ["production" as const] : []), "do", "gr", ...(has("po") ? ["po" as const] : []), "measure", "defect"];
}

const SOURCE_NAME: Readonly<Record<keyof EmptySources, string>> = { production: "Production orders", do: "DOs", gr: "GRs", po: "POs" };
const SHOWN_NOS = 3;

/** One short line per source with documents that hold no photo: "DOs: TC-DO-2611-003, TC-DO-2611-004 and 2 more". */
export function emptySourceLines(empty: EmptySources, filter: PhotoFilter): string[] {
  return (Object.keys(SOURCE_NAME) as Array<keyof EmptySources>)
    .filter((k) => (filter === "all" || filter === k) && empty[k].length > 0)
    .map((k) => {
      const more = empty[k].length - SHOWN_NOS;
      return `${SOURCE_NAME[k]}: ${empty[k].slice(0, SHOWN_NOS).join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
    });
}

const WHERE_FROM: Readonly<Record<PhotoFilter, string>> = {
  all: "Progress photos, Production Order photos, PODs, goods receipts, the site measure and defects all land here by themselves.",
  progress: "No progress photos yet. Add the site team's photos with Add photos.",
  production: "No production photos yet. Photos taken on a Production Order land here by themselves, day by day.",
  do: "No delivery photos yet. A POD taken on the DO lands here by itself.",
  gr: "No receipt photos yet. Photos taken on a goods receipt land here by themselves.",
  po: "No PO photos yet. A photo added on a PO lands here by itself.",
  measure: "No site measure photos yet. Photos on a site measure record land here by themselves.",
  defect: "No defect photos yet. Before and after photos of a defect land here by themselves.",
};

/** What the page says when the filter shows nothing. */
export function emptyMessage(filter: PhotoFilter, area: string, anyPhotos: boolean): string {
  if (area) return `No ${filter === "all" ? "" : `${CATEGORY_CHIP[filter]} `}photos are tagged ${area}.`;
  return anyPhotos || filter !== "all" ? WHERE_FROM[filter] : `No photos on this project yet. ${WHERE_FROM.all}`;
}

export function countBy(photos: readonly ProjectPhoto[]): Record<PhotoFilter, number> {
  const out: Record<PhotoFilter, number> = { all: photos.filter((p) => !p.repeat).length, progress: 0, production: 0, do: 0, gr: 0, po: 0, measure: 0, defect: 0 };
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
  return photos.filter((p) => (filter === "all" ? !p.repeat : p.category === filter) && (!area || (p.area != null && same(p.area, area))));
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

/** "Today · 24-10", "Yesterday · 23-10", "21-10", "03-12-2025". */
export function dayTitle(day: string, today: string): string {
  const y = Number(day.slice(0, 4));
  const short = fmtDayMonth(day);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (day === today) return `Today · ${short}`;
  if (day === yesterday) return `Yesterday · ${short}`;
  return String(y) === today.slice(0, 4) ? short : fmtDate(day);
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

/** Days newest first; in a day, every photo of one source document or defect (its group key) is one card, wherever it
    falls in the day, so a defect's before and after or a DO's several PODs no longer make a card each. A card sits at
    its newest photo's time and cards keep newest first. The list must already be newest first (the server sorts it).
    Undated photos come last, under "No date". */
export function photoTimeline(photos: readonly ProjectPhoto[]): PhotoDay[] {
  const days: PhotoDay[] = [];
  const cardOf = new Map<string, PhotoCard>();
  for (const p of photos) {
    const day = p.at ? mytDayOf(p.at) : null;
    let g = days.find((d) => d.day === day);
    if (!g) { g = { day, cards: [] }; days.push(g); }
    const k = `${day ?? ""}|${p.group.key}`;
    const card = cardOf.get(k);
    if (card) { card.items.push(p); continue; }
    const fresh: PhotoCard = { key: p.group.key, at: p.at, category: p.category, title: p.group.title, label: null, items: [p] };
    cardOf.set(k, fresh);
    g.cards.push(fresh);
  }
  for (const d of days) {
    for (const c of d.cards) {
      // A defect reads before -> after, whichever was uploaded last; the sort is stable, so time order stays within each.
      if (c.category === "defect") c.items.sort((a, b) => Number(a.label === "After") - Number(b.label === "After"));
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

/** The card's top line beside its category chip: "3:42 pm · POD · 2 photos"; the title goes on the line under it. */
export function cardMeta(c: PhotoCard): string {
  return [clockOf(c.at), c.label, mediaCount(c.items)].filter(Boolean).join(" · ");
}
