/* What each VO line changed, in one word (owner, 3 Nov 2026): Added, Removed, SKU changed, Qty changed, Price changed,
   Options changed, each with its before and after. A VO only adds and omits (renovation-vo.ts quickVo), so a line edited
   on the contract arrives as an omit and an add of the same room: pairOmitAdd joins them back into the one change it
   was. Pure: the reads live in betaVoPo.ts and so-amendments.ts. */

export type ChangeKind = "added" | "removed" | "sku" | "qty" | "price" | "options" | "remark" | "changed";

export interface ChangeFacet { kind: ChangeKind; from: string | null; to: string | null }

/** One side of a change: the line before the VO (old) or after it (new). */
export interface ChangeSide {
  itemCode: string | null;
  description: string;
  room: string | null;
  qty: number | null;
  unitPriceSen: number | null;
  /** The line's options (colour, divan, ...); null when not known, which never reads as a change. */
  variants: Record<string, unknown> | null;
  remark?: string | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function asObject(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string" && v.trim()) {
    try { const o = JSON.parse(v); return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null; } catch { return null; }
  }
  return null;
}

/* One label per option, in the order a person reads a spec. Several keys carry the same option (colourId, colourLabel,
   fabricCode): the first present one speaks for it and the rest are skipped. Ids are last resorts. */
const OPTION_KEYS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["Colour", ["colourLabel", "colorCode", "fabricCode", "colourId"]],
  ["Fabric", ["fabricLabel", "fabricId"]],
  ["Size", ["size"]],
  ["Divan", ["divanHeight"]],
  ["Leg", ["legHeight"]],
  ["Gap", ["gap"]],
  ["Total height", ["totalHeight"]],
  ["Seat", ["seatHeight"]],
];
const KNOWN = new Set(OPTION_KEYS.flatMap(([, ks]) => ks));

