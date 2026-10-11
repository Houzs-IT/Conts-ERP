import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from './Icon';
import { Button } from './Button';
import { Field } from './Field';
import { DateField, MoneyInput, NumberInput, parseScaled, formatScaled } from './inputs';
import { EmptyState } from './States';
import { StaleBanner, TableSkeleton } from './DataState';
import { PageControls } from './PageControls';
import { useToast } from './Toast';
import { PhoneText } from './PhoneText';
import { Floating, ToolButton, PanelItem, PanelHeading, StatusCell, ChannelCell, PersonCell, channelLabel } from './DataTableParts';
import { useTableViews, type TableLayout, type SavedView } from './DataTableViews';
import { rm, date as fmtDate, dateTime as fmtDateTime, count as fmtCount, plural, phone as fmtPhone } from '../lib/format';
import { downloadTable, type ExportColumn, type ExportCell, type ExportKind } from '../lib/export';
import { cx } from '../lib/design-tokens';
import { statusOf, type AnyTone, type StatusEntity } from '../lib/status';
import { errorMessage } from '../lib/api';
import { useFillHeight } from '../lib/useFillHeight';

/**
 * The one table every list in the app uses (like Houzs's DataTable and Hookka's DataGrid).
 *
 *  - Columns are typed (text, date, money, number, ref, status, channel, person): the type picks the cell face,
 *    the sort (on the raw value: sen, ISO dates), the filter (text contains, pick from a list, date range,
 *    number range) and how the column is exported.
 *  - Sort, column filters and the page live in the URL, so a link or a refresh shows the same list.
 *  - Client mode (default): every row is here; the table sorts, filters and pages them itself.
 *    Server mode (`server`): the page reads the same URL keys into its API call; the table only draws the page
 *    and, for exports, asks `server.fetchAll` for every matching row.
 *  - People choose and order columns, save the whole set-up as a named view (theirs or, for management, the
 *    company's) and pick a default; export the visible columns of the filtered rows as CSV or Excel; tick rows
 *    for bulk actions.
 *  - The previous rows stay on screen while the next ones load. Phones get one card per row.
 */

export type ColumnType = 'text' | 'date' | 'datetime' | 'money' | 'number' | 'ref' | 'status' | 'channel' | 'person' | 'phone';
export type FilterKind = 'text' | 'select' | 'date' | 'number';
export type Raw = string | number | boolean | null | undefined;

export interface FilterSpec {
  kind: FilterKind;
  /** Choices for `select`. Left out in client mode, they are the distinct values in the rows. */
  options?: { value: string; label: string }[];
  /** Server mode: the URL parameter the list endpoint reads for this filter (text and select). */
  param?: string;
  /** Server mode: the two URL parameters of a range (date and number), e.g. ['from', 'to']. */
  params?: [string, string];
  /** Select: allow ticking more than one value (sent comma-separated). Default true in client mode. */
  multi?: boolean;
  /** Label above the inputs, e.g. "Stays that touch these dates". */
  hint?: string;
}

export interface Column<R> {
  key: string;
  label: string;
  type?: ColumnType;
  /** Raw value for sort, filter and export: sen for money, ISO for dates, the code for status and channel. */
  value?: (r: R) => Raw;
  /** Cell face. Defaults to the type's face of `value`. */
  render?: (r: R) => ReactNode;
  /** A muted second line under the cell. */
  sub?: (r: R) => ReactNode;
  /** status columns: the stored value's entity in src/lib/status.ts; words and colour come from there. */
  entity?: StatusEntity;
  /** status columns that are not a stored status (a flag, a computed state): label and tone. The label is also what is
   *  sorted, filtered on and exported. */
  status?: (r: R) => { label: string; tone: AnyTone; outline?: boolean } | null;
  /** What a text filter searches and an export writes, when it differs from `value`. */
  text?: (r: R) => string | null | undefined;
  /** Export cell override (money in sen, dates ISO). */
  exportValue?: (r: R) => ExportCell;
  /** Leave the column out of exports (action buttons, pictures). */
  noExport?: boolean;
  /** How the export writes this column when it differs from the type (e.g. a stay shown as one date range). */
  exportKind?: ExportKind;
  /** Minimum width in px; the column also takes this share of any spare width. */
  width?: number;
  align?: 'left' | 'right' | 'center';
  /** false: no sorting. Server mode sorts only columns with a sortKey (or sortable: true, using `key`). */
  sortable?: boolean;
  sortKey?: string;
  /** false: no filter. Left out: the type's filter in client mode, none in server mode. */
  filter?: FilterSpec | false;
  /** Hidden until someone turns it on in Columns. */
  hidden?: boolean;
  /** false: always shown (the column that names the row). */
  hideable?: boolean;
  /** Header tooltip explaining the figure. */
  title?: string;
  /** Phone card role: title (bold first line), right (top right, e.g. the amount), badge, meta (default), hide. */
  phone?: 'title' | 'right' | 'badge' | 'meta' | 'hide';
}

export interface ServerMode<R> {
  total: number;
  /** Page and size the server answered with (it clamps them). */
  page: number;
  pageSize: number;
  sizes?: number[];
  defaultPageSize?: number;
  /** Every row matching the current filters, for an export. Left out, exports hold the rows on screen. */
  fetchAll?: (onProgress: (got: number, total: number) => void) => Promise<R[]>;
}

