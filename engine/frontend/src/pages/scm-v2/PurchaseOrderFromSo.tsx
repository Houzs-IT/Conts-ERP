// ----------------------------------------------------------------------------
// PurchaseOrderFromSo — multi-select SO → PO picker.
//
// Commander 2026-05-28 redesign:
//   - REMOVED the "PO Defaults" card (Expected Delivery + Purchase Location).
//     Those are NOT asked anymore — the server derives each PO line's
//     warehouse from the source SO's Sales Location, and each line's delivery
//     date from the SO line's own delivery date (header expected_at / purchase
//     location are rolled up from the lines server-side).
//   - SWAPPED the bespoke card list for the shared <DataGrid> primitive
//     (same dense ledger look as MfgSalesOrdersList / SalesOrderDetailListing).
//   - ADDED toolbar filters: a date-range filter that targets SO Date /
//     Processing Date / Delivery Date, plus a Category filter.
//
// Project first (owner, 27 Nov 2026): the screen opens on the projects only, all collapsed, and reads a project's
// lines when it is opened (lib/outstanding-so-page.ts, `groups=1`). Search text opens every matching project; the
// other filters only narrow the list. A project's checkbox ticks its lines for one supplier.
//
// Original multi-select + partial-qty behaviour (Commander 2026-05-26) is
// preserved: tick lines, optionally edit the pick qty, hit "Create POs".
// Server groups by main supplier and emits one PO per supplier.
//
// Routing: /scm/purchase-orders/from-so.
// ----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
// HOUZS VENDOR — Link + useSearchParams live on 'react-router-dom' in
// react-router v6 (the version Houzs ships). Only the import specifier changed.
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Save, X, Square, Filter, ChevronRight } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { fmtDateOrDash, fmtMoneySen, fmtQty } from '@2990s/shared';
import { VariantDescription } from '../../vendor/scm/components/VariantDescription';
import {
  outstandingSoPageUrl,
  fetchPickerGroupLines,
  pickerGroupLinesKey,
  usePickerGroups,
  useCreatePosFromSoItems,
  usePurchaseOrderDetail,
  type OutstandingSoItem,
  type OutstandingSoPage,
  type PickerGroup,
  type PickerTopFilters,
} from '../../vendor/scm/lib/suppliers-queries';
import { authedFetch } from '../../vendor/scm/lib/authed-fetch';
import { DataGridCompat, type GridColumn } from '../../components/DataGridCompat';
import { useIdempotencyKey } from '../../lib/idempotency';
import { readScmHandoff, writeScmHandoff } from '../../lib/scmHandoffStorage';
import { ActionResultDialog } from '../../vendor/scm/components/ActionResultDialog';
import { ItemGroupPill } from '../../vendor/scm/lib/category-badges';
import styles from './SalesOrderDetail.module.css';
import { PageHeader } from '../../components/Layout';
import { soRefOfCamelStamp } from '../../lib/so-ref-search';
import { DateField } from "../../vendor/scm/components/DateField";
import { useCategoryOptions, withRowCategories } from '../../vendor/scm/lib/renovation-catalog-queries';
import { SoLineStatusCell, soLineStatusText, useSoLineStatus, type LineStatus } from './SoLineStatus';
import { SearchableSelect } from '../../vendor/scm/components/SearchableSelect';
import { cn } from '../../lib/utils';
import { planGroupTick } from './poPickerGroupTick';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number, currency = 'MYR'): string => fmtMoneySen(centi, currency);

/* DataGrid localStorage layout key. A new key for the per-project grids: the old layouts hold the Project column. */
const STORAGE_KEY = 'po-from-so.project-lines.v1';
const GROUP_LINES_STALE_MS = 30_000;

/* Houzs-style compact pill controls for the toolbar filters — mirrors the
   inputs used on the SO list page so the density matches. */
const FILTER_INPUT: CSSProperties = {
  height: 28,
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 8px',
  fontSize: 'var(--fs-12)',
  background: 'var(--c-paper)',
  color: 'var(--c-ink)',
};

/** Which date field the range filter targets. */
const DATE_FIELD_OPTIONS = [
  { value: 'soDate',       label: 'SO Date' },
  { value: 'processing',   label: 'Processing Date' },
  { value: 'delivery',     label: 'Delivery Date' },
] as const;
type DateField = typeof DATE_FIELD_OPTIONS[number]['value'];

/* Funnel text for a blank category: a funnel value, not a category the server can filter on. */
const BLANK_CATEGORY_VALUES = new Set(['(NONE)', '—']);

/** Every outstanding line of one SO, page by page: a sofa set converts as a unit, and its members may sit on a page
    not loaded yet or outside the current search. */
