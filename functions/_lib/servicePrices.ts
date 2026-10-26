import { type Env, all, run, fail, nowIso, mytToday } from './db';
import { hasColumn } from './auth';

/** Service prices (owner, 17 Oct 2026; migration 0127): one item list for cleaning and maintenance, each item with an
 *  owner price (what the owner is charged) and an internal cost (what it costs us), effective-dated. A job takes the
 *  prices in force on its own day, so a change applies from its date and earlier jobs keep theirs. */
export const DOMAINS = ['cleaning', 'maintenance'] as const;
export const CATEGORIES: Record<(typeof DOMAINS)[number], readonly string[]> = {
  cleaning: ['turnover', 'deep_clean', 'light_clean', 'laundry', 'other'],
  maintenance: ['aircon', 'plumbing', 'electrical', 'furniture', 'appliance', 'cleaning', 'general', 'other'],
};
export const UOMS = ['job', 'unit', 'hour', 'visit', 'set'] as const;
export const CLEAN_TYPES = ['turnover', 'deep_clean', 'light_clean'] as const;
/** The price grid's rows for an item priced by layout. Every unit falls in one (cleaningPrices.layoutKey). */
export const GRID_LAYOUTS = ['studio', '1_bedroom', '2_bedroom', '3_bedroom', '4_plus_bedroom', 'duplex', 'dual_key', 'penthouse', 'other'] as const;
export const isDayStr = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
/** The Malaysian day of an instant (or a day already). */
export const mytDay = (at: string | null | undefined) => {
  if (!at) return mytToday();
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  const t = Date.parse(at);
  return Number.isNaN(t) ? mytToday() : new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
};

export const hasServicePrices = (env: Env) => hasColumn(env, 'service_items', 'domain').catch(() => false);

export interface ServiceItem { id: string; code: string; name: string; domain: string; category: string; unit_label: string; clean_kind: string | null; by_layout: number; active: number }
export interface PriceRow { id: string; item_id: string; layout: string; effective_from: string; owner_price: number | null; internal_cost: number | null }
export interface Amounts { owner: number | null; internal: number | null; source: 'unit' | 'table' | null; itemId: string | null; effectiveFrom: string | null }
const NONE: Amounts = { owner: null, internal: null, source: null, itemId: null, effectiveFrom: null };

/** The row in force on `day` among rows sorted newest first. */
export const inForce = (rows: PriceRow[] | undefined, day: string) => rows?.find(r => r.effective_from <= day) ?? null;

export interface Book {
  items: ServiceItem[];
  /** The active cleaning item a clean of this type is priced from. */
  itemForKind(kind: string): ServiceItem | null;
  /** The owner price and internal cost of an item for a unit (its own figures win, field by field), on a day. */
  amounts(itemId: string | null, unitId: string | null, layout: string, day: string): Amounts;
}

/** Everything needed to price jobs on these units: the list and every dated price is small, so it is read once. */
export async function serviceBook(env: Env, unitIds: string[]): Promise<Book> {
  const [items, prices] = await Promise.all([
    all<ServiceItem>(env, 'SELECT id, code, name, domain, category, unit_label, clean_kind, by_layout, active FROM service_items'),
    all<PriceRow>(env, 'SELECT id, item_id, layout, effective_from, owner_price, internal_cost FROM service_item_prices ORDER BY effective_from DESC'),
  ]);
  const ids = [...new Set(unitIds.filter(Boolean))];
  const own = ids.length ? await all<{ unit_id: string; item_id: string; owner_price: number | null; internal_cost: number | null }>(env,
    'SELECT unit_id, item_id, owner_price, internal_cost FROM unit_service_prices WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', JSON.stringify(ids)) : [];
  const byKey = new Map<string, PriceRow[]>();
  for (const p of prices) byKey.set(`${p.item_id}:${p.layout}`, [...(byKey.get(`${p.item_id}:${p.layout}`) ?? []), p]);
  const ownAt = new Map(own.map(o => [`${o.unit_id}:${o.item_id}`, o]));
  const byId = new Map(items.map(i => [i.id, i]));
  return {
    items,
    itemForKind: kind => items.find(i => i.domain === 'cleaning' && i.clean_kind === kind && i.active) ?? null,
    amounts(itemId, unitId, layout, day) {
      const item = itemId ? byId.get(itemId) : null;
      if (!item) return NONE;
      const row = inForce(byKey.get(`${item.id}:${item.by_layout ? layout : 'all'}`), day) ?? (item.by_layout ? inForce(byKey.get(`${item.id}:all`), day) : null);
      const o = unitId ? ownAt.get(`${unitId}:${item.id}`) : undefined;
      const owner = o?.owner_price ?? row?.owner_price ?? null, internal = o?.internal_cost ?? row?.internal_cost ?? null;
      const source = o && (o.owner_price != null || o.internal_cost != null) ? 'unit' : owner != null || internal != null ? 'table' : null;
      return { owner: owner == null ? null : Number(owner), internal: internal == null ? null : Number(internal), source, itemId: item.id, effectiveFrom: row?.effective_from ?? null };
    },
  };
}