const optText = (v: unknown): string => (v === null || v === undefined || v === "" ? "none" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** The options that differ, as [label, before, after]. */
export function optionDiffs(before: Record<string, unknown> | null, after: Record<string, unknown> | null): Array<[string, string, string]> {
  if (!before || !after) return [];
  const out: Array<[string, string, string]> = [];
  const pick = (o: Record<string, unknown>, ks: readonly string[]): unknown => {
    for (const k of ks) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
    return null;
  };
  for (const [label, ks] of OPTION_KEYS) {
    const a = optText(pick(before, ks));
    const b = optText(pick(after, ks));
    if (a !== b) out.push([label, a, b]);
  }
  const rest = new Set([...Object.keys(before), ...Object.keys(after)].filter((k) => !KNOWN.has(k) && k !== "remark"));
  for (const k of rest) {
    const a = optText(before[k]);
    const b = optText(after[k]);
    if (a !== b) out.push([k, a, b]);
  }
  return out;
}

/** What moved between the two sides. The first facet is the headline; a line can move several things at once. */
export function describeChange(old: ChangeSide | null, neu: ChangeSide | null): ChangeFacet[] {
  if (!old && !neu) return [];
  if (!old) return [{ kind: "added", from: null, to: null }];
  if (!neu) return [{ kind: "removed", from: null, to: null }];
  const out: ChangeFacet[] = [];
  if (old.itemCode && neu.itemCode && old.itemCode !== neu.itemCode) out.push({ kind: "sku", from: old.itemCode, to: neu.itemCode });
  if (old.qty !== null && neu.qty !== null && old.qty !== neu.qty) out.push({ kind: "qty", from: String(old.qty), to: String(neu.qty) });
  if (old.unitPriceSen !== null && neu.unitPriceSen !== null && old.unitPriceSen !== neu.unitPriceSen) {
    out.push({ kind: "price", from: String(old.unitPriceSen), to: String(neu.unitPriceSen) });
  }
  /* Another SKU brings its own options: comparing a sofa's seat height with a bed's divan says nothing. */
  if (!out.some((f) => f.kind === "sku")) {
    const d = optionDiffs(old.variants, neu.variants);
    if (d.length) out.push({ kind: "options", from: d.map(([l, a]) => `${l} ${a}`).join(", "), to: d.map(([l, , b]) => `${l} ${b}`).join(", ") });
  }
  if (neu.remark != null && neu.remark.trim() !== String(old.remark ?? "").trim()) {
    out.push({ kind: "remark", from: String(old.remark ?? "").trim() || null, to: neu.remark.trim() || null });
  }
  return out.length ? out : [{ kind: "changed", from: null, to: null }];
}

const RM = (sen: string | null): string => {
  const n = num(sen);
  return n === null ? "-" : `RM ${(n / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const KIND_WORD: Readonly<Record<ChangeKind, string>> = {
  added: "Added", removed: "Removed", sku: "SKU changed", qty: "Qty changed", price: "Price changed",
  options: "Options changed", remark: "Remark changed", changed: "Changed",
};

export const changeWord = (k: ChangeKind): string => KIND_WORD[k];

/** "Qty changed 1 → 2". A price shows its figures only to a role that sees money. */
export function facetLabel(f: ChangeFacet, money = true): string {
  const word = KIND_WORD[f.kind];
  if (f.kind === "added" || f.kind === "removed" || f.kind === "changed") return word;
  if (f.kind === "price") return money ? `${word} ${RM(f.from)} → ${RM(f.to)}` : word;
  if (f.kind === "remark") return f.to ? `${word}: ${f.to}` : "Remark cleared";
  return `${word} ${f.from ?? "none"} → ${f.to ?? "none"}`;
}

/* ---------- pairing ---------- */

export interface PairItem<T> {
  side: "omit" | "add";
  /** The VO section (or none): an omit and its add sit in the same one. */
  group: string;
  room: string | null;
  itemCode: string | null;
  payload: T;
}

export interface Paired<T> { omit: T | null; add: T | null }

const roomKey = (r: string | null): string => (r ?? "").trim().toLowerCase();

/** Join each omit with the add that replaces it, keeping the list's order (a pair stands where its omit stood):
    1. same section, room and SKU (a qty, price or options change);
    2. the add right after the omit in the same section (quickVo writes a replaced line as omit, then add);
    3. the only omit and the only add left in a section and a named room (a SKU change recorded in another order;
       with no room there is nothing to say the two belong together).
    Everything left stays on its own: Removed or Added. `adjacent: false` skips step 2 for lists whose order means
    nothing (so_amendment_lines). */
export function pairOmitAdd<T>(items: ReadonlyArray<PairItem<T>>, opts: { adjacent?: boolean } = {}): Array<Paired<T>> {
  const mate = new Map<number, number>();
  const taken = new Set<number>();
  /* A side whose room is not known (a draft add has no SO line yet) does not stop a match. */
  const same = (a: PairItem<T>, b: PairItem<T>): boolean => a.group === b.group && (!roomKey(a.room) || !roomKey(b.room) || roomKey(a.room) === roomKey(b.room));
  const join = (o: number, a: number) => { mate.set(o, a); taken.add(o); taken.add(a); };
  items.forEach((o, i) => {
    if (o.side !== "omit" || taken.has(i)) return;
    const j = items.findIndex((a, k) => !taken.has(k) && a.side === "add" && same(o, a) && !!o.itemCode && a.itemCode === o.itemCode);
    if (j >= 0) join(i, j);
  });
  if (opts.adjacent !== false) items.forEach((o, i) => {
    if (o.side !== "omit" || taken.has(i)) return;
    const a = items[i + 1];
    if (a && !taken.has(i + 1) && a.side === "add" && a.group === o.group && (!roomKey(o.room) || !roomKey(a.room) || roomKey(o.room) === roomKey(a.room))) join(i, i + 1);
  });
  const left = new Map<string, { omits: number[]; adds: number[] }>();
  items.forEach((x, i) => {
    if (taken.has(i) || !roomKey(x.room)) return;
    const k = `${x.group}\u0000${roomKey(x.room)}`;
    const g = left.get(k) ?? { omits: [], adds: [] };
    (x.side === "omit" ? g.omits : g.adds).push(i);
    left.set(k, g);
  });
  for (const g of left.values()) if (g.omits.length === 1 && g.adds.length === 1) join(g.omits[0], g.adds[0]);
  const addOf = new Set(mate.values());
  const out: Array<Paired<T>> = [];
  items.forEach((x, i) => {
    if (x.side === "omit") out.push({ omit: x.payload, add: mate.has(i) ? items[mate.get(i)!].payload : null });
    else if (!addOf.has(i)) out.push({ omit: null, add: x.payload });
  });
  return out;
}

/* ---------- the VO's one-line topic ---------- */

/* Titles the system writes for a VO raised by an in-place edit. A title staff typed is used as it stands. */
const AUTO_TITLE = /^(changed on the |options of .+ changed|variation order |vo-)/i;

export function isAutoTitle(title: string | null | undefined): boolean {
  const t = (title ?? "").trim();
  return !t || AUTO_TITLE.test(t);
}

export interface TopicLine { description: string; itemCode: string | null; facets: ChangeFacet[] }

const short = (f: ChangeFacet, money: boolean): string => {
  if (f.kind === "added" || f.kind === "removed") return KIND_WORD[f.kind].toLowerCase();
  if (f.kind === "price" && !money) return "price changed";
  if (f.kind === "remark") return "remark changed";
  if (f.kind === "changed") return "changed";
  const word = f.kind === "sku" ? "SKU" : f.kind === "qty" ? "qty" : f.kind === "price" ? "price" : "options";
  const [a, b] = f.kind === "price" ? [RM(f.from), RM(f.to)] : [f.from ?? "none", f.to ?? "none"];
  return `${word} ${a} → ${b}`;
};

/** "2 changed, 1 added: SOFA 3S qty 1 → 2; HILTON BEDFRAME options Divan 4" → 5"". A title staff typed wins. */
export function voTopic(title: string | null | undefined, lines: readonly TopicLine[], money = true, maxDetails = 3): string {
  if (!isAutoTitle(title)) return String(title).trim();
  if (lines.length === 0) return (title ?? "").trim() || "No line changes";
  let changed = 0;
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    const k = l.facets[0]?.kind ?? "changed";
    if (k === "added") added += 1; else if (k === "removed") removed += 1; else changed += 1;
  }
  const counts = [changed && `${changed} changed`, added && `${added} added`, removed && `${removed} removed`].filter(Boolean).join(", ");
  const details = lines.slice(0, maxDetails).map((l) => {
    const name = (l.description || l.itemCode || "Line").trim();
    return `${name} ${l.facets.map((f) => short(f, money)).join(", ")}`;
  });
  const more = lines.length > maxDetails ? `; +${lines.length - maxDetails} more` : "";
  return `${counts}: ${details.join("; ")}${more}`;
}

/* ---------- SO amendment lines ---------- */

/** One so_amendment_lines row with the SO line it names (cur_*), as read for the VO tab and the amendment page. */
export interface AmendmentChangeInput {
  id: string;
  change_type: string;
  new_item_code: string | null;
  new_qty: number | null;
  new_unit_price_sen: number | null;
  new_variants?: unknown;
  new_remark?: string | null;
  old_snapshot: unknown;
  cur_item_code?: string | null;
  cur_description?: string | null;
  cur_qty?: number | null;
  cur_unit_price_sen?: number | null;
  /** The SO line's options as they stood when the VO was recorded (the caller corrects later edits). */
  cur_variants?: unknown;
  cur_room?: string | null;
}

export interface AmendmentChange {
  /** The amendment lines this change stands for: one, or a REMOVE and its ADD. */
  lineIds: string[];
  old: ChangeSide | null;
  neu: ChangeSide | null;
  facets: ChangeFacet[];
}

function oldSideOf(l: AmendmentChangeInput): ChangeSide {
  const o = asObject(l.old_snapshot) ?? {};
  const room = typeof o.room === "string" && o.room.trim() ? o.room.trim() : (typeof o.location === "string" && o.location.trim() ? o.location.trim() : l.cur_room ?? null);
  return {
    itemCode: ((o.item_code ?? o.itemCode ?? l.cur_item_code) as string | null) ?? null,
    description: String(o.description ?? l.cur_description ?? "").trim(),
    room,
    qty: num(o.qty) ?? num(l.cur_qty),
    unitPriceSen: num(o.unit_price_sen ?? o.unitPriceSen),
    variants: asObject(o.variants),
    remark: (o.remark as string | null | undefined) ?? null,
  };
}

function newSideOf(l: AmendmentChangeInput, old: ChangeSide | null): ChangeSide {
  const type = String(l.change_type ?? "").toUpperCase();
  /* A MODIFY carries only what it moves; an empty variants object is "options untouched", never "options cleared". */
  const sent = asObject(l.new_variants);
  const variants = sent && Object.keys(sent).length ? sent : type === "ADD" ? asObject(l.cur_variants) : old?.variants ?? null;
  return {
    itemCode: l.new_item_code ?? old?.itemCode ?? l.cur_item_code ?? null,
    description: String(l.cur_description ?? old?.description ?? "").trim(),
    room: l.cur_room ?? old?.room ?? null,
    qty: num(l.new_qty) ?? (type === "ADD" ? num(l.cur_qty) : old?.qty ?? null),
    unitPriceSen: num(l.new_unit_price_sen) ?? (type === "ADD" ? num(l.cur_unit_price_sen) : old?.unitPriceSen ?? null),
    variants,
    remark: type === "ADD" ? null : l.new_remark ?? null,
  };
}

/** An amendment's lines as changes: a REMOVE and an ADD of the same room become one SKU, qty, price or options change. */
export function amendmentChanges(lines: readonly AmendmentChangeInput[]): AmendmentChange[] {
  const items: Array<PairItem<AmendmentChangeInput>> = [];
  const single: AmendmentChangeInput[] = [];
  for (const l of lines) {
    const t = String(l.change_type ?? "").toUpperCase();
    if (t === "REMOVE") { const o = oldSideOf(l); items.push({ side: "omit", group: "", room: o.room, itemCode: o.itemCode, payload: l }); }
    else if (t === "ADD") items.push({ side: "add", group: "", room: l.cur_room ?? null, itemCode: l.new_item_code ?? l.cur_item_code ?? null, payload: l });
    else single.push(l);
  }
  const out: AmendmentChange[] = [];
  for (const l of single) {
    const old = oldSideOf(l);
    const neu = newSideOf(l, old);
    out.push({ lineIds: [l.id], old, neu, facets: describeChange(old, neu) });
  }
  for (const p of pairOmitAdd(items, { adjacent: false })) {
    const old = p.omit ? oldSideOf(p.omit) : null;
    const neu = p.add ? newSideOf(p.add, null) : null;
    out.push({ lineIds: [p.omit?.id, p.add?.id].filter((x): x is string => !!x), old, neu, facets: describeChange(old, neu) });
  }
  return out;
}

/* ---------- options as they stood when the VO was recorded ---------- */

export interface OptionEdit { note: string | null; field_changes: unknown; at: string }

/** The options an SO audit UPDATE moved a line from; undefined when it did not move them or knew no before. */
export function variantsFromAudit(fc: unknown): Record<string, unknown> | undefined {
  let list: unknown = fc;
  if (typeof fc === "string") { try { list = JSON.parse(fc); } catch { list = []; } }
  if (!Array.isArray(list)) return undefined;
  const hit = (list as Array<{ field?: string; from?: unknown }>).find((c) => c?.field === "variants");
  return hit ? asObject(hit.from) ?? undefined : undefined;
}

const when = (s: string): number => Date.parse(/^\d{4}-\d\d-\d\d \d/.test(s) ? s.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00") : s);

/** A VO-added SO line's options when the VO was recorded: its options now, unless an option edit of that SKU on the
    order came later (the audit note reads "<SKU>: options ..."), whose "from" is what the line held until then.
    VO-01 on TC-SO-2611-001 doubled a sofa; its colour was edited on the new line an hour later, which is not the VO. */
export function variantsAsOf(itemCode: string | null, current: unknown, edits: readonly OptionEdit[], since: string | null): unknown {
  const t = since ? when(since) : NaN;
  if (!itemCode || Number.isNaN(t)) return current;
  const later = edits.find((e) => when(e.at) > t && (e.note ?? "").startsWith(`${itemCode}:`) && variantsFromAudit(e.field_changes) !== undefined);
  return later ? variantsFromAudit(later.field_changes) : current;
}