async function fetchDocLines(docNo: string): Promise<OutstandingSoItem[]> {
  const out: OutstandingSoItem[] = [];
  let cursor: string | null = null;
  for (let n = 0; n < 20; n++) {
    const page: OutstandingSoPage = await authedFetch<OutstandingSoPage>(outstandingSoPageUrl({ docNo }, cursor, 200));
    out.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

type Pick = { picked: boolean; qty: number };

const groupKeyOf = (g: PickerGroup): string => JSON.stringify([g.project, g.customer]);

export const PurchaseOrderFromSo = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  /* Commander 2026-05-29 — when opened from a PO ("Transfer from Sales Order" / "Add Line
     Item"), ?poId scopes this picker to that PO: it locks to the PO's supplier
     and, on save, APPENDS the picked SO lines to that PO (instead of creating
     new POs), then returns to the PO. */
  const [searchParams] = useSearchParams();
  const targetPoId = searchParams.get('poId');
  const targetPoQ = usePurchaseOrderDetail(targetPoId);
  const targetPoSupplierCode = targetPoQ.data?.purchaseOrder?.supplier?.code ?? null;
  const targetPoNumber = targetPoQ.data?.purchaseOrder?.po_number ?? null;
  const createPos = useCreatePosFromSoItems();
  /* One append per mount: only the ?poId branch posts, and it navigates to the
     PO on success — so this mount IS one intent and a per-mount key is the same
     shape as every other create form (lib/idempotency.ts). Load-bearing here
     because onError leaves the operator ON this page with the picks intact and
     an "Add failed" dialog: if the post actually committed and only the response
     was lost, the invited re-press must REPLAY, not append the same lines twice.
     Nothing caps it otherwise — this branch does not send fromMrp, so the server
     only rejects a re-append once remaining runs out. */
  const idemKey = useIdempotencyKey();

  // Map<soItemId, { picked, qty }>. Defaults: picked = false; when ticked,
  // qty defaults to remainingQty.
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const picksRef = useRef(picks);
  picksRef.current = picks;

  // Toolbar filters (commander 2026-05-28).
  const [category, setCategory]   = useState<string>('all');
  const categoryOptions = useCategoryOptions();
  const [dateField, setDateField] = useState<DateField>('soDate');
  const [dateFrom, setDateFrom]   = useState<string>('');
  const [dateTo, setDateTo]       = useState<string>('');
  // Search box: sent to the server a moment after typing stops (owner, 19 Nov 2026).
  const [searchText, setSearchText] = useState<string>('');
  const [q, setQ] = useState<string>('');
  useEffect(() => {
    const t = setTimeout(() => setQ(searchText.trim()), 300);
    return () => clearTimeout(t);
  }, [searchText]);
  /* Main supplier (a code; '' for all). Opened from a PO, it starts on that PO's supplier. */
  const [supplierCode, setSupplierCode] = useState<string>('');
  const didPresetSupplier = useRef(false);
  useEffect(() => {
    if (didPresetSupplier.current || !targetPoSupplierCode) return;
    didPresetSupplier.current = true;
    setSupplierCode(targetPoSupplierCode);
  }, [targetPoSupplierCode]);
  /* Every supplier the list has offered, so a chosen one keeps its name when another filter leaves it no lines. */
  const [knownSuppliers, setKnownSuppliers] = useState<ReadonlyMap<string, string>>(new Map());

  // The project whose checkbox is being applied (its lines may be read first).
  const [tickingGroup, setTickingGroup] = useState<string | null>(null);

  // In-app result dialog (validation only now — the grid feeds the form).
  const [dialog, setDialog] = useState<{ title: string; body: string; goTo?: string; confirmLabel?: string; onConfirm?: () => void } | null>(null);
  // The SO whose sofa set is being read before it is ticked.
  const [setLoadingDoc, setSetLoadingDoc] = useState<string | null>(null);

  const topFilters = useMemo<PickerTopFilters>(
    () => ({ q, category, dateField, dateFrom, dateTo, supplier: supplierCode }),
    [q, category, dateField, dateFrom, dateTo, supplierCode],
  );
  const groupsQ = usePickerGroups(topFilters);
  useEffect(() => {
    const offered = groupsQ.data?.suppliers;
    if (!offered) return;
    setKnownSuppliers((known) => {
      if (offered.every(([code]) => known.has(code))) return known;
      const next = new Map(known);
      for (const [code, name] of offered) next.set(code, name);
      return next;
    });
  }, [groupsQ.data]);
  const supplierOptions = useMemo(() => {
    const options = [...knownSuppliers].map(([code, name]) => ({ value: code, label: `${code} · ${name}` }));
    if (supplierCode && !knownSuppliers.has(supplierCode)) options.push({ value: supplierCode, label: supplierCode });
    return [{ value: '', label: 'All suppliers' }, ...options.sort((a, b) => a.label.localeCompare(b.label))];
  }, [knownSuppliers, supplierCode]);
  const groups = groupsQ.data?.groups ?? [];
  const matchingLines = groups.reduce((n, g) => n + g.matching, 0);
  const isSearching = q !== '';
  const isFiltered = isSearching || category !== 'all' || supplierCode !== '' || Boolean(dateFrom || dateTo);

  /* Open projects. Search text opens every matching project; a new search starts again from that, and clearing it
     closes them all (owner, 27 Nov 2026). */
  const [openState, setOpenState] = useState<{ q: string; open: Record<string, boolean> }>({ q: '', open: {} });
  const openByGroup = openState.q === q ? openState.open : {};
  const isGroupOpen = (key: string): boolean => openByGroup[key] ?? isSearching;
  const setGroupOpen = (key: string, isOpen: boolean): void => setOpenState({ q, open: { ...openByGroup, [key]: isOpen } });

  /* Every row this screen has been shown, kept across projects, searches and filter changes: a picked line stays picked
     (and stays on the PO) when the search moves away from it. groupOfLine remembers each line's project, so a closed
     project still shows its picks. */
  const rowCache = useRef(new Map<string, OutstandingSoItem>());
  const groupOfLine = useRef(new Map<string, string>());
  const rowOf = (id: string): OutstandingSoItem | undefined => rowCache.current.get(id);
  const readGroupLines = useCallback(async (g: PickerGroup, signal?: AbortSignal): Promise<OutstandingSoItem[]> => {
    const lines = await fetchPickerGroupLines(topFilters, g, signal);
    const key = groupKeyOf(g);
    for (const r of lines) {
      rowCache.current.set(r.soItemId, r);
      groupOfLine.current.set(r.soItemId, key);
    }
    return lines;
  }, [topFilters]);

  /* Commander 2026-05-30 — the New PO form stashes its current draft
     (poNewDraft) before sending us here. Build a per-soItemId draft qty map so:
       · lines FULLY consumed by the draft are filtered out (clean),
       · lines PARTIALLY consumed still show with a "draft already X" tag, and
         the Pick Qty input is capped at (remaining − draft) so the same SO
         qty can't be over-picked across draft + new picks. */
  const draftQtyById = useMemo(() => {
    try {
      const d = readScmHandoff<{ lines?: Array<{ soItemId?: string | null; qty?: number }> }>('poNewDraft');
      if (!d) return new Map<string, number>();
      const m = new Map<string, number>();
      for (const l of (d.lines ?? [])) {
        if (!l.soItemId) continue;
        m.set(l.soItemId, (m.get(l.soItemId) ?? 0) + (l.qty ?? 0));
      }
      return m;
    } catch { return new Map<string, number>(); }
  }, []);
  const cameFromNewPage = draftQtyById.size > 0;

  /* Effective remaining for a row, after subtracting what the draft already
     holds for this same SO line. <=0 → filter out. >0 with draftQty>0 →
     partially consumed, show with the "draft already X" tag. */
  const effectiveRemaining = (r: OutstandingSoItem): number =>
    r.remainingQty - (draftQtyById.get(r.soItemId) ?? 0);
  const hasRemaining = useCallback(
    (r: OutstandingSoItem): boolean => r.remainingQty - (draftQtyById.get(r.soItemId) ?? 0) > 0,
    [draftQtyById],
  );

  // One supplier per PO (Commander 2026-05-29) — once a bound line is ticked,
  // lines from other suppliers lock. Unbound ("— none —") lines don't lock.
  const lockedSupplier = useMemo(() => {
    // In PO-scoped mode the supplier is fixed to the PO's supplier from the
    // start — every other supplier's lines grey out immediately.
    if (targetPoSupplierCode) return targetPoSupplierCode;
    for (const [id, v] of Object.entries(picks)) {
      if (!v.picked) continue;
      const row = rowCache.current.get(id);
      if (row?.mainSupplierCode) return row.mainSupplierCode;
    }
    return null;
  }, [picks, targetPoSupplierCode]);

  // A row is LOCKED when a different bound supplier is already picked.
  // Commander 2026-05-29: "不让勾选了，那为什么不把选项置灰呢" — grey these out
  // and disable their checkbox / qty input so the lock is obvious, not vague.
  // Nothing is locked while no supplier is chosen ("不要限制得太死"), and
  // unbound "— none —" rows never lock (they have no supplier to conflict).
  const isRowLocked = (r: OutstandingSoItem): boolean =>
    Boolean(r.mainSupplierCode && lockedSupplier && r.mainSupplierCode !== lockedSupplier
      && !picks[r.soItemId]?.picked);

  // ── Pick helpers ─────────────────────────────────────────────────────
  const togglePick = (id: string, remaining: number) => {
    const row = rowOf(id);
    if (!row || tickingGroup) return;
    // Block ticking a different bound supplier than the one already locked.
    if (row.mainSupplierCode && lockedSupplier && row.mainSupplierCode !== lockedSupplier
        && !picks[id]?.picked) return;
    const turningOn = !picks[id]?.picked;

    /* Sofa SET (Commander 2026-05-29) — a sofa SO converts as a UNIT: every sofa
       compartment AND every accessory (pillows: LONG/SQUARE PILLOW, etc.) of that
       SAME SO travel together on the sofa's PO ("pillow 开在 sofa 里面就要跟 sofa
       的 PO 一起"). Ticking ANY set member ticks the whole set. An accessory only
       joins a set when its SO actually contains a sofa — accessories on a
       sofa-less SO behave as normal standalone lines.
       The list is loaded a page at a time, so the SO's other lines are read from the server first (every outstanding
       line of that SO, whatever the search), the same set the whole list used to hold. */
    const grp = (row.itemGroup ?? '').toLowerCase();
    if (grp === 'sofa' || grp === 'accessory') {
      if (setLoadingDoc) return;
      setSetLoadingDoc(row.soDocNo);
      queryClient.fetchQuery({
        queryKey: ['mfg-purchase-orders', 'outstanding-so-items', 'doc', row.soDocNo],
        queryFn: () => fetchDocLines(row.soDocNo),
        staleTime: 30_000,
      })
        .then((docLines) => {
          for (const r of docLines) rowCache.current.set(r.soItemId, r);
          const lines = docLines.some((r) => r.soItemId === row.soItemId) ? docLines : [row, ...docLines];
          applyPick(row, lines, turningOn, remaining);
        })
        .catch((e: unknown) => setDialog({
          title: 'Could not read the sofa set',
          body: `The other lines of SO ${row.soDocNo} could not be loaded, so nothing was ticked. Please try again.${e instanceof Error ? `\n${e.message}` : ''}`,
        }))
        .finally(() => setSetLoadingDoc(null));
      return;
    }
    applyPick(row, [row], turningOn, remaining);
  };

  /** Tick or untick `row`, with its whole sofa set when it belongs to one. `docLines` are the outstanding lines of
      its SO (just `[row]` for a line that cannot be in a set). */
  const applyPick = (row: OutstandingSoItem, docLines: OutstandingSoItem[], turningOn: boolean, remaining: number) => {
    const id = row.soItemId;
    const grp = (row.itemGroup ?? '').toLowerCase();
    const docHasSofa = docLines.some(
      (r) => r.soDocNo === row.soDocNo && (r.itemGroup ?? '').toLowerCase() === 'sofa',
    );
    const isSetMember = grp === 'sofa' || (grp === 'accessory' && docHasSofa);
    if (isSetMember) {
      const members = docLines.filter((r) => {
        if (r.soDocNo !== row.soDocNo) return false;
        const g = (r.itemGroup ?? '').toLowerCase();
        return g === 'sofa' || g === 'accessory';
      });
      /* The supplier this set rides on = the sofa's bound supplier (first sofa
         line that has one), else whatever's already locked. */
      const sofaSupplier = members
        .find((r) => (r.itemGroup ?? '').toLowerCase() === 'sofa' && r.mainSupplierCode)?.mainSupplierCode
        ?? row.mainSupplierCode ?? lockedSupplier ?? null;
      /* One PO = one supplier. Members on the sofa's supplier (or unbound) ride
         this PO; members bound to a DIFFERENT supplier (e.g. pillows from another
         vendor) can't sit on it — they split to their own PO ("不同就分开 + 提示"). */
      const rideOn   = members.filter((r) => !r.mainSupplierCode || !sofaSupplier || r.mainSupplierCode === sofaSupplier);
      const splitOff = members.filter((r) => r.mainSupplierCode && sofaSupplier && r.mainSupplierCode !== sofaSupplier);
      setPicks((s) => {
        const next = { ...s };
        for (const m of rideOn) {
          /* Commander 2026-05-30 — when a draft already holds some of this SO
             line's qty, the bulk-set tick defaults to the EFFECTIVE remaining
             (remaining − draft) so it can't over-pick across draft + new. */
          const cap = effectiveRemaining(m);
          if (cap <= 0) continue;
          next[m.soItemId] = turningOn
            ? { picked: true, qty: cap }
            : { picked: false, qty: 0 };
        }
        return next;
      });
      if (turningOn && splitOff.length > 0) {
        const codes = [...new Set(splitOff.map((r) => `${r.itemCode} · ${r.mainSupplierName ?? r.mainSupplierCode}`))];
        setDialog({
          title: 'Accessories need their own PO',
          body: `On SO ${row.soDocNo}, these accessories belong to a different supplier and can't share the sofa's PO. Convert them separately to their own supplier:\n` + codes.map((c) => `• ${c}`).join('\n'),
        });
      }
      return;
    }

    setPicks((s) => ({
      ...s,
      [id]: turningOn ? { picked: true, qty: s[id]?.qty || remaining } : { picked: false, qty: 0 },
    }));
  };

  const setQty = (id: string, qty: number) =>
    setPicks((s) => ({ ...s, [id]: { picked: true, qty } }));

  // Commander 2026-05-30 — default each row's qty to its EFFECTIVE remaining
  // (remaining − draftQty) so bulk-select honours the draft too.
  const tickRows = (list: readonly OutstandingSoItem[]): void =>
    setPicks((s) => {
      const next = { ...s };
      for (const l of list) {
        const cap = effectiveRemaining(l);
        if (cap <= 0) continue;
        next[l.soItemId] = { picked: true, qty: cap };
      }
      return next;
    });

  /* A project's checkbox (owner, 27 Nov 2026). Its lines are read first when the project was never opened. Ticked
     when anything is picked: untick the project. Otherwise tick its lines for ONE supplier: the locked one, else the
     project's first bound supplier; unbound lines ride along as they do one by one, other suppliers' lines are left
     and named. One project at a time, so two quick ticks cannot choose two suppliers. */
  const applyGroupTick = (g: PickerGroup, lines: readonly OutstandingSoItem[]): void => {
    const current = picksRef.current;
    const eligible = lines.filter((r) => effectiveRemaining(r) > 0);
    if (eligible.some((r) => current[r.soItemId]?.picked)) {
      setPicks((s) => {
        const next = { ...s };
        for (const r of eligible) delete next[r.soItemId];
        return next;
      });
      return;
    }
    const pickedSupplier = Object.entries(current)
      .filter(([, v]) => v.picked)
      .map(([id]) => rowCache.current.get(id)?.mainSupplierCode ?? null)
      .find((code): code is string => code != null);
    const { rideOn, skipped, supplier } = planGroupTick(eligible, targetPoSupplierCode ?? pickedSupplier ?? null);
    tickRows(rideOn);
    if (skipped > 0) {
      setDialog({
        title: 'Some lines need another PO',
        body: `${skipped} line${skipped === 1 ? '' : 's'} in ${g.heading} belong${skipped === 1 ? 's' : ''} to another supplier and ${skipped === 1 ? 'was' : 'were'} not ticked. One PO takes one supplier (${supplier}).`,
      });
    }
  };
  const toggleGroup = (g: PickerGroup): void => {
    if (tickingGroup || setLoadingDoc) return;
    setTickingGroup(groupKeyOf(g));
    queryClient.fetchQuery({
      queryKey: pickerGroupLinesKey(topFilters, g),
      queryFn: ({ signal }) => readGroupLines(g, signal),
      staleTime: GROUP_LINES_STALE_MS,
    })
      .then((lines) => applyGroupTick(g, lines))
      .catch((e: unknown) => setDialog({
        title: 'Could not read this project',
        body: `The lines of ${g.heading} could not be loaded, so nothing was ticked. Please try again.${e instanceof Error ? `\n${e.message}` : ''}`,
      }))
      .finally(() => setTickingGroup(null));
  };

  const clearAll = () => setPicks({});

  const picked = Object.entries(picks).filter(([, v]) => v.picked && v.qty > 0);
  const pickedCount = picked.length;
  const pickedIds = useMemo(
    () => new Set(Object.entries(picks).filter(([, v]) => v.picked).map(([id]) => id)),
    [picks],
  );
  const pickedCountByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of pickedIds) {
      const key = groupOfLine.current.get(id);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [pickedIds]);

  // ── Columns — memoized on `picks` so the controlled checkbox + qty input
  //    re-render when pick state changes (DataGrid is React.memo'd). The project is the heading above, so no Project
  //    column (owner, 27 Nov 2026): the room goes to the document, ref, code and description, shown in full. ───────
  const buildColumns = useCallback((lineStatus: Record<string, LineStatus>): GridColumn<OutstandingSoItem>[] => [
    {
      key: 'pick', label: '', width: 40, sortable: false, groupable: false,
      accessor: (r) => {
        const on = Boolean(picks[r.soItemId]?.picked);
        const locked = isRowLocked(r);
        return (
          <input
            type="checkbox"
            checked={on}
            disabled={locked}
            onChange={() => togglePick(r.soItemId, effectiveRemaining(r))}
            // Stop the row-select click from also firing.
            onClick={(e) => e.stopPropagation()}
            aria-label={`Pick ${r.itemCode}`}
            style={locked ? { cursor: 'not-allowed' } : undefined}
          />
        );
      },
    },
    {
      key: 'soDocNo', label: 'SO Doc No', width: 150, sortable: true,
      accessor: (r) => <span className={styles.codeCell} style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{r.soDocNo}</span>,
      searchValue: (r) => r.soDocNo,
    },
    {
      key: 'soRef', label: 'Ref No.', width: 190, sortable: true,
      accessor: (r) => <span style={{ whiteSpace: 'normal' }}>{soRefOfCamelStamp(r) || '—'}</span>,
      searchValue: (r) => soRefOfCamelStamp(r),
      sortFn: (a, b) => soRefOfCamelStamp(a).localeCompare(soRefOfCamelStamp(b)),
    },
    {
      key: 'debtorName', label: 'Customer', width: 180, sortable: true, defaultHidden: true,
      accessor: (r) => r.debtorName ?? '—',
      searchValue: (r) => r.debtorName ?? '',
    },
    {
      key: 'itemGroup', label: 'Category', width: 110, sortable: true,
      accessor: (r) => <ItemGroupPill group={r.itemGroup} />,
      searchValue: (r) => r.itemGroup ?? '',
    },
    {
      /* Commander 2026-05-28 — the SKU's main supplier (where this line's PO
         goes). "— none —" means unbound: it can't be converted until assigned
         a supplier. */
      key: 'mainSupplier', label: 'Main Supplier', width: 200, sortable: true,
      accessor: (r) =>
        r.mainSupplierCode
          ? <span>{r.mainSupplierCode}{r.mainSupplierName ? ` · ${r.mainSupplierName}` : ''}</span>
          : <span className={styles.muted} style={{ color: 'var(--c-festive-b, var(--c-festive-b))' }}>— none —</span>,
      searchValue: (r) => `${r.mainSupplierCode ?? ''} ${r.mainSupplierName ?? ''}`.trim(),
    },
    {
      key: 'itemCode', label: 'Item Code', width: 170, sortable: true,
      accessor: (r) => <span style={{ fontWeight: 600, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{r.itemCode}</span>,
      searchValue: (r) => r.itemCode ?? '',
    },
    {
      key: 'description', label: 'Description', width: 340, sortable: true,
      accessor: (r) => {
        const draftQty = draftQtyById.get(r.soItemId) ?? 0;
        return (
          <div style={{ whiteSpace: 'normal' }}>
            <VariantDescription
              itemCode={r.itemCode}
              itemGroup={r.itemGroup}
              variants={r.variants}
              description={r.description}
              mutedClassName={styles.muted}
            />
            {draftQty > 0 && (
              <div style={{
                marginTop: 2, fontSize: 'var(--fs-11)', fontWeight: 600,
                color: 'var(--c-burnt)',
              }}>
                In draft: {draftQty} · remaining {effectiveRemaining(r)}
              </div>
            )}
          </div>
        );
      },
      searchValue: (r) => r.description ?? '',
    },
    {
      key: 'remark', label: 'Remarks', width: 200, sortable: false,
      accessor: (r) => (r.remark ? <span style={{ whiteSpace: 'pre-wrap' }}>{r.remark}</span> : <span className={styles.muted}>-</span>),
      searchValue: (r) => r.remark ?? '',
      exportValue: (r) => r.remark ?? '',
    },
    {
      key: 'lineStatus', label: 'Stock & orders', width: 320, sortable: false,
      accessor: (r) => <SoLineStatusCell s={lineStatus[r.soItemId]} />,
      searchValue: (r) => soLineStatusText(lineStatus[r.soItemId]),
      exportValue: (r) => soLineStatusText(lineStatus[r.soItemId]),
    },
    {
      key: 'qty', label: 'SO Qty', width: 70, align: 'right', sortable: true,
      accessor: (r) => fmtQty(r.qty),
      sortFn: (a, b) => a.qty - b.qty,
    },
    {
      key: 'poQtyPicked', label: 'Done', width: 70, align: 'right', sortable: true,
      accessor: (r) => <span className={styles.muted}>{r.poQtyPicked}</span>,
      sortFn: (a, b) => a.poQtyPicked - b.poQtyPicked,
    },
    {
      key: 'pickQty', label: 'Pick Qty', width: 90, align: 'right', sortable: false, groupable: false,
      accessor: (r) => {
        const p = picks[r.soItemId];
        const on = Boolean(p?.picked);
        const locked = isRowLocked(r);
        /* Commander 2026-05-30 — cap the input at the EFFECTIVE remaining
           (remaining − draft) so a partially-consumed SO line can't over-pick
           across the draft + new picks. */
        const cap = effectiveRemaining(r);
        return (
          <input
            type="number"
            min={0}
            max={cap}
            value={on ? p!.qty : ''}
            placeholder={String(cap)}
            disabled={locked}
            /* Commander 2026-05-28 — always editable: typing a qty auto-selects
               the row (no need to tick the checkbox first). */
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              setQty(r.soItemId, Math.min(cap, Math.max(0, Number(e.target.value) || 0)))}
            style={{ ...FILTER_INPUT, width: 64, textAlign: 'right', ...(locked ? { cursor: 'not-allowed', background: 'var(--c-cream)' } : null) }}
          />
        );
      },
    },
    {
      /* Commander 2026-05-29 — add Processing Date column. */
      key: 'processingDate', label: 'Processing Date', width: 120, sortable: true,
      accessor: (r) => fmtDateOrDash(r.processingDate ?? null),
      searchValue: (r) => r.processingDate ?? '',
      sortFn: (a, b) => String(a.processingDate ?? '').localeCompare(String(b.processingDate ?? '')),
    },
    {
      key: 'deliveryDate', label: 'Delivery Date', width: 120, sortable: true,
      accessor: (r) => fmtDateOrDash((r.lineDeliveryDate ?? r.deliveryDate) ?? null),
      searchValue: (r) => r.lineDeliveryDate ?? r.deliveryDate ?? '',
      sortFn: (a, b) =>
        String(a.lineDeliveryDate ?? a.deliveryDate ?? '')
          .localeCompare(String(b.lineDeliveryDate ?? b.deliveryDate ?? '')),
    },
    {
      key: 'lineValue', label: 'Line Value', width: 120, align: 'right', sortable: true,
      accessor: (r) => {
        const p = picks[r.soItemId];
        /* Commander 2026-05-30 — preview value defaults to the EFFECTIVE
           remaining (after draft) so the muted value matches the cap. */
        const pickQty = p?.picked ? p.qty : effectiveRemaining(r);
        return (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>
            {fmtRm(pickQty * r.unitPriceSen)}
          </span>
        );
      },
      exportValue: (r) => ((Object.hasOwn(picks, r.soItemId) && picks[r.soItemId].picked ? picks[r.soItemId].qty : effectiveRemaining(r)) * r.unitPriceSen) / 100,
      exportFormat: 'money',
      sortFn: (a, b) => a.remainingQty * a.unitPriceSen - b.remainingQty * b.unitPriceSen,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- column accessors derive from the pick/qty state already in deps; listing the helpers would only rebuild the columns for no behavioural change
  ], [picks, draftQtyById, lockedSupplier]);

  // ── Add to PO ────────────────────────────────────────────────────────
  // Commander 2026-05-29 — two modes:
  //   • PO-scoped (?poId): APPEND the picked lines straight to that PO, then
  //     return to the PO detail page (Transfer from Sales Order / Add Line Item).
  //   • Default: stash the picks + feed the New PO form (/scm/purchase-orders/new).
  const onSave = () => {
    if (pickedCount === 0) { setDialog({ title: 'Nothing picked', body: 'Tick at least one SO line first.' }); return; }

    if (targetPoId) {
      const picksPayload = picked.map(([soItemId, v]) => ({ soItemId, qty: v.qty }));
      createPos.mutate(
        { picks: picksPayload, targetPoId, idempotencyKey: idemKey },
        {
          onSuccess: (res) => {
            // Land back on the PO still in Edit mode so the new lines are right there.
            navigate(`/scm/purchase-orders/${res.targetPoId ?? targetPoId}?edit=1`);
          },
          onError: (e) => setDialog({
            title: 'Add failed',
            body: e instanceof Error ? e.message : 'Something went wrong.',
          }),
        },
      );
      return;
    }

    const out = picked
      .map(([soItemId, v]) => {
        const row = rowOf(soItemId);
        return row ? { ...row, _pickQty: v.qty } : null;
      })
      .filter(Boolean);
    if (!writeScmHandoff('poFromSoPicks', out)) {
      setDialog({ title: 'Unable to continue', body: 'This browser could not safely store your picked lines. Your selection is still here; free some browser storage and try again.' });
      return;
    }
    navigate('/scm/purchase-orders/new');
  };

  const resetFilters = (): void => {
    setCategory('all'); setDateFrom(''); setDateTo(''); setSearchText(''); setQ(''); setSupplierCode('');
  };

  // ── Toolbar (filters + clear) ──────────────────────────────────────────
  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <Button variant="ghost" size="sm" onClick={clearAll} disabled={pickedCount === 0}>
        <Square {...ICON} /> Clear all
      </Button>

      <span style={{ width: 1, height: 20, background: 'var(--line)' }} aria-hidden />

      <input
        type="search"
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        placeholder="Search SO, ref, project, customer, item…"
        aria-label="Search outstanding SO lines"
        style={{ ...FILTER_INPUT, width: 260, maxWidth: '100%' }}
      />

      <Filter size={14} strokeWidth={1.75} style={{ color: 'var(--fg-muted)' }} aria-label="Filters" />

      {/* Category filter */}
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        style={FILTER_INPUT}
        aria-label="Category filter"
      >
        {[{ value: 'all', label: 'All categories' }, ...withRowCategories(categoryOptions, [...(groupsQ.data?.categories ?? []).map(([group]) => group).filter((group) => !BLANK_CATEGORY_VALUES.has(group)), category === 'all' ? null : category])].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {/* Main supplier: type to narrow the list, then pick one. */}
      <div style={{ width: 220, maxWidth: '100%' }}>
        <SearchableSelect
          value={supplierCode}
          onChange={setSupplierCode}
          options={supplierOptions}
          placeholder="All suppliers"
          ariaLabel="Main supplier filter"
          clearable
          className="h-9 w-full rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--c-paper)] px-2 text-[16px] text-[color:var(--c-ink)] sm:h-7 sm:text-[length:var(--fs-12)]"
        />
      </div>

      {/* Date-range filter — pick which date field + from/to. */}
      <select
        value={dateField}
        onChange={(e) => setDateField(e.target.value as DateField)}
        style={FILTER_INPUT}
        aria-label="Date field"
      >
        {DATE_FIELD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <DateField value={dateFrom} onChange={(iso) => setDateFrom(iso)} style={FILTER_INPUT} aria-label="Date from"/>
      <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-11)' }}>→</span>
      <DateField value={dateTo} onChange={(iso) => setDateTo(iso)} style={FILTER_INPUT} aria-label="Date to"/>
      {(category !== 'all' || dateFrom || dateTo || searchText || supplierCode) && (
        <button
          type="button"
          onClick={resetFilters}
          style={{
            background: 'transparent', border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)', padding: '0 10px', height: 28,
            fontSize: 'var(--fs-11)', fontWeight: 600, color: 'var(--fg-muted)', cursor: 'pointer',
          }}
        >
          Reset
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Explicit back target, not history-back: this picker is reachable from
          a PO being edited, from New PO, and from the list, and each entry
          point has its own correct destination (carried over verbatim from the
          action-rail link this replaced). */}
      <PageHeader
        back={targetPoId ? `/scm/purchase-orders/${targetPoId}?edit=1`
          : cameFromNewPage ? '/scm/purchase-orders/new'
          : '/scm/purchase-orders'}
        eyebrow="Procurement"
        title={`Pick Sales Orders for this PO${targetPoNumber ? ` · ${targetPoNumber}` : ''}`}
        actions={
          <div className={styles.actions}>
            <Button
              variant="ghost" size="md"
              onClick={() => navigate(
                targetPoId ? `/scm/purchase-orders/${targetPoId}?edit=1`
                : cameFromNewPage ? '/scm/purchase-orders/new'
                : '/scm/purchase-orders'
              )}
            >
              <X {...ICON} /> Cancel
            </Button>
            <Button
              variant="primary" size="md"
              onClick={onSave}
              disabled={pickedCount === 0 || createPos.isPending}
              title={targetPoId ? 'Add the picked SO lines into this PO' : 'Add the picked SO lines into the New PO form'}
            >
              <Save {...ICON} />
              {createPos.isPending
                ? 'Adding…'
                : pickedCount === 0 ? 'Pick at least 1 line' : `Add ${pickedCount} line${pickedCount === 1 ? '' : 's'} to PO`}
            </Button>
          </div>
        }
      />
      {lockedSupplier && (
        <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          One supplier per PO — locked to <strong>{lockedSupplier}</strong>. Other suppliers' lines
          are greyed out; clear picks to switch.
        </p>
      )}

      {toolbar}

      <p role="status" style={{ margin: 0, fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
        {groupsQ.isLoading
          ? 'Loading projects…'
          : groupsQ.data
            ? `${groups.length} project${groups.length === 1 ? '' : 's'} · up to ${matchingLines} line${matchingLines === 1 ? '' : 's'} matching${groupsQ.isFetching ? ' · updating…' : ''}`
            : ''}
        {tickingGroup ? ' · reading the project to tick it…' : ''}
        {setLoadingDoc ? ` · loading the sofa set on ${setLoadingDoc}…` : ''}
      </p>

      {/* A failed read must NEVER render as "nothing left to order", and neither may an empty one (owner 2026-08-17):
          the read is scoped to the active company and fails closed, so an empty answer only means the query found
          nothing. backend/scripts/check-empty-state-claims.mjs gates this wording. */}
      {groupsQ.isError ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--c-festive-b)' }}>
          <span>We couldn't load the projects, so this list is incomplete. That is not the same as there being none left.</span>
          <Button variant="ghost" size="sm" onClick={() => { void groupsQ.refetch(); }} disabled={groupsQ.isFetching}>Try again</Button>
        </div>
      ) : groupsQ.data && groups.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>
          {isFiltered
            ? 'No outstanding SO line matches this search and these filters. That is not the same as there being none left: clear the search and filters to see the full list.'
            : "This search came back with no outstanding SO lines. That is not the same as everything having been converted — the list only covers the company you are working in, and lines it cannot see look identical to lines that are done. Open the sales order and check its balance before treating this as nothing left to purchase."}
        </p>
      ) : groups.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {groups.map((g) => {
            const key = groupKeyOf(g);
            return (
              <ProjectGroupSection
                key={key}
                group={g}
                isFiltered={isFiltered}
                isOpen={isGroupOpen(key)}
                onToggleOpen={() => setGroupOpen(key, !isGroupOpen(key))}
                linesKey={pickerGroupLinesKey(topFilters, g)}
                readLines={readGroupLines}
                pickedIds={pickedIds}
                rememberedPickCount={pickedCountByGroup.get(key) ?? 0}
                isTicking={tickingGroup === key}
                isTickBlocked={tickingGroup != null || setLoadingDoc != null}
                onToggleGroup={() => toggleGroup(g)}
                isShown={hasRemaining}
                isLocked={isRowLocked}
                buildColumns={buildColumns}
                onRowClick={(r) => togglePick(r.soItemId, r.remainingQty)}
              />
            );
          })}
        </div>
      ) : null}

      {dialog && (
        <ActionResultDialog
          title={dialog.title}
          body={dialog.body}
          primaryLabel={dialog.onConfirm ? dialog.confirmLabel : dialog.goTo ? 'Open Purchase Orders' : undefined}
          onPrimary={dialog.onConfirm ?? (dialog.goTo ? () => { const g = dialog.goTo!; setDialog(null); navigate(g); } : undefined)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
};

export interface ProjectGroupSectionProps {
  group: PickerGroup;
  isFiltered: boolean;
  isOpen: boolean;
  onToggleOpen: () => void;
  linesKey: readonly unknown[];
  readLines: (g: PickerGroup, signal?: AbortSignal) => Promise<OutstandingSoItem[]>;
  pickedIds: ReadonlySet<string>;
  /** Picks this project held when its lines were last read; used while they are not read under these filters. */
  rememberedPickCount: number;
  isTicking: boolean;
  isTickBlocked: boolean;
  onToggleGroup: () => void;
  isShown: (r: OutstandingSoItem) => boolean;
  isLocked: (r: OutstandingSoItem) => boolean;
  buildColumns: (lineStatus: Record<string, LineStatus>) => GridColumn<OutstandingSoItem>[];
  onRowClick: (r: OutstandingSoItem) => void;
}

/** One project: its heading row (the grid's own group row look) and, once opened, its lines. */
function ProjectGroupSection({
  group, isFiltered, isOpen, onToggleOpen, linesKey, readLines, pickedIds, rememberedPickCount,
  isTicking, isTickBlocked, onToggleGroup, isShown, isLocked, buildColumns, onRowClick,
}: ProjectGroupSectionProps) {
  const linesQ = useQuery({
    queryKey: linesKey,
    queryFn: ({ signal }) => readLines(group, signal),
    enabled: isOpen,
    staleTime: GROUP_LINES_STALE_MS,
    retry: false,
  });
  const lines = useMemo(() => linesQ.data?.filter(isShown) ?? null, [linesQ.data, isShown]);
  const lineIds = useMemo(() => (isOpen ? (lines ?? []).map((r) => r.soItemId) : []), [isOpen, lines]);
  const lineStatus = useSoLineStatus(lineIds);
  const columns = useMemo(() => buildColumns(lineStatus), [buildColumns, lineStatus]);

  const pickedHere = lines ? lines.filter((r) => pickedIds.has(r.soItemId)).length : rememberedPickCount;
  const tickable = lines?.filter((r) => !isLocked(r)) ?? [];
  const isChecked = tickable.length > 0 && tickable.every((r) => pickedIds.has(r.soItemId));
  const isMixed = !isChecked && pickedHere > 0;
  const boxRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (boxRef.current) boxRef.current.indeterminate = isMixed;
  }, [isMixed]);

  const countLabel = isFiltered ? `${group.matching} of ${group.total}` : String(group.total);
  const hasNoLines = lines != null && lines.length === 0;

  return (
    <section className="border-b border-border-subtle last:border-b-0">
      <div className="flex items-center bg-surface-dim/70 transition-colors hover:bg-surface-dim">
        <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center sm:h-9 sm:w-9">
          <input
            ref={boxRef}
            type="checkbox"
            checked={isChecked}
            disabled={isTickBlocked}
            onChange={onToggleGroup}
            aria-label={`Tick every line in ${group.heading}`}
            aria-busy={isTicking || undefined}
          />
        </label>
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={isOpen}
          className="flex min-h-11 flex-1 items-center gap-1.5 py-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-brand text-ink sm:min-h-9"
        >
          <ChevronRight size={12} className={cn('shrink-0 text-ink-muted transition-transform', isOpen && 'rotate-90')} aria-hidden />
          <span className="min-w-0 break-words">{group.heading}</span>
          <span className="shrink-0 font-mono text-[10px] font-normal normal-case tracking-normal text-ink-muted">({countLabel})</span>
          {pickedHere > 0 && (
            <span className="ml-auto shrink-0 pl-2 text-[11px] font-semibold normal-case tracking-normal text-primary">{pickedHere} picked</span>
          )}
        </button>
      </div>
      {isOpen && (
        <div className="border-t border-border-subtle">
          <DataGridCompat<OutstandingSoItem>
            rows={lines ?? []}
            columns={columns}
            storageKey={STORAGE_KEY}
            rowKey={(r) => r.soItemId}
            hideSearch
            exportName="po-from-so"
            /* Commander 2026-05-28 — click anywhere on a row to toggle its pick
               (the checkbox is just a visual). */
            onRowClick={onRowClick}
            /* Commander 2026-05-29 — grey out rows whose supplier conflicts with
               the locked one so the disabled state is obvious. */
            rowStyle={(r) => isLocked(r)
              ? { opacity: 0.45, background: 'var(--c-cream)', cursor: 'not-allowed' }
              : undefined}
            groupBanner={false}
            isLoading={linesQ.isLoading}
            emptyMessage={linesQ.isError
              ? `We couldn't load the lines of this project, so it looks empty when it may not be. Close and open it again to retry.${linesQ.error instanceof Error ? ` (${linesQ.error.message})` : ''}`
              : hasNoLines && (linesQ.data?.length ?? 0) > 0
                ? 'The outstanding lines of this project are already held by the PO draft you came from.'
                : 'No line of this project came back. The project count is taken before the stock check, so that is not the same as nothing left to purchase: open the sales order and check its balance.'}
          />
        </div>
      )}
    </section>
  );
}