/** The catalog's preset price is the item's owner price from today in Service prices (0127). */
export async function setPriceToday(env: Env, itemId: string, ownerPrice: number, userId: string) {
  await run(env, `INSERT INTO service_item_prices (id, item_id, layout, effective_from, owner_price, internal_cost, note, created_at, created_by)
    VALUES (?, ?, 'all', ?, ?, (SELECT p.internal_cost FROM service_item_prices p WHERE p.item_id = ? AND p.layout = 'all' AND p.effective_from <= ? ORDER BY p.effective_from DESC LIMIT 1), 'Set from the maintenance catalog', ?, ?)
    ON CONFLICT (item_id, layout, effective_from) DO UPDATE SET owner_price = excluded.owner_price`,
    crypto.randomUUID(), itemId, mytToday(), ownerPrice, itemId, mytToday(), nowIso(), userId);
}

/** Who adds and edits items (not prices): the same set that kept the maintenance catalog. Prices are management's. */
export const ITEM_WRITERS = ['management']; // everyone else follows the area's level (mayWork / maySee / mayRun)

/** Every dated price row by item, newest first. */
export async function loadPrices(env: Env): Promise<Map<string, (PriceRow & { note: string | null; created_at: string; created_by_name: string | null })[]>> {
  const rows = await all<any>(env, `SELECT p.*, u.full_name AS created_by_name FROM service_item_prices p LEFT JOIN users u ON u.id = p.created_by
    ORDER BY p.effective_from DESC, p.layout`);
  const out = new Map<string, any[]>();
  for (const r of rows) out.set(r.item_id, [...(out.get(r.item_id) ?? []), r]);
  return out;
}

export const layoutsOf = (byLayout: unknown) => (byLayout ? [...GRID_LAYOUTS] : ['all']);
type Cell = { ownerPrice: number | null; internalCost: number | null; effectiveFrom: string | null };

/** An item as the screen shows it: its prices in force today per layout, and the next scheduled change. */
export function itemView(i: any, rows: PriceRow[], today: string) {
  const layouts = layoutsOf(i.by_layout);
  const current: Record<string, Cell> = {};
  for (const l of layouts) {
    const r = inForce(rows.filter(x => x.layout === l), today);
    current[l] = { ownerPrice: r?.owner_price ?? null, internalCost: r?.internal_cost ?? null, effectiveFrom: r?.effective_from ?? null };
  }
  const future = rows.filter(r => r.effective_from > today && layouts.includes(r.layout)).map(r => r.effective_from).sort()[0] ?? null;
  return {
    id: i.id, code: i.code, name: i.name, domain: i.domain, category: i.category, uom: i.unit_label, cleanKind: i.clean_kind ?? null,
    byLayout: !!i.by_layout, active: !!i.active, notes: i.notes ?? '', trackStock: !!i.track_stock, stockOnHand: Number(i.stock_on_hand ?? 0),
    current, next: future ? { effectiveFrom: future, rows: Object.fromEntries(layouts.map(l => {
      const r = inForce(rows.filter(x => x.layout === l), future);
      return [l, { ownerPrice: r?.owner_price ?? null, internalCost: r?.internal_cost ?? null, effectiveFrom: r?.effective_from ?? null }];
    })) } : null,
  };
}

const fieldFail = (message: string, field: string, hint: string) => fail('VALIDATION', message, 422, { [field]: hint });

