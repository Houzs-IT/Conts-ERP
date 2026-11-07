/* Beta Timeline, the order of work (owner, 7 Nov 2026): one project's document chain reads in the order it happens,
   quotation, SO, PO, Production Start, Production Complete, GR, DO, invoice, payment, VO, with each document once.
   Pure rules, tested on fixed data; the route reads the rows. */

import type { TimelineEntry } from "./timeline";

const mytDay = (iso: string): string => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 10);

/** A stored status or method as words: "RENO_CONFIRMED" is "Confirmed", "PARTIALLY_PAID" is "Partially paid". */
export function statusWords(status: unknown): string | null {
  if (status == null || status === "") return null;
  const t = String(status).replace(/^RENO_/i, "").replace(/_/g, " ").trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}

/** Earlier steps first: a complete order, its GR and its DO are saved in the same minute and must still read in order. */
const CHAIN: ReadonlyArray<readonly [RegExp, number]> = [
  [/^quotation:/, 1], [/^so:/, 2], [/^po:/, 3], [/^prod:.*:start$/, 4], [/^prod:.*:done$/, 5],
  [/^gr(site)?:/, 6], [/^(do|deliv):/, 7], [/^si:/, 8], [/^pay:/, 9], [/^vo:/, 10],
];
const stepOf = (id: string): number => CHAIN.find(([re]) => re.test(id))?.[1] ?? 0;

const newestFirst = (a: TimelineEntry, b: TimelineEntry): number => {
  const [x, y] = [a.at.slice(0, 16), b.at.slice(0, 16)];
  if (x !== y) return x < y ? 1 : -1;
  return stepOf(b.id) - stepOf(a.id) || (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
};

/* A DO made and delivered the same day, or a GR made and received on site, is one event: the fuller line stays. */
function oneEventPerDocument(entries: readonly TimelineEntry[]): TimelineEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const madeBy = new Map<string, string>();
  for (const e of entries) {
    const m = /^(deliv|grsite):(.+)$/.exec(e.id);
    const made = m ? byId.get(`${m[1] === "deliv" ? "do" : "gr"}:${m[2]}`) : undefined;
    if (made && mytDay(made.at) === mytDay(e.at)) madeBy.set(e.id, made.id);
  }
  const dropped = new Set(madeBy.values());
  return entries.filter((e) => !dropped.has(e.id)).map((e) => {
    const made = madeBy.get(e.id);
    return made && !e.by ? { ...e, by: byId.get(made)?.by ?? null } : e;
  });
}

/** The project's entries, each document once, newest first and in chain order inside one minute. */
export function chainTimeline(entries: readonly TimelineEntry[]): TimelineEntry[] {
  return oneEventPerDocument(entries).sort(newestFirst);
}