export interface DataTableProps<R> {
  /** Names the table for saved views and remembered columns: lowercase, e.g. 'bookings', 'owner.statements'. */
  id: string;
  columns: Column<R>[];
  /** null until the first load. */
  rows: R[] | null;
  rowKey: (r: R) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onRowClick?: (r: R) => void;
  rowTone?: (r: R) => 'gold' | 'warning' | 'critical' | 'muted' | null | undefined;
  /** URL key prefix, for a page with more than one table. */
  urlPrefix?: string;
  /** Client mode: the order before anyone sorts, e.g. 'revenue:desc'. */
  defaultSort?: string;
  /** Client mode rows per page. 0 = no paging. */
  pageSize?: number;
  server?: ServerMode<R>;
  /** Inside the card above the toolbar: tabs, page-level filters. */
  header?: ReactNode;
  /** Left side of the toolbar: search box, page-level filters. */
  toolbar?: ReactNode;
  /** Right side of the toolbar, before Views / Columns / Export. */
  actions?: ReactNode;
  /** Under the toolbar, above the rows (totals, notes). */
  above?: ReactNode;
  /** URL parameters the page owns (tabs, page filters) that a saved view should remember too. */
  viewParams?: string[];
  /** Page-level filters are on (so an empty list reads "nothing matches"). */
  filtered?: boolean;
  onClearFilters?: () => void;
  empty?: { title: string; body?: ReactNode; action?: { label: string; onClick: () => void }; icon?: string };
  /** Tick boxes. A function picks which rows can be ticked. */
  selectable?: boolean | ((r: R) => boolean);
  /** Buttons in the bar that appears once rows are ticked. */
  bulkActions?: (selected: R[], clear: () => void) => ReactNode;
  /** Clearing the ticks when this changes (e.g. the tab). Filters, sort and page already do. */
  selectionKey?: string;
  /** File and sheet name of exports. */
  exportName?: string;
  noun?: [string, string];
  /** Phone card override. */
  renderCard?: (r: R) => ReactNode;
  /** Height cap of the scroll box (the header sticks inside it). Default fills the window below the toolbar. */
  maxHeight?: string;
  /** No card frame, for a table inside a card that already has one. */
  bare?: boolean;
  /** Hide the toolbar entirely (tiny tables inside a profile). */
  noToolbar?: boolean;
  /** false: the page has its own sort menu for phones. */
  phoneSort?: boolean;
  /** No saved views (tiny tables). */
  noViews?: boolean;
  footer?: ReactNode;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const MIN_WIDTH: Record<ColumnType, number> = { text: 160, date: 120, datetime: 150, money: 130, number: 96, ref: 130, status: 130, channel: 130, person: 160, phone: 150 };
const RIGHT: ColumnType[] = ['money', 'number'];

const typeOf = <R,>(c: Column<R>): ColumnType => c.type ?? (c.entity ? 'status' : 'text');
const rawOf = <R,>(c: Column<R>, r: R): Raw => (c.value ? c.value(r) : (r as Record<string, Raw>)[c.key]);
/** A status cell's words and colour: the column's own status(), or its entity's entry for the stored value. */
const statusFor = <R,>(c: Column<R>, r: R) => c.status?.(r) ?? (c.entity ? statusOf(c.entity, String(rawOf(c, r) ?? '')) : null);

/** Text a filter matches and a CSV writes for a column that is not a number or a date. */
function textOf<R>(c: Column<R>, r: R): string {
  if (c.text) return c.text(r) ?? '';
  const t = typeOf(c);
  if (t === 'status') return statusFor(c, r)?.label ?? String(rawOf(c, r) ?? '');
  if (t === 'channel') { const v = rawOf(c, r); return v ? channelLabel(String(v)) : ''; }
  if (t === 'phone') { const v = rawOf(c, r); return v ? fmtPhone(String(v)) : ''; }
  const v = rawOf(c, r);
  return v === null || v === undefined ? '' : String(v);
}

/** What sorts: numbers as numbers, ISO dates as strings (they sort right), labels case-blind. */
function sortValue<R>(c: Column<R>, r: R): string | number | null {
  const t = typeOf(c);
  if (t === 'status' || t === 'channel' || c.text) { const s = textOf(c, r); return s ? s.toLowerCase() : null; }
  const v = rawOf(c, r);
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (t === 'money' || t === 'number') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return String(v).toLowerCase();
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
function compare(a: string | number | null, b: string | number | null) {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // empty values last either way
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

function defaultFilter<R>(c: Column<R>): FilterSpec | null {
  if (c.filter === false) return null;
  if (c.filter) return c.filter;
  const t = typeOf(c);
  if (t === 'date' || t === 'datetime') return { kind: 'date' };
  if (t === 'money' || t === 'number') return { kind: 'number' };
  if (t === 'status' || t === 'channel') return { kind: 'select' };
  return { kind: 'text' };
}

function exportKind(t: ColumnType): ExportKind {
  if (t === 'money') return 'money';
  if (t === 'number') return 'number';
  if (t === 'date') return 'date';
  if (t === 'datetime') return 'datetime';
  return 'text';
}

function exportCell<R>(c: Column<R>, r: R): ExportCell {
  if (c.exportValue) return c.exportValue(r);
  const t = typeOf(c);
  if (t === 'money' || t === 'number') { const v = rawOf(c, r); if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : String(v); }
  if (t === 'date' || t === 'datetime') { const v = rawOf(c, r); return v ? String(v) : null; }
  return textOf(c, r) || null;
}

/** Range values are kept as "from~to" (either side may be empty). */
const splitRange = (v: string): [string, string] => { const i = v.indexOf('~'); return i < 0 ? [v, ''] : [v.slice(0, i), v.slice(i + 1)]; };

function cellFace<R>(c: Column<R>, r: R): ReactNode {
  if (c.render) return c.render(r);
  const t = typeOf(c);
  const v = rawOf(c, r);
  const none = <span className="text-muted-ink">—</span>;
  switch (t) {
    case 'money': return v === null || v === undefined || v === '' ? none : <span className="tabular-nums whitespace-nowrap">{rm(Number(v))}</span>;
    case 'number': return v === null || v === undefined || v === '' ? none : <span className="tabular-nums">{typeof v === 'number' ? fmtCount(v) : String(v)}</span>;
    case 'date': return v ? <span className="whitespace-nowrap">{fmtDate(String(v))}</span> : none;
    case 'datetime': return v ? <span className="whitespace-nowrap">{fmtDateTime(String(v))}</span> : none;
    case 'status': { const s = statusFor(c, r); return s ? <StatusCell label={s.label} tone={s.tone} outline={s.outline} /> : none; }
    case 'channel': return v ? <ChannelCell channel={String(v)} /> : none;
    case 'person': return <PersonCell name={v ? String(v) : null} />;
    case 'phone': return <PhoneText value={v ? String(v) : null} whatsapp={false} />;
    case 'ref': return v ? <span className="font-mono text-meta whitespace-nowrap">{String(v)}</span> : none;
    default: {
      // A column's text() is its words (a label for a stored code); the raw value only when it has none.
      const s = c.text ? textOf(c, r) : v !== null && v !== undefined && v !== '' ? String(v) : '';
      return s ? <span className="block whitespace-nowrap overflow-hidden text-ellipsis" title={s}>{s}</span> : none;
    }
  }
}

function readStored(id: string): TableLayout['columns'] | null {
  try { const v = localStorage.getItem(`dt:${id}:columns`); return v ? JSON.parse(v) : null; } catch { return null; }
}
function writeStored(id: string, cols: TableLayout['columns']) {
  try { localStorage.setItem(`dt:${id}:columns`, JSON.stringify(cols)); } catch { /* private window: columns reset next time */ }
}

/** Saved order and visibility laid over the page's columns: unknown keys dropped, new columns added in place. */
function mergeColumns<R>(defs: Column<R>[], saved: TableLayout['columns'] | null): TableLayout['columns'] {
  const base = defs.map(c => ({ key: c.key, hidden: !!c.hidden && c.hideable !== false }));
  if (!saved?.length) return base;
  const known = new Map(base.map(c => [c.key, c]));
  const out: TableLayout['columns'] = [];
  for (const s of saved) if (known.has(s.key)) { out.push({ key: s.key, hidden: s.hidden && defs.find(d => d.key === s.key)?.hideable !== false }); known.delete(s.key); }
  // Columns added since the layout was saved go after their left neighbour.
  for (const c of base) {
    if (!known.has(c.key)) continue;
    const i = defs.findIndex(d => d.key === c.key);
    const prev = i > 0 ? out.findIndex(o => o.key === defs[i - 1].key) : -1;
    out.splice(prev + 1, 0, c);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

export function DataTable<R>(props: DataTableProps<R>) {
  const {
    id, columns, rows, rowKey, loading, error, onRetry, onRowClick, rowTone, urlPrefix = '', pageSize: clientSize = 50,
    server, header, toolbar, actions, above, viewParams = [], filtered, onClearFilters, empty, selectable, bulkActions, selectionKey,
    exportName, noun = ['row', 'rows'], renderCard, maxHeight, bare, noToolbar, noViews, footer, defaultSort, phoneSort = true,
  } = props;
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const P = urlPrefix;
  const SORT = `${P}sort`, PAGE = `${P}page`, SIZE = `${P}size`;

  /* ---- columns: order and visibility ---- */
  const [layoutCols, setLayoutCols] = useState<TableLayout['columns']>(() => mergeColumns(columns, readStored(id)));
  const colKeys = columns.map(c => c.key).join('|');
  useEffect(() => { setLayoutCols(cur => mergeColumns(columns, cur)); }, [colKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  const setCols = useCallback((next: TableLayout['columns']) => { setLayoutCols(next); writeStored(id, next); }, [id]);
  const byKey = useMemo(() => new Map(columns.map(c => [c.key, c])), [columns]);
  const visible = useMemo(() => layoutCols.filter(l => !l.hidden && byKey.has(l.key)).map(l => byKey.get(l.key)!), [layoutCols, byKey]);

  /* ---- filters in the URL ---- */
  const filterOf = useCallback((c: Column<R>): FilterSpec | null => {
    const f = defaultFilter(c);
    if (!f) return null;
    if (server && !f.param && !f.params) return null; // the server cannot filter what it was not told about
    return f;
  }, [server]);
  const filterKeys = useCallback((c: Column<R>): string[] => {
    const f = filterOf(c);
    if (!f) return [];
    if (server) return f.params ? [...f.params] : f.param ? [f.param] : [];
    return [`${P}f.${c.key}`];
  }, [filterOf, server, P]);
  /** The current value of a column filter: text / comma list / "from~to". */
  const filterValue = useCallback((c: Column<R>): string => {
    const f = filterOf(c);
    if (!f) return '';
    const keys = filterKeys(c);
    if ((f.kind === 'date' || f.kind === 'number') && keys.length === 2) {
      const a = params.get(keys[0]) ?? '', b = params.get(keys[1]) ?? '';
      return a || b ? `${a}~${b}` : '';
    }
    return params.get(keys[0]) ?? '';
  }, [filterOf, filterKeys, params]);
  const setFilter = useCallback((c: Column<R>, value: string) => {
    const f = filterOf(c);
    if (!f) return;
    const keys = filterKeys(c);
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if ((f.kind === 'date' || f.kind === 'number') && keys.length === 2) {
        const [a, b] = splitRange(value);
        if (a) next.set(keys[0], a); else next.delete(keys[0]);
        if (b) next.set(keys[1], b); else next.delete(keys[1]);
      } else if (value) next.set(keys[0], value); else next.delete(keys[0]);
      next.delete(PAGE);
      return next;
    }, { replace: true });
  }, [filterOf, filterKeys, setParams, PAGE]);
  const allFilterKeys = useMemo(() => columns.flatMap(c => filterKeys(c)), [columns, filterKeys]);
  const activeFilters = columns.filter(c => filterValue(c));
  const clearColumnFilters = () => setParams(prev => {
    const next = new URLSearchParams(prev);
    for (const k of allFilterKeys) next.delete(k);
    next.delete(PAGE);
    return next;
  }, { replace: true });

  /* ---- sort ---- */
  const [sortCol, sortDir] = (params.get(SORT) ?? (server ? '' : defaultSort ?? '')).split(':') as [string | undefined, string | undefined];
  const sortKeyOf = (c: Column<R>) => (server ? (c.sortKey ?? (c.sortable ? c.key : null)) : c.sortable === false ? null : c.key);
  const toggleSort = (c: Column<R>) => {
    const k = sortKeyOf(c);
    if (!k) return;
    setParams(prev => {
      const next = new URLSearchParams(prev);
      const [cur, dir] = (next.get(SORT) ?? (server ? '' : defaultSort ?? '')).split(':');
      if (cur === k) { if (dir === 'asc') next.set(SORT, `${k}:desc`); else next.delete(SORT); }
      else next.set(SORT, `${k}:asc`);
      next.delete(PAGE);
      return next;
    }, { replace: true });
  };

  /* ---- client rows: filter, sort, page ---- */
  const all = rows ?? [];
  const processed = useMemo(() => {
    if (server) return all;
    let out = all;
    for (const c of columns) {
      const v = filterValue(c);
      if (!v) continue;
      const f = filterOf(c)!;
      if (f.kind === 'text') { const n = v.toLowerCase(); out = out.filter(r => textOf(c, r).toLowerCase().includes(n)); }
      else if (f.kind === 'select') { const set = new Set(v.split(',')); out = out.filter(r => set.has(String(typeOf(c) === 'status' && !c.value ? textOf(c, r) : rawOf(c, r) ?? ''))); }
      else if (f.kind === 'date') {
        const [a, b] = splitRange(v);
        out = out.filter(r => { const d = String(rawOf(c, r) ?? '').slice(0, 10); return !!d && (!a || d >= a) && (!b || d <= b); });
      } else if (f.kind === 'number') {
        const [a, b] = splitRange(v);
        const scale = typeOf(c) === 'money' ? 100 : 1;
        const lo = a === '' ? null : Number(a) * scale, hi = b === '' ? null : Number(b) * scale;
        out = out.filter(r => { const n = Number(rawOf(c, r)); return Number.isFinite(n) && (lo === null || n >= lo) && (hi === null || n <= hi); });
      }
    }
    const sc = sortCol ? columns.find(c => c.key === sortCol) : null;
    if (sc) {
      const dir = sortDir === 'desc' ? -1 : 1;
      out = out.map(r => ({ r, k: sortValue(sc, r) })).sort((x, y) => {
        if (x.k === null || y.k === null) return compare(x.k, y.k);
        return dir * compare(x.k, y.k);
      }).map(x => x.r);
    }
    return out;
  }, [server, all, columns, filterValue, filterOf, sortCol, sortDir]);

  const defaultSize = server?.defaultPageSize ?? (server ? 50 : clientSize);
  const sizeParam = Number(params.get(SIZE));
  const size = server ? server.pageSize : clientSize === 0 ? 0 : sizeParam > 0 ? sizeParam : clientSize;
  const total = server ? server.total : processed.length;
  const lastPage = size ? Math.max(1, Math.ceil(total / size)) : 1;
  const page = server ? server.page : Math.min(lastPage, Math.max(1, Number(params.get(PAGE)) || 1));
  const shown = server || !size ? processed : processed.slice((page - 1) * size, page * size);
  const goPage = (n: number) => setParams(prev => { const next = new URLSearchParams(prev); if (n <= 1) next.delete(PAGE); else next.set(PAGE, String(n)); return next; }, { replace: true });
  const setSize = (n: number) => setParams(prev => { const next = new URLSearchParams(prev); if (n === defaultSize) next.delete(SIZE); else next.set(SIZE, String(n)); next.delete(PAGE); return next; }, { replace: true });

  /* ---- selection ---- */
  const canPick = useCallback((r: R) => (typeof selectable === 'function' ? selectable(r) : !!selectable), [selectable]);
  const [picked, setPicked] = useState<Map<string, R>>(new Map());
  const resetKey = `${allFilterKeys.map(k => params.get(k) ?? '').join('|')}#${params.get(SORT) ?? ''}#${selectionKey ?? ''}#${viewParams.map(k => params.get(k) ?? '').join('|')}`;
  useEffect(() => { setPicked(new Map()); }, [resetKey]);
  const clearPicked = useCallback(() => setPicked(new Map()), []);
  const pickable = shown.filter(canPick);
  const allOnPage = pickable.length > 0 && pickable.every(r => picked.has(rowKey(r)));
  const someOnPage = pickable.some(r => picked.has(rowKey(r)));
  const togglePage = () => setPicked(cur => {
    const next = new Map(cur);
    if (allOnPage) pickable.forEach(r => next.delete(rowKey(r))); else pickable.forEach(r => next.set(rowKey(r), r));
    return next;
  });
  const toggleOne = (r: R) => setPicked(cur => { const next = new Map(cur); const k = rowKey(r); if (next.has(k)) next.delete(k); else next.set(k, r); return next; });
  // Keep ticked rows current when the list reloads (e.g. after a bulk change).
  useEffect(() => {
    if (!rows || !picked.size) return;
    setPicked(cur => { let changed = false; const next = new Map(cur); for (const r of rows) { const k = rowKey(r); if (next.has(k) && next.get(k) !== r) { next.set(k, r); changed = true; } } return changed ? next : cur; });
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickedRows = [...picked.values()];

  /* ---- export ---- */
  const [exporting, setExporting] = useState<string | null>(null);
  const exportCols = visible.filter(c => !c.noExport);
  async function doExport(format: 'csv' | 'xlsx', only?: R[]) {
    const stem = exportName ?? id.replace(/\./g, '-');
    try {
      let list: R[];
      let capped = false;
      if (only) list = only;
      else if (server?.fetchAll) {
        setExporting('Preparing');
        list = await server.fetchAll((got, of) => setExporting(`${fmtCount(got)} of ${fmtCount(of)}`));
        capped = list.length < server.total;
      } else list = processed;
      const cols: ExportColumn[] = exportCols.map(c => ({ label: c.label || c.key, kind: c.exportKind ?? exportKind(typeOf(c)) }));
      const data = list.map(r => exportCols.map(c => exportCell(c, r)));
      downloadTable(format, stem, exportName ?? stem, cols, data);
      toast({
        tone: capped ? 'warning' : 'success',
        title: `${format === 'csv' ? 'CSV' : 'Excel file'} ready: ${plural(list.length, noun[0], noun[1])}.`,
        body: capped ? `Only the first ${fmtCount(list.length)} of ${fmtCount(server!.total)} fit in one file. Narrow the filters to get the rest.`
          : `${plural(cols.length, 'column')}, as shown on screen${only ? ', ticked rows only' : ''}.`,
      });
    } catch (e) {
      toast({ tone: 'critical', title: 'Export failed.', body: errorMessage(e, 'Try again in a moment.') });
    }
    setExporting(null);
  }

  /* ---- saved views ---- */
  const views = useTableViews(noViews ? null : id);
  const managedKeys = useMemo(() => [...allFilterKeys, ...viewParams], [allFilterKeys, viewParams]);
  const currentLayout = (): TableLayout => {
    const filters: Record<string, string> = {};
    for (const k of managedKeys) { const v = params.get(k); if (v) filters[k] = v; }
    const s = Number(params.get(SIZE));
    return { columns: layoutCols, sort: params.get(SORT) || null, pageSize: !server && s > 0 ? s : server && s > 0 ? s : null, filters };
  };
  const applyLayout = useCallback((l: TableLayout) => {
    setCols(mergeColumns(columns, l.columns));
    setParams(prev => {
      const next = new URLSearchParams(prev);
      for (const k of [...managedKeys, SORT, PAGE, SIZE]) next.delete(k);
      for (const [k, v] of Object.entries(l.filters ?? {})) if (managedKeys.includes(k) && v) next.set(k, v);
      if (l.sort) next.set(SORT, l.sort);
      if (l.pageSize && l.pageSize !== defaultSize) next.set(SIZE, String(l.pageSize));
      return next;
    }, { replace: true });
  }, [columns, managedKeys, setCols, setParams, SORT, PAGE, SIZE, defaultSize]);
  const [activeView, setActiveView] = useState<string | null>(null);
  // The default view opens by itself, once, when the address carries no filters or sort of its own.
  const autoApplied = useRef(false);
  useEffect(() => {
    if (autoApplied.current || !views.data) return;
    autoApplied.current = true;
    const urlHasState = [...managedKeys, SORT].some(k => params.get(k));
    const def = views.data.mine.find(v => v.isDefault) ?? views.data.company.find(v => v.isDefault);
    if (!def || urlHasState) return;
    setActiveView(def.id);
    applyLayout(def.layout);
  }, [views.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = activeView ? [...(views.data?.mine ?? []), ...(views.data?.company ?? [])].find(v => v.id === activeView) ?? null : null;

  /* ---- toolbar popovers ---- */
  const [panel, setPanel] = useState<null | 'columns' | 'views' | 'export' | 'filters' | 'bulkExport' | `col:${string}`>(null);
  const closePanel = useCallback(() => setPanel(null), []);
  const colsBtn = useRef<HTMLButtonElement>(null), viewsBtn = useRef<HTMLButtonElement>(null), exportBtn = useRef<HTMLButtonElement>(null);
  const filtersBtn = useRef<HTMLButtonElement>(null), bulkExportBtn = useRef<HTMLButtonElement>(null);
  const headAnchor = useRef<HTMLElement | null>(null);
  // With no height given, the table's scroll box runs to the bottom of the screen (see useFillHeight).
  const scrollBox = useRef<HTMLDivElement>(null);
  useFillHeight(scrollBox, { enabled: maxHeight === undefined, fallback: maxHeight ?? 'calc(100dvh - 300px)' });
  const [saving, setSaving] = useState<null | { name: string; scope: 'mine' | 'company'; isDefault: boolean }>(null);

  /* ---- states ---- */
  const firstLoad = rows === null;
  const refreshing = !!loading && !firstLoad;
  const anyFilter = !!filtered || activeFilters.length > 0;
  const clearEverything = () => { clearColumnFilters(); onClearFilters?.(); };
  const pickCol = !!selectable;
  const minWidth = visible.reduce((n, c) => n + (c.width ?? MIN_WIDTH[typeOf(c)]), 0) + (pickCol ? 44 : 0);
  const filterable = columns.filter(c => filterOf(c));
  // Phones have no header to click, so the sortable columns are offered in a menu.
  const sortChoices = visible.flatMap(c => {
    const k = sortKeyOf(c);
    if (!k || !c.label) return [];
    const t = typeOf(c);
    const [up, down] = t === 'money' || t === 'number' ? ['low to high', 'high to low'] : t === 'date' || t === 'datetime' ? ['oldest first', 'newest first'] : ['A to Z', 'Z to A'];
    return [{ value: `${k}:asc`, label: `${c.label}, ${up}` }, { value: `${k}:desc`, label: `${c.label}, ${down}` }];
  });

  const emptyView = anyFilter
    ? <EmptyState bare kind="filtered" title={`No ${noun[1]} match these filters.`} action={{ label: 'Clear filters', onClick: clearEverything }} />
    : <EmptyState bare icon={empty?.icon ?? 'Inbox'} title={empty?.title ?? `No ${noun[1]} yet.`} body={empty?.body} action={empty?.action} />;
  const errorView = error && firstLoad
    ? <EmptyState bare icon="CloudOff" title="This list could not load." body={error} action={onRetry ? { label: 'Try again', onClick: onRetry } : undefined} />
    : null;

  const toneClass = (r: R) => {
    const t = rowTone?.(r);
    return t === 'gold' ? 'bg-gold-tint' : t === 'warning' ? 'bg-warning-bg' : t === 'critical' ? 'bg-danger-bg' : t === 'muted' ? 'text-muted-ink' : '';
  };

  const body = (
    <>
      {header}
      {!noToolbar && (
        <div className="flex items-center gap-2 flex-wrap py-[10px] px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line-soft)]">
          {toolbar && <div className="flex items-center gap-2 flex-wrap flex-[1_1_260px] min-w-0 max-md:basis-full">{toolbar}</div>}
          <div className={cx('flex items-center gap-2 flex-wrap max-md:w-full', toolbar ? 'ml-auto max-md:ml-0' : 'ml-auto')}>
            {actions}
            {phoneSort && sortChoices.length > 0 && (
              <label className="md:hidden relative flex items-center flex-[1_1_96px] min-w-0">
                <span className="absolute w-px h-px overflow-hidden [clip:rect(0_0_0_0)]">Sort</span>
                <select value={sortCol ? `${sortCol}:${sortDir === 'desc' ? 'desc' : 'asc'}` : ''} aria-label="Sort"
                  onChange={e => setParams(prev => { const next = new URLSearchParams(prev); if (e.target.value) next.set(SORT, e.target.value); else next.delete(SORT); next.delete(PAGE); return next; }, { replace: true })}
                  className="h-9 w-full min-w-0 pl-3 pr-7 appearance-none rounded-control border border-solid border-line bg-card text-ink font-sans text-copy cursor-pointer">
                  <option value="">Sort</option>
                  {sortChoices.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <span className="absolute right-2 pointer-events-none text-muted-ink flex"><Icon name="ArrowUpDown" size="sm" /></span>
              </label>
            )}
            {filterable.length > 0 && (
              <ToolButton icon="ListFilter" label="Filter" btnRef={filtersBtn} active={panel === 'filters'} count={activeFilters.length}
                onClick={() => setPanel(p => (p === 'filters' ? null : 'filters'))} />
            )}
            {!noViews && (
              <ToolButton icon="Bookmark" label={active ? active.name : 'Views'} btnRef={viewsBtn} active={panel === 'views'}
                onClick={() => setPanel(p => (p === 'views' ? null : 'views'))} title="Saved views" />
            )}
            <ToolButton icon="Columns3" label="Columns" btnRef={colsBtn} active={panel === 'columns'} onClick={() => setPanel(p => (p === 'columns' ? null : 'columns'))} />
            <ToolButton icon={exporting ? 'Loader' : 'Download'} label={exporting ? `Exporting ${exporting}` : 'Export'} btnRef={exportBtn} active={panel === 'export'}
              onClick={() => { if (!exporting) setPanel(p => (p === 'export' ? null : 'export')); }} />
          </div>
        </div>
      )}

      {activeFilters.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap py-2 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line-soft)] bg-page">
          {activeFilters.map(c => (
            <span key={c.key} className="inline-flex items-center gap-1 h-7 pl-[10px] pr-1 rounded-full bg-card border border-solid border-line text-meta max-w-full">
              <span className="text-muted-ink whitespace-nowrap">{c.label}</span>
              <span className="font-medium whitespace-nowrap overflow-hidden text-ellipsis">{describeFilter(c, filterOf(c)!, filterValue(c), rows ?? [])}</span>
              <button type="button" aria-label={`Remove the ${c.label} filter`} onClick={() => setFilter(c, '')}
                className="w-5 h-5 grid place-items-center rounded-full border-none bg-transparent cursor-pointer text-muted-ink hover:bg-muted"><Icon name="X" size="sm" /></button>
            </span>
          ))}
          <button type="button" onClick={clearColumnFilters} className="text-meta text-muted-ink bg-transparent border-none cursor-pointer underline">Clear column filters</button>
        </div>
      )}

      {above}

      {picked.size > 0 && (
        <div role="region" aria-label="Ticked rows" className="flex items-center gap-2 flex-wrap py-2 px-[22px] max-md:px-4 bg-gold-tint [border-bottom:1px_solid_var(--color-line-soft)]">
          <span className="text-copy font-semibold">{plural(picked.size, noun[0], noun[1])} ticked</span>
          {!server && pickable.length < processed.filter(canPick).length && picked.size < processed.filter(canPick).length && (
            <button type="button" className="text-meta bg-transparent border-none cursor-pointer underline text-ink"
              onClick={() => setPicked(new Map(processed.filter(canPick).map(r => [rowKey(r), r])))}>Tick all {fmtCount(processed.filter(canPick).length)} matching</button>
          )}
          <button type="button" className="text-meta bg-transparent border-none cursor-pointer underline text-muted-ink" onClick={clearPicked}>Clear</button>
          <div className="ml-auto flex items-center gap-2 flex-wrap max-md:ml-0">
            <ToolButton icon="Download" label="Export ticked" btnRef={bulkExportBtn} hideLabelOnPhone={false} active={panel === 'bulkExport'}
              onClick={() => setPanel(p => (p === 'bulkExport' ? null : 'bulkExport'))} />
            {bulkActions?.(pickedRows, clearPicked)}
          </div>
        </div>
      )}

      {error && !firstLoad && <div className="px-[22px] pt-3 max-md:px-4"><StaleBanner message={`Showing the last list we have. ${error}`} onRetry={onRetry ?? (() => {})} /></div>}

      {/* Wide screens: the table. Its own scroll box keeps the header in view and scrolls sideways when narrow. */}
      <div className="max-md:hidden relative">
        <BusyLine on={refreshing} />
        <div ref={scrollBox} data-keep-scroll={id} className="overflow-auto" style={{ minHeight: firstLoad || shown.length > 6 ? 240 : undefined }} aria-busy={!!loading}>
          {firstLoad && !error ? <TableSkeleton rows={8} cols={Math.min(7, visible.length || 5)} /> : errorView ?? (
            <table className="w-full border-collapse [table-layout:fixed]" style={{ minWidth }}>
              <colgroup>
                {pickCol && <col style={{ width: 44 }} />}
                {visible.map(c => <col key={c.key} style={{ width: `${((c.width ?? MIN_WIDTH[typeOf(c)]) / (minWidth - (pickCol ? 44 : 0))) * 100}%` }} />)}
              </colgroup>
              <thead>
                <tr>
                  {pickCol && (
                    <th className="sticky top-0 z-[2] bg-muted [border-bottom:1px_solid_var(--color-line)] pl-[22px] pr-1 py-[9px] text-left">
                      <input type="checkbox" aria-label="Tick every row on this page" className="w-4 h-4 cursor-pointer align-middle" checked={allOnPage}
                        ref={el => { if (el) el.indeterminate = !allOnPage && someOnPage; }} onChange={togglePage} disabled={!pickable.length} />
                    </th>
                  )}
                  {visible.map((c, i) => {
                    const k = sortKeyOf(c);
                    const on = !!k && sortCol === k;
                    const right = c.align === 'right' || (!c.align && RIGHT.includes(typeOf(c)));
                    const f = filterOf(c);
                    const fOn = !!filterValue(c);
                    return (
                      <th key={c.key} scope="col" aria-sort={on ? (sortDir === 'desc' ? 'descending' : 'ascending') : undefined}
                        className={cx('sticky top-0 z-[2] bg-muted [border-bottom:1px_solid_var(--color-line)] py-[9px] text-meta font-semibold text-muted-ink',
                          i === 0 && !pickCol ? 'pl-[22px] pr-[7px]' : 'px-[7px]', i === visible.length - 1 && 'pr-[22px]', right ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left')}>
                        <span className={cx('inline-flex items-center gap-[2px] max-w-full', right && 'flex-row-reverse')}>
                          {k ? (
                            <button type="button" onClick={() => toggleSort(c)} title={c.title ?? `Sort by ${c.label}`}
                              className={cx('inline-flex items-center gap-1 min-w-0 font-sans text-meta font-semibold bg-transparent border-none cursor-pointer p-0', on ? 'text-ink' : 'text-muted-ink', right && 'flex-row-reverse')}>
                              <span className={cx('line-clamp-2 leading-[1.25] [overflow-wrap:anywhere]', right ? 'text-right' : 'text-left')}>{c.label}</span>
                              <Icon name={on ? (sortDir === 'desc' ? 'ArrowDown' : 'ArrowUp') : 'ChevronsUpDown'} size="sm" color={on ? 'var(--color-ink)' : 'var(--color-line-strong)'} />
                            </button>
                          ) : <span className="line-clamp-2 leading-[1.25] [overflow-wrap:anywhere]" title={c.title}>{c.label}</span>}
                          {f && (
                            <button type="button" aria-label={`Filter ${c.label}`} title={`Filter ${c.label}`}
                              onClick={e => { headAnchor.current = e.currentTarget; setPanel(p => (p === `col:${c.key}` ? null : `col:${c.key}`)); }}
                              className={cx('w-6 h-6 grid place-items-center shrink-0 rounded-[6px] border-none cursor-pointer', fOn ? 'bg-black text-white' : 'bg-transparent text-[var(--color-line-strong)] hover:text-ink hover:bg-card')}>
                              <Icon name="ListFilter" size="sm" />
                            </button>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className={cx('transition-opacity duration-150', refreshing && 'opacity-55')}>
                {shown.length === 0 ? (
                  <tr><td colSpan={visible.length + (pickCol ? 1 : 0)} className="p-0">{emptyView}</td></tr>
                ) : shown.map(r => {
                  const k = rowKey(r);
                  const on = picked.has(k);
                  return (
                    <tr key={k} onClick={onRowClick ? () => onRowClick(r) : undefined}
                      tabIndex={onRowClick ? 0 : undefined} onKeyDown={onRowClick ? e => { if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(r); } : undefined}
                      className={cx('[border-bottom:1px_solid_var(--color-line-soft)]', onRowClick && 'cursor-pointer hover:bg-page focus-visible:bg-page outline-none', on ? 'bg-gold-tint' : toneClass(r))}>
                      {pickCol && (
                        <td className="pl-[22px] pr-1 py-[9px] align-middle" onClick={e => e.stopPropagation()}>
                          {canPick(r) && <input type="checkbox" aria-label="Tick this row" className="w-4 h-4 cursor-pointer align-middle" checked={on} onChange={() => toggleOne(r)} />}
                        </td>
                      )}
                      {visible.map((c, i) => {
                        const right = c.align === 'right' || (!c.align && RIGHT.includes(typeOf(c)));
                        return (
                          <td key={c.key} className={cx('py-[9px] h-[52px] align-middle text-copy min-w-0 overflow-hidden', i === 0 && !pickCol ? 'pl-[22px] pr-[7px]' : 'px-[7px]',
                            i === visible.length - 1 && 'pr-[22px]', right ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left')}>
                            <div className={cx('flex flex-col gap-px min-w-0', right && 'items-end', c.align === 'center' && 'items-center')}>
                              {cellFace(c, r)}
                              {c.sub && <span className="text-meta text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis max-w-full">{c.sub(r)}</span>}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Phones: one card per row. */}
      <div className="md:hidden relative" aria-busy={!!loading}>
        <BusyLine on={refreshing} />
        {firstLoad && !error ? <TableSkeleton rows={6} cols={2} /> : errorView ?? (shown.length === 0 ? emptyView : (
          <ul className={cx('list-none m-0 p-0 transition-opacity duration-150', refreshing && 'opacity-55')}>
            {pickCol && pickable.length > 0 && (
              <li className="flex items-center gap-3 px-4 py-2 [border-bottom:1px_solid_var(--color-line-soft)] bg-page">
                <input type="checkbox" aria-label="Tick every row on this page" className="w-5 h-5" checked={allOnPage} onChange={togglePage}
                  ref={el => { if (el) el.indeterminate = !allOnPage && someOnPage; }} />
                <span className="text-meta text-muted-ink">Tick this page</span>
              </li>
            )}
            {shown.map(r => {
              const k = rowKey(r);
              const on = picked.has(k);
              return (
                <li key={k} className={cx('flex items-start [border-bottom:1px_solid_var(--color-line-soft)]', on ? 'bg-gold-tint' : toneClass(r))}>
                  {pickCol && (
                    <label className="pl-4 pt-[15px] flex-none">
                      {canPick(r) ? <input type="checkbox" aria-label="Tick this row" className="w-5 h-5" checked={on} onChange={() => toggleOne(r)} /> : <span className="block w-5" />}
                    </label>
                  )}
                  <div role={onRowClick ? 'button' : undefined} tabIndex={onRowClick ? 0 : undefined}
                    onClick={onRowClick ? () => onRowClick(r) : undefined} onKeyDown={onRowClick ? e => { if (e.key === 'Enter') onRowClick(r); } : undefined}
                    className={cx('flex-1 min-w-0 py-3 px-4 text-left', onRowClick && 'cursor-pointer')}>
                    {renderCard ? renderCard(r) : <DefaultCard columns={visible} r={r} />}
                  </div>
                </li>
              );
            })}
          </ul>
        ))}
      </div>

      {size > 0 && total > 0 && (server || total > size) && (
        <PageControls page={page} pageSize={size} total={total} onPage={goPage} onSize={setSize}
          sizes={server?.sizes ?? [25, 50, 100, 200]} noun={total === 1 ? noun[0] : noun[1]} className="[border-top:1px_solid_var(--color-line)] max-md:px-4" />
      )}
      {footer}

      {/* Panels */}
      <Floating anchor={filtersBtn} open={panel === 'filters'} onClose={closePanel} width={340} align="right" label="Filters">
        <div className="p-2 flex flex-col gap-1">
          {filterable.map(c => (
            <details key={c.key} open={!!filterValue(c)} className="rounded-[8px] [&[open]]:bg-page">
              <summary className="list-none flex items-center justify-between gap-2 px-2.5 py-2 cursor-pointer text-copy font-medium">
                <span>{c.label}</span>
                <span className="text-meta text-muted-ink font-normal whitespace-nowrap overflow-hidden text-ellipsis max-w-[55%]">
                  {filterValue(c) ? describeFilter(c, filterOf(c)!, filterValue(c), rows ?? []) : 'Any'}
                </span>
              </summary>
              <div className="px-2 pb-2">
                <FilterEditor col={c} spec={filterOf(c)!} value={filterValue(c)} rows={rows ?? []} onChange={v => setFilter(c, v)} />
              </div>
            </details>
          ))}
          {activeFilters.length > 0 && <div className="px-1 pt-1"><Button size="sm" variant="tertiary" onClick={clearColumnFilters}>Clear column filters</Button></div>}
        </div>
      </Floating>

      {panel?.startsWith('col:') && (() => {
        const c = byKey.get(panel.slice(4));
        if (!c || !filterOf(c)) return null;
        return (
          <Floating anchor={headAnchor} open onClose={closePanel} width={290} label={`Filter ${c.label}`}>
            <div className="p-2.5 flex flex-col gap-2">
              <span className="text-meta font-semibold">{c.label}</span>
              <FilterEditor col={c} spec={filterOf(c)!} value={filterValue(c)} rows={rows ?? []} onChange={v => setFilter(c, v)} onDone={closePanel} autoFocus />
            </div>
          </Floating>
        );
      })()}

      <Floating anchor={colsBtn} open={panel === 'columns'} onClose={closePanel} width={300} align="right" label="Columns">
        <ColumnsPanel defs={byKey} layout={layoutCols} onChange={setCols} onReset={() => setCols(mergeColumns(columns, null))} />
      </Floating>

      <Floating anchor={exportBtn} open={panel === 'export'} onClose={closePanel} width={300} align="right" label="Export">
        <div className="py-1">
          <PanelHeading>{server ? `All ${fmtCount(total)} matching ${noun[1]}` : `${fmtCount(processed.length)} ${processed.length === 1 ? noun[0] : noun[1]}`} · {plural(exportCols.length, 'column')}</PanelHeading>
          <PanelItem icon="FileSpreadsheet" label="Excel (.xlsx)" hint="Money as numbers in RM, dates as dates." onClick={() => { closePanel(); void doExport('xlsx'); }}
            disabledReason={total === 0 ? 'Nothing to export under these filters.' : undefined} />
          <PanelItem icon="FileText" label="CSV" hint="Opens in any spreadsheet. Money columns are in RM." onClick={() => { closePanel(); void doExport('csv'); }}
            disabledReason={total === 0 ? 'Nothing to export under these filters.' : undefined} />
        </div>
      </Floating>

      <Floating anchor={bulkExportBtn} open={panel === 'bulkExport'} onClose={closePanel} width={260} align="right" label="Export ticked rows">
        <div className="py-1">
          <PanelItem icon="FileSpreadsheet" label="Excel (.xlsx)" onClick={() => { closePanel(); void doExport('xlsx', pickedRows); }} />
          <PanelItem icon="FileText" label="CSV" onClick={() => { closePanel(); void doExport('csv', pickedRows); }} />
        </div>
      </Floating>

      {!noViews && (
        <Floating anchor={viewsBtn} open={panel === 'views'} onClose={closePanel} width={320} align="right" label="Saved views">
          <ViewsPanel views={views} activeId={activeView} onApply={v => { setActiveView(v.id); applyLayout(v.layout); closePanel(); }}
            onSaveNew={() => { closePanel(); setSaving({ name: '', scope: 'mine', isDefault: false }); }}
            onUpdate={async v => {
              closePanel();
              const ok = await views.update(v.id, { layout: currentLayout() });
              if (ok) toast({ tone: 'success', title: `"${v.name}" updated.` });
            }}
            onReset={() => { setActiveView(null); applyLayout({ columns: mergeColumns(columns, null), sort: null, pageSize: null, filters: {} }); closePanel(); }} />
        </Floating>
      )}

      {saving && (
        <SaveViewDialog initial={saving} canShare={!!views.data?.canShare} onClose={() => setSaving(null)}
          onSave={async (name, scope, isDefault) => {
            const v = await views.create({ name, scope, isDefault, layout: currentLayout() });
            if (v) { setActiveView(v.id); setSaving(null); toast({ tone: 'success', title: `View "${v.name}" saved.`, body: scope === 'company' ? 'Everyone can now pick it under Views.' : 'Find it under Views on this table.' }); }
          }} />
      )}
    </>
  );

  if (bare) return <div className="relative">{body}</div>;
  return <div className="relative bg-card border border-solid border-line rounded-card [overflow:clip] shrink-0">{body}</div>;
}

function BusyLine({ on }: { on: boolean }) {
  return (
    <div aria-hidden className={cx('absolute left-0 right-0 top-0 h-[2px] z-[3] overflow-hidden pointer-events-none transition-opacity duration-150', on ? 'opacity-100' : 'opacity-0')}>
      <div className="h-full w-1/3 bg-gold [animation:dt-busy_1.1s_ease-in-out_infinite]" />
      <style>{'@keyframes dt-busy{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}'}</style>
    </div>
  );
}

/** A phone card from the columns: title and amount on the first line, the rest as one muted line, status last. */
function DefaultCard<R>({ columns, r }: { columns: Column<R>[]; r: R }) {
  const role = (c: Column<R>, i: number) => c.phone ?? (i === 0 ? 'title' : typeOf(c) === 'status' ? 'badge' : 'meta');
  const title = columns.find((c, i) => role(c, i) === 'title');
  const right = columns.find((c, i) => role(c, i) === 'right') ?? columns.find((c, i) => role(c, i) === 'meta' && typeOf(c) === 'money' && c.phone === undefined);
  const badge = columns.find((c, i) => role(c, i) === 'badge');
  const meta = columns.filter((c, i) => role(c, i) === 'meta' && c !== right && !c.noExport).slice(0, 4);
  return (
    <span className="flex flex-col gap-[3px] min-w-0">
      <span className="flex items-start justify-between gap-2">
        <span className="text-copy font-semibold min-w-0 overflow-hidden">{title ? cellFace(title, r) : null}</span>
        {right && <span className="text-copy font-medium tabular-nums whitespace-nowrap">{cellFace(right, r)}</span>}
      </span>
      {meta.length > 0 && (
        <span className="text-meta text-muted-ink flex flex-wrap gap-x-2 gap-y-px min-w-0">
          {meta.map((c, i) => (
            <span key={c.key} className="inline-flex items-center gap-1 min-w-0 max-w-full">
              {i > 0 && <span aria-hidden>·</span>}
              <span className="sr-only">{c.label}: </span>
              <span className="min-w-0 overflow-hidden [&_*]:!text-meta">{typeOf(c) === 'person' ? (textOf(c, r) || '—') : cellFace(c, r)}</span>
            </span>
          ))}
        </span>
      )}
      {badge && <span className="pt-[2px]">{cellFace(badge, r)}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* filters                                                             */
/* ------------------------------------------------------------------ */

function optionsFor<R>(c: Column<R>, spec: FilterSpec, rows: R[]): { value: string; label: string }[] {
  if (spec.options) return spec.options;
  const seen = new Map<string, string>();
  for (const r of rows) {
    const t = typeOf(c);
    const v = t === 'status' && !c.value ? textOf(c, r) : String(rawOf(c, r) ?? '');
    if (!v || seen.has(v)) continue;
    seen.set(v, t === 'status' ? (statusFor(c, r)?.label ?? v) : t === 'channel' ? channelLabel(v) : textOf(c, r) || v);
  }
  return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => collator.compare(a.label, b.label));
}

function describeFilter<R>(c: Column<R>, spec: FilterSpec, v: string, rows: R[]): string {
  if (spec.kind === 'text') return `contains "${v}"`;
  if (spec.kind === 'select') {
    const opts = optionsFor(c, spec, rows);
    const vals = v.split(',');
    const names = vals.map(x => opts.find(o => o.value === x)?.label ?? x);
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  }
  const [a, b] = splitRange(v);
  if (spec.kind === 'date') {
    const f = (d: string) => fmtDate(d);
    return a && b ? (a === b ? f(a) : `${f(a)} – ${f(b)}`) : a ? `from ${f(a)}` : `until ${f(b)}`;
  }
  const money = typeOf(c) === 'money';
  const f = (n: string) => (money ? rm(Math.round(Number(n) * 100), { cents: false }) : fmtCount(Number(n)));
  return a && b ? `${f(a)} – ${f(b)}` : a ? `at least ${f(a)}` : `at most ${f(b)}`;
}

function FilterEditor<R>({ col, spec, value, rows, onChange, onDone, autoFocus }: {
  col: Column<R>; spec: FilterSpec; value: string; rows: R[]; onChange: (v: string) => void; onDone?: () => void; autoFocus?: boolean;
}) {
  if (spec.kind === 'text') return <TextFilter value={value} onChange={onChange} onDone={onDone} autoFocus={autoFocus} label={col.label} />;
  if (spec.kind === 'select') {
    const opts = optionsFor(col, spec, rows);
    const multi = spec.multi ?? !spec.param;
    const on = new Set(value ? value.split(',') : []);
    return (
      <div className="flex flex-col gap-px max-h-[280px] overflow-y-auto" role="group" aria-label={col.label}>
        {spec.hint && <span className="text-caption text-muted-ink px-1 pb-1">{spec.hint}</span>}
        {!opts.length && <span className="text-meta text-muted-ink px-1 py-2">Nothing to pick from in this list.</span>}
        {opts.map(o => (
          <label key={o.value} className="flex items-center gap-2 px-2 py-[7px] rounded-[8px] cursor-pointer hover:bg-muted text-copy">
            <input type={multi ? 'checkbox' : 'radio'} name={`dt-${col.key}`} checked={on.has(o.value)} className="w-4 h-4 cursor-pointer"
              onChange={() => {
                if (!multi) { onChange(on.has(o.value) ? '' : o.value); onDone?.(); return; }
                const next = new Set(on);
                if (next.has(o.value)) next.delete(o.value); else next.add(o.value);
                onChange([...next].join(','));
              }} />
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{typeOf(col) === 'channel' ? <ChannelCell channel={o.value} /> : o.label}</span>
          </label>
        ))}
        {on.size > 0 && <button type="button" onClick={() => onChange('')} className="self-start mt-1 text-meta text-muted-ink bg-transparent border-none cursor-pointer underline px-2">Any {col.label.toLowerCase()}</button>}
      </div>
    );
  }
  return <RangeFilter kind={spec.kind} money={typeOf(col) === 'money'} hint={spec.hint} value={value} onChange={onChange} onDone={onDone} />;
}

function TextFilter({ value, onChange, onDone, autoFocus, label }: { value: string; onChange: (v: string) => void; onDone?: () => void; autoFocus?: boolean; label: string }) {
  const [text, setText] = useState(value);
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { setText(value); last.current = value; } }, [value]);
  useEffect(() => {
    if (text === last.current) return;
    const t = setTimeout(() => { last.current = text; onChange(text.trim()); }, 300);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input type="search" value={text} autoFocus={autoFocus} placeholder="Contains…" aria-label={`${label} contains`}
      onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { last.current = text; onChange(text.trim()); onDone?.(); } }}
      className="block w-full box-border h-9 px-3 border border-solid border-line rounded-control outline-none bg-card text-ink font-sans text-copy" />
  );
}

/** One end of a range filter. The filter keeps its value as text ("12.30", "2026-10-01") so saved views stay readable. */
function RangeEnd({ kind, money, label, value, onChange, min, error }: { kind: 'date' | 'number'; money: boolean; label: string; value: string; onChange: (v: string) => void; min?: string; error?: string }) {
  if (kind === 'date') return <DateField label={label} value={value} min={min} error={error} onChange={onChange} />;
  if (money) return <MoneyInput label={label} allowNegative error={error} valueSen={parseScaled(value, 2)} onChangeSen={v => onChange(v == null ? '' : formatScaled(v, 2, { grouping: false, fixed: false }))} />;
  return <NumberInput label={label} decimals={3} allowNegative error={error} value={value.trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value)} onChange={v => onChange(v == null ? '' : String(v))} />;
}

function RangeFilter({ kind, money, hint, value, onChange, onDone }: { kind: 'date' | 'number'; money: boolean; hint?: string; value: string; onChange: (v: string) => void; onDone?: () => void }) {
  const [a0, b0] = splitRange(value);
  const [a, setA] = useState(a0), [b, setB] = useState(b0);
  useEffect(() => { setA(a0); setB(b0); }, [a0, b0]);
  const bad = !!(a && b && (kind === 'date' ? b < a : Number(b) < Number(a)));
  const unit = money ? ' (RM)' : '';
  return (
    <form className="flex flex-col gap-2" onSubmit={e => { e.preventDefault(); if (!bad) { onChange(a || b ? `${a}~${b}` : ''); onDone?.(); } }}>
      {hint && <span className="text-caption text-muted-ink">{hint}</span>}
      <div className="grid grid-cols-2 gap-2">
        <RangeEnd kind={kind} money={money} label={kind === 'date' ? 'From' : `At least${unit}`} value={a} onChange={setA} />
        <RangeEnd kind={kind} money={money} label={kind === 'date' ? 'To' : `At most${unit}`} value={b} onChange={setB}
          min={kind === 'date' ? a || undefined : undefined} error={bad ? (kind === 'date' ? 'Before the start.' : 'Below the minimum.') : undefined} />
      </div>
      <div className="flex justify-between gap-2">
        <Button type="button" size="sm" variant="tertiary" onClick={() => { setA(''); setB(''); onChange(''); onDone?.(); }}>Clear</Button>
        <Button type="submit" size="sm" variant="primary" disabled={bad} disabledReason="The end is before the start.">Apply</Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* columns and views panels                                            */
/* ------------------------------------------------------------------ */

function ColumnsPanel<R>({ defs, layout, onChange, onReset }: {
  defs: Map<string, Column<R>>; layout: TableLayout['columns']; onChange: (l: TableLayout['columns']) => void; onReset: () => void;
}) {
  const list = layout.filter(l => defs.has(l.key));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const shownCount = list.filter(l => !l.hidden).length;
  return (
    <div className="py-1">
      <PanelHeading>Show and order columns</PanelHeading>
      <ul className="list-none m-0 px-1 py-0">
        {list.map((l, i) => {
          const c = defs.get(l.key)!;
          const locked = c.hideable === false || (!l.hidden && shownCount === 1);
          return (
            <li key={l.key} className="flex items-center gap-1 rounded-[8px] hover:bg-muted pl-2">
              <label className={cx('flex items-center gap-2 flex-1 min-w-0 py-[7px] text-copy', locked ? 'cursor-default' : 'cursor-pointer')}>
                <input type="checkbox" className="w-4 h-4" checked={!l.hidden} disabled={locked}
                  onChange={() => onChange(list.map(x => (x.key === l.key ? { ...x, hidden: !x.hidden } : x)))} />
                <span className={cx('min-w-0 overflow-hidden text-ellipsis whitespace-nowrap', l.hidden && 'text-muted-ink')}>{c.label || c.key}</span>
              </label>
              <button type="button" aria-label={`Move ${c.label} up`} disabled={i === 0} onClick={() => move(i, -1)}
                className="w-7 h-7 grid place-items-center rounded-[6px] border-none bg-transparent cursor-pointer text-muted-ink hover:text-ink disabled:opacity-30 disabled:cursor-default"><Icon name="ChevronUp" size="sm" /></button>
              <button type="button" aria-label={`Move ${c.label} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}
                className="w-7 h-7 grid place-items-center rounded-[6px] border-none bg-transparent cursor-pointer text-muted-ink hover:text-ink disabled:opacity-30 disabled:cursor-default"><Icon name="ChevronDown" size="sm" /></button>
            </li>
          );
        })}
      </ul>
      <div className="px-2 pt-1 pb-1"><Button size="sm" variant="tertiary" onClick={onReset}>Standard columns</Button></div>
    </div>
  );
}

function ViewsPanel({ views, activeId, onApply, onSaveNew, onUpdate, onReset }: {
  views: ReturnType<typeof useTableViews>; activeId: string | null;
  onApply: (v: SavedView) => void; onSaveNew: () => void; onUpdate: (v: SavedView) => void; onReset: () => void;
}) {
  const d = views.data;
  const canShare = !!d?.canShare;
  const active = activeId ? [...(d?.mine ?? []), ...(d?.company ?? [])].find(v => v.id === activeId) : null;
  const editable = (v: SavedView) => v.scope === 'mine' || canShare;
  const [confirming, setConfirming] = useState<string | null>(null);
  const row = (v: SavedView) => (
    <li key={v.id} className={cx('flex items-center gap-1 rounded-[8px] pl-1', v.id === activeId ? 'bg-muted' : 'hover:bg-muted')}>
      <button type="button" onClick={() => onApply(v)} className="flex-1 min-w-0 flex items-center gap-2 px-2 py-2 bg-transparent border-none cursor-pointer text-left font-sans">
        <Icon name={v.id === activeId ? 'Check' : 'Bookmark'} size="sm" color={v.id === activeId ? 'var(--color-ink)' : 'var(--color-muted-ink)'} />
        <span className="text-copy font-medium min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{v.name}</span>
        {v.isDefault && <span className="text-caption text-[var(--color-gold-ink)] font-semibold whitespace-nowrap">{v.scope === 'company' ? 'Company default' : 'Default'}</span>}
      </button>
      {editable(v) && (
        <>
          <button type="button" title={v.isDefault ? 'Stop opening this view first' : v.scope === 'company' ? 'Open this view first for everyone without a default of their own' : 'Open this view first'}
            aria-label={v.isDefault ? `Stop using ${v.name} as the default` : `Use ${v.name} as the default`}
            onClick={() => void views.update(v.id, { isDefault: !v.isDefault })}
            className="w-7 h-7 grid place-items-center rounded-[6px] border-none bg-transparent cursor-pointer text-muted-ink hover:text-ink">
            <Icon name="Star" size="sm" color={v.isDefault ? 'var(--color-gold)' : undefined} />
          </button>
          {confirming === v.id ? (
            <button type="button" onClick={() => { setConfirming(null); void views.remove(v.id); }}
              title={v.scope === 'company' ? 'It disappears for everyone.' : undefined}
              className="h-7 px-2 rounded-[6px] border-none bg-danger text-white text-meta font-medium cursor-pointer whitespace-nowrap">Delete</button>
          ) : (
            <button type="button" title="Delete this view" aria-label={`Delete ${v.name}`} onClick={() => setConfirming(v.id)}
              className="w-7 h-7 grid place-items-center rounded-[6px] border-none bg-transparent cursor-pointer text-muted-ink hover:text-danger">
              <Icon name="Trash2" size="sm" />
            </button>
          )}
        </>
      )}
    </li>
  );
  return (
    <div className="py-1">
      {!d && views.loading && <div className="px-3 py-3 text-meta text-muted-ink">Loading views…</div>}
      {views.error && !d && <div className="px-3 py-3 text-meta text-danger">{views.error}</div>}
      {d && (
        <>
          <PanelHeading>My views</PanelHeading>
          {d.mine.length ? <ul className="list-none m-0 px-1 py-0">{d.mine.map(row)}</ul> : <div className="px-3 pb-2 text-meta text-muted-ink">None saved yet.</div>}
          <PanelHeading>Company views</PanelHeading>
          {d.company.length ? <ul className="list-none m-0 px-1 py-0">{d.company.map(row)}</ul>
            : <div className="px-3 pb-2 text-meta text-muted-ink">{canShare ? 'None yet. Save one and share it with the company.' : 'Management has not shared any.'}</div>}
        </>
      )}
      <div className="[border-top:1px_solid_var(--color-line-soft)] mt-1 pt-1">
        <PanelItem icon="Plus" label="Save current view…" hint="Columns, sort, filters and rows per page." onClick={onSaveNew} />
        {active && editable(active) && <PanelItem icon="Save" label={`Update "${active.name}"`} hint="With the columns and filters on screen now." onClick={() => onUpdate(active)} />}
        <PanelItem icon="RotateCcw" label="Standard view" hint="Every column, no filters, the usual order." onClick={onReset} />
      </div>
    </div>
  );
}

function SaveViewDialog({ initial, canShare, onClose, onSave }: {
  initial: { name: string; scope: 'mine' | 'company'; isDefault: boolean }; canShare: boolean; onClose: () => void;
  onSave: (name: string, scope: 'mine' | 'company', isDefault: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(initial.name);
  const [scope, setScope] = useState(initial.scope);
  const [isDefault, setIsDefault] = useState(initial.isDefault);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[rgba(20,18,15,0.35)] p-4" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form role="dialog" aria-modal="true" aria-label="Save view" className="w-full max-w-[420px] bg-card rounded-card border border-solid border-line shadow-[var(--shadow-overlay)] flex flex-col"
        onSubmit={async e => { e.preventDefault(); if (!name.trim()) return; setBusy(true); await onSave(name.trim(), scope, isDefault); setBusy(false); }}>
        <div className="px-[22px] pt-[18px] pb-2">
          <h2 className="m-0 text-heading font-semibold">Save view</h2>
          <p className="m-0 mt-1 text-meta text-muted-ink">Keeps the columns, their order, the sort, the filters and rows per page. Saving under an existing name replaces it.</p>
        </div>
        <div className="px-[22px] py-3 flex flex-col gap-3">
          <Field label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Arrivals this week" maxLength={80} autoFocus required />
          {canShare && (
            <div role="radiogroup" aria-label="Who sees it" className="grid grid-cols-2 gap-1 p-1 rounded-control bg-muted">
              {([['mine', 'Only me'], ['company', 'Whole company']] as const).map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={scope === k} onClick={() => setScope(k)}
                  className={cx('h-9 rounded-[8px] border-none font-sans text-meta cursor-pointer', scope === k ? 'bg-card font-semibold text-ink shadow-sm' : 'bg-transparent text-muted-ink')}>{l}</button>
              ))}
            </div>
          )}
          <label className="flex items-start gap-2 text-copy cursor-pointer">
            <input type="checkbox" className="w-4 h-4 mt-[2px]" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
            <span>{scope === 'company' ? 'Company default: opens first for everyone who has no default of their own' : 'Open this view first on this table'}</span>
          </label>
        </div>
        <div className="px-[22px] py-[14px] [border-top:1px_solid_var(--color-line)] flex justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!name.trim()} disabledReason="Give the view a name.">Save view</Button>
        </div>
      </form>
    </div>
  );
}