/** Checks an item's fields (all of them on create, the ones sent on edit). Returns the failure, or null. */
export function checkItem(b: any, create: boolean): Response | null {
  if (!b || typeof b !== 'object') return fieldFail('Send the item.', 'name', 'Enter the item.');
  if (create || b.code !== undefined) if (typeof b.code !== 'string' || !b.code.trim()) return fieldFail('Give the item a short code.', 'code', 'Enter a code.');
  if (create || b.name !== undefined) if (typeof b.name !== 'string' || !b.name.trim()) return fieldFail('Enter the item name.', 'name', 'Enter the name.');
  if (create || b.domain !== undefined) if (!(DOMAINS as readonly string[]).includes(b.domain)) return fieldFail('Pick Cleaning or Maintenance.', 'domain', 'Pick one.');
  if (create || b.category !== undefined) {
    const list = CATEGORIES[(b.domain ?? 'maintenance') as (typeof DOMAINS)[number]] ?? [];
    if (!list.includes(b.category) && !(b.domain === undefined && Object.values(CATEGORIES).some(l => l.includes(b.category)))) return fieldFail('Pick a sub-category.', 'category', 'Pick a sub-category.');
  }
  if (b.uom !== undefined && !(UOMS as readonly string[]).includes(b.uom)) return fieldFail('Pick the unit of measure.', 'uom', 'Pick one.');
  if (b.cleanKind != null && (!(CLEAN_TYPES as readonly string[]).includes(b.cleanKind) || (b.domain !== undefined && b.domain !== 'cleaning'))) return fieldFail('Only a cleaning item is a clean type\'s price.', 'cleanKind', 'Pick a clean type.');
  if (b.byLayout !== undefined && typeof b.byLayout !== 'boolean') return fieldFail('Say whether it is priced by layout.', 'byLayout', 'Yes or no.');
  if (b.active !== undefined && typeof b.active !== 'boolean') return fieldFail('Say whether the item is active.', 'active', 'Yes or no.');
  return null;
}

export type PriceSet = { effectiveFrom: string; note: string | null; rows: { layout: string; ownerPrice: number | null; internalCost: number | null }[] };
const amountOk = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100_000_000);

/** A dated price change: { effectiveFrom, note?, rows: [{ layout, ownerPrice, internalCost }] }, sen or null. */
export function checkPriceRows(p: any, byLayout: boolean): PriceSet | { error: Response } {
  if (!isDayStr(p?.effectiveFrom)) return { error: fieldFail('Pick the date the prices apply from.', 'effectiveFrom', 'Pick a date.') };
  if (!Array.isArray(p.rows) || !p.rows.length || p.rows.length > 20) return { error: fieldFail('Enter the prices.', 'rows', 'Enter the prices.') };
  const allowed = layoutsOf(byLayout);
  const seen = new Set<string>();
  for (const r of p.rows) {
    const layout = r?.layout ?? 'all';
    if (!allowed.includes(layout) || seen.has(layout)) return { error: fieldFail(byLayout ? 'Unknown layout in the price grid.' : 'This item has one price, not a grid.', 'rows', 'Check the layouts.') };
    seen.add(layout);
    if (!amountOk(r.ownerPrice ?? null) || !amountOk(r.internalCost ?? null)) return { error: fieldFail('Prices are RM 0.00 or more, or empty.', 'rows', 'Check the amounts.') };
  }
  return { effectiveFrom: p.effectiveFrom, note: typeof p.note === 'string' && p.note.trim() ? p.note.trim().slice(0, 300) : null,
    rows: p.rows.map((r: any) => ({ layout: r.layout ?? 'all', ownerPrice: r.ownerPrice ?? null, internalCost: r.internalCost ?? null })) };
}

/** Writes a dated price change (same date again replaces it). Also keeps the old preset price column in step. */
export async function writePrices(env: Env, itemId: string, set: PriceSet, userId: string) {
  await run(env, `INSERT INTO service_item_prices (id, item_id, layout, effective_from, owner_price, internal_cost, note, created_at, created_by)
    SELECT gen_random_uuid()::text, ?, x.layout, ?, x.owner_price, x.internal_cost, ?, ?, ?
    FROM jsonb_to_recordset(?::text::jsonb) AS x(layout text, owner_price int, internal_cost int)
    ON CONFLICT (item_id, layout, effective_from) DO UPDATE SET owner_price = excluded.owner_price, internal_cost = excluded.internal_cost,
      note = excluded.note, created_at = excluded.created_at, created_by = excluded.created_by`,
    itemId, set.effectiveFrom, set.note, nowIso(), userId,
    JSON.stringify(set.rows.map(r => ({ layout: r.layout, owner_price: r.ownerPrice, internal_cost: r.internalCost }))));
  const flat = set.rows.find(r => r.layout === 'all');
  if (flat?.ownerPrice != null && set.effectiveFrom <= mytToday()) await run(env, 'UPDATE service_items SET default_price = ?, updated_at = ? WHERE id = ?', flat.ownerPrice, nowIso(), itemId);
}

/* The spreadsheet (CSV / Excel) the owner fills in: one row per item, or per item and layout for an item priced by layout. */
export const LABEL = {
  domain: { cleaning: 'Cleaning', maintenance: 'Maintenance' } as Record<string, string>,
  category: {
    turnover: 'Basic clean', deep_clean: 'Deep clean', light_clean: 'Light clean', laundry: 'Laundry', aircon: 'Aircon', plumbing: 'Plumbing',
    electrical: 'Electrical', furniture: 'Furniture', appliance: 'Appliance', cleaning: 'Cleaning', general: 'General', other: 'Other',
  } as Record<string, string>,
  layout: {
    all: 'All', studio: 'Studio', '1_bedroom': '1 bedroom', '2_bedroom': '2 bedroom', '3_bedroom': '3 bedroom', '4_plus_bedroom': '4+ bedroom',
    duplex: 'Duplex', dual_key: 'Dual key', penthouse: 'Penthouse', other: 'Other',
  } as Record<string, string>,
  cleanType: { turnover: 'Basic clean', deep_clean: 'Deep clean', light_clean: 'Light clean' } as Record<string, string>,
  uom: { job: 'Job', unit: 'Unit', hour: 'Hour', visit: 'Visit', set: 'Set' } as Record<string, string>,
};
export const SHEET_COLUMNS = ['Code', 'Name', 'Type', 'Sub-category', 'Unit of measure', 'Priced by layout', 'Reservation clean type', 'Layout',
  'Owner price (RM)', 'Internal cost (RM)', 'Margin (RM)', 'Price since', 'Active', 'Notes'] as const;

/** A label or a key back to the key ("Deep clean", "deep_clean", "DEEP CLEAN" -> deep_clean). Blank -> null, unknown -> undefined. */
export function fromLabel(map: Record<string, string>, v: unknown): string | null | undefined {
  const t = String(v ?? '').trim().replace(/^'/, '').toLowerCase();
  if (!t) return null;
  for (const [k, l] of Object.entries(map)) if (k.toLowerCase() === t || l.toLowerCase() === t) return k;
  // "Standard clean" was renamed "Basic clean" (23 Oct 2026); sheets filled in before that still import.
  return t === 'standard clean' && 'turnover' in map ? 'turnover' : undefined;
}
/** "RM 1,200.50", "1200.5", "80" -> sen. Blank -> null. Anything else -> NaN. */
export function senOf(v: unknown): number | null {
  const t = String(v ?? '').trim().replace(/^'/, '').replace(/^RM\s*/i, '').replace(/,/g, '');
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
}
const rmText = (sen: number | null) => (sen == null ? '' : (sen / 100).toFixed(2));
const yesNo = (v: unknown) => {
  const t = String(v ?? '').trim().toLowerCase();
  return t === '' ? null : ['yes', 'y', 'true', '1'].includes(t) ? true : ['no', 'n', 'false', '0'].includes(t) ? false : undefined;
};
const blank = (v: unknown) => v == null || String(v).trim() === '';

/** Export rows for the item list as it stands today. */
export function sheetRows(items: any[], prices: Map<string, PriceRow[]>, today: string): string[][] {
  const out: string[][] = [];
  for (const i of items) {
    const v = itemView(i, prices.get(i.id) ?? [], today);
    for (const l of layoutsOf(i.by_layout)) {
      const c = v.current[l];
      out.push([i.code, i.name, LABEL.domain[i.domain] ?? i.domain, LABEL.category[i.category] ?? i.category, LABEL.uom[i.unit_label] ?? i.unit_label,
        i.by_layout ? 'Yes' : 'No', i.clean_kind ? LABEL.cleanType[i.clean_kind] : '', LABEL.layout[l] ?? l,
        rmText(c.ownerPrice), rmText(c.internalCost), c.ownerPrice != null && c.internalCost != null ? rmText(c.ownerPrice - c.internalCost) : '',
        c.effectiveFrom ?? '', i.active ? 'Yes' : 'No', i.notes ?? '']);
    }
  }
  return out;
}

export interface ImportPlan {
  errors: { line: number; message: string }[];
  creates: { code: string; item: { name: string; domain: string; category: string; uom: string; cleanKind: string | null; byLayout: boolean; active: boolean; notes: string | null }; prices: PriceSet | null }[];
  updates: { id: string; code: string; changes: Record<string, unknown>; before: Record<string, unknown>; row: { name: string; category: string; unit_label: string; clean_kind: string | null; active: number; notes: string | null } }[];
  prices: { id: string; code: string; set: PriceSet }[];
  unchanged: number;
}

/** Works out what an imported sheet changes. Blank cells leave things as they are; a changed price becomes a price
 *  change from `effectiveFrom`. "Margin" and "Price since" are for reading and are ignored. Nothing is written here. */
export function planImport(raw: Record<string, unknown>[], items: any[], prices: Map<string, PriceRow[]>, effectiveFrom: string): ImportPlan {
  const plan: ImportPlan = { errors: [], creates: [], updates: [], prices: [], unchanged: 0 };
  const groups = new Map<string, { line: number; get: (c: string) => unknown }[]>();
  raw.forEach((r, i) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r ?? {})) o[k.trim().toLowerCase()] = v;
    const get = (c: string) => o[c.toLowerCase()];
    const line = Number(o._row) || i + 2;
    const code = String(get('Code') ?? '').trim().replace(/^'/, '');
    if (!code) {
      if (Object.entries(o).some(([k, v]) => k !== '_row' && !blank(v))) plan.errors.push({ line, message: 'The Code is empty.' });
      return;
    }
    const k = code.toLowerCase();
    groups.set(k, [...(groups.get(k) ?? []), { line, get }]);
  });
  const byCode = new Map(items.map(i => [String(i.code).toLowerCase(), i]));
  const kindsTaken = new Map<string, string>(items.filter(i => i.clean_kind && i.active).map(i => [i.clean_kind, String(i.code).toLowerCase()]));
  for (const [k, rows] of groups) {
    const first = rows[0];
    const code = String(first.get('Code')).trim().replace(/^'/, '').slice(0, 40);
    const err = (line: number, message: string) => { plan.errors.push({ line, message: `${code}: ${message}` }); };
    const cur = byCode.get(k);
    const domain = blank(first.get('Type')) ? cur?.domain ?? null : fromLabel(LABEL.domain, first.get('Type'));
    if (!domain) { err(first.line, 'Type must be Cleaning or Maintenance.'); continue; }
    if (cur && domain !== cur.domain) { err(first.line, `Type cannot change (it is ${LABEL.domain[cur.domain]}). Use a new code.`); continue; }
    const cats = CATEGORIES[domain as (typeof DOMAINS)[number]];
    const category = blank(first.get('Sub-category')) ? cur?.category ?? null : fromLabel(LABEL.category, first.get('Sub-category'));
    if (!category || !cats.includes(category)) { err(first.line, `Sub-category must be one of: ${cats.map(c => LABEL.category[c]).join(', ')}.`); continue; }
    const uom = blank(first.get('Unit of measure')) ? cur?.unit_label ?? 'job' : fromLabel(LABEL.uom, first.get('Unit of measure'));
    if (!uom) { err(first.line, `Unit of measure must be one of: ${Object.values(LABEL.uom).join(', ')}.`); continue; }
    const byL = yesNo(first.get('Priced by layout'));
    if (byL === undefined) { err(first.line, 'Priced by layout must be Yes or No.'); continue; }
    if (cur && byL != null && byL !== !!cur.by_layout) { err(first.line, 'Priced by layout cannot change once an item exists. Use a new code.'); continue; }
    const byLayout = cur ? !!cur.by_layout : byL ?? rows.some(r => { const l = fromLabel(LABEL.layout, r.get('Layout')); return !!l && l !== 'all'; });
    const cleanKind = blank(first.get('Reservation clean type')) ? cur?.clean_kind ?? null : fromLabel(LABEL.cleanType, first.get('Reservation clean type'));
    if (cleanKind === undefined || (cleanKind && domain !== 'cleaning')) { err(first.line, 'Reservation clean type is Standard clean, Deep clean or Light clean, on a cleaning item only.'); continue; }
    const act = yesNo(first.get('Active'));
    if (act === undefined) { err(first.line, 'Active must be Yes or No.'); continue; }
    const active = act ?? (cur ? !!cur.active : true);
    if (cleanKind && active && kindsTaken.has(cleanKind) && kindsTaken.get(cleanKind) !== k) { err(first.line, `Another active item is already the ${LABEL.cleanType[cleanKind]} price.`); continue; }
    if (cleanKind && active) kindsTaken.set(cleanKind, k);
    const name = String(first.get('Name') ?? '').trim() || cur?.name || '';
    if (!name) { err(first.line, 'The Name is empty.'); continue; }
    const notes = first.get('Notes') === undefined ? cur?.notes ?? null : String(first.get('Notes') ?? '').trim().slice(0, 500) || null;

    // Prices, one row per layout.
    const allowed = layoutsOf(byLayout), seen = new Set<string>();
    const rowsOut: PriceSet['rows'] = [];
    let bad = false;
    const had = prices.get(cur?.id ?? '') ?? [];
    for (const r of rows) {
      const layout = byLayout ? fromLabel(LABEL.layout, r.get('Layout')) : 'all';
      if (!layout || !allowed.includes(layout)) { err(r.line, byLayout ? `Layout must be one of: ${allowed.map(l => LABEL.layout[l]).join(', ')}.` : 'This item has one price: leave Layout as All.'); bad = true; break; }
      if (seen.has(layout)) { err(r.line, `${LABEL.layout[layout]} is listed twice.`); bad = true; break; }
      seen.add(layout);
      const owner = senOf(r.get('Owner price (RM)')), internal = senOf(r.get('Internal cost (RM)'));
      if (Number.isNaN(owner) || Number.isNaN(internal)) { err(r.line, 'Prices are numbers like 80 or 80.00, or empty.'); bad = true; break; }
      const was = inForce(had.filter(x => x.layout === layout), effectiveFrom);
      const o = owner ?? was?.owner_price ?? null, n = internal ?? was?.internal_cost ?? null;
      if (o !== (was?.owner_price ?? null) || n !== (was?.internal_cost ?? null)) rowsOut.push({ layout, ownerPrice: o, internalCost: n });
    }
    if (bad) continue;
    const set: PriceSet | null = rowsOut.length ? { effectiveFrom, note: 'Imported from a spreadsheet', rows: rowsOut } : null;
    if (!cur) {
      plan.creates.push({ code, prices: set, item: { name: name.slice(0, 120), domain, category, uom, cleanKind, byLayout, active, notes } });
      continue;
    }
    const changes: Record<string, unknown> = {}, before: Record<string, unknown> = {};
    const diff = (key: string, col: string, v: unknown) => { if ((cur[col] ?? null) !== v) { changes[key] = v; before[key] = cur[col] ?? null; } };
    diff('name', 'name', name.slice(0, 120)); diff('category', 'category', category); diff('unit_label', 'unit_label', uom);
    diff('clean_kind', 'clean_kind', cleanKind); diff('active', 'active', active ? 1 : 0); diff('notes', 'notes', notes);
    if (Object.keys(changes).length) plan.updates.push({ id: cur.id, code: cur.code, changes, before,
      row: { name: name.slice(0, 120), category, unit_label: uom, clean_kind: cleanKind, active: active ? 1 : 0, notes } });
    if (set) plan.prices.push({ id: cur.id, code: cur.code, set });
    if (!Object.keys(changes).length && !set) plan.unchanged++;
  }
  return plan;
}

/** Several dated price changes in one statement (an import). Same rules as writePrices. */
export async function writePriceSets(env: Env, sets: { itemId: string; set: PriceSet }[], userId: string) {
  const rows = sets.flatMap(({ itemId, set }) => set.rows.map(r => ({ item_id: itemId, layout: r.layout, effective_from: set.effectiveFrom, owner_price: r.ownerPrice, internal_cost: r.internalCost, note: set.note })));
  if (!rows.length) return;
  await run(env, `INSERT INTO service_item_prices (id, item_id, layout, effective_from, owner_price, internal_cost, note, created_at, created_by)
    SELECT gen_random_uuid()::text, x.item_id, x.layout, x.effective_from, x.owner_price, x.internal_cost, x.note, ?, ?
    FROM jsonb_to_recordset(?::text::jsonb) AS x(item_id text, layout text, effective_from text, owner_price int, internal_cost int, note text)
    ON CONFLICT (item_id, layout, effective_from) DO UPDATE SET owner_price = excluded.owner_price, internal_cost = excluded.internal_cost,
      note = excluded.note, created_at = excluded.created_at, created_by = excluded.created_by`, nowIso(), userId, JSON.stringify(rows));
  const flat = rows.filter(r => r.layout === 'all' && r.owner_price != null && r.effective_from <= mytToday());
  if (flat.length) await run(env, `UPDATE service_items s SET default_price = x.owner_price, updated_at = ? FROM jsonb_to_recordset(?::text::jsonb) AS x(item_id text, owner_price int)
    WHERE s.id = x.item_id`, nowIso(), JSON.stringify(flat.map(r => ({ item_id: r.item_id, owner_price: r.owner_price }))));
}
