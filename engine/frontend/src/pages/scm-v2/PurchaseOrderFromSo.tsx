import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number, currency = 'MYR'): string => fmtMoneySen(centi, currency);

// New key: older saved layouts still include the Project column.
const STORAGE_KEY = 'po-from-so.project-lines.v1';
const GROUP_LINES_STALE_MS = 30_000;

const FILTER_INPUT: CSSProperties = {
  height: 28,
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 8px',
  fontSize: 'var(--fs-12)',
  background: 'var(--c-paper)',
  color: 'var(--c-ink)',
};

const DATE_FIELD_OPTIONS = [
  { value: 'soDate',       label: 'SO Date' },
  { value: 'processing',   label: 'Processing Date' },
  { value: 'delivery',     label: 'Delivery Date' },
] as const;
type DateField = typeof DATE_FIELD_OPTIONS[number]['value'];

// Blank-category funnel texts, which the server cannot filter on.
const BLANK_CATEGORY_VALUES = new Set(['(NONE)', '—']);

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

  const [searchParams] = useSearchParams();
  const targetPoId = searchParams.get('poId');
  const targetPoQ = usePurchaseOrderDetail(targetPoId);
  const targetPoSupplierCode = targetPoQ.data?.purchaseOrder?.supplier?.code ?? null;
  const targetPoNumber = targetPoQ.data?.purchaseOrder?.po_number ?? null;
  const createPos = useCreatePosFromSoItems();
  // One key per mount: a re-press after a lost response must replay, not append the lines twice.
  const idemKey = useIdempotencyKey();

  const [picks, setPicks] = useState<Record<string, Pick>>({});

  const [category, setCategory]   = useState<string>('all');
  const categoryOptions = useCategoryOptions();
  const [dateField, setDateField] = useState<DateField>('soDate');
  const [dateFrom, setDateFrom]   = useState<string>('');
  const [dateTo, setDateTo]       = useState<string>('');
  const [searchText, setSearchText] = useState<string>('');
  const [q, setQ] = useState<string>('');
  useEffect(() => {
    const t = setTimeout(() => setQ(searchText.trim()), 300);
    return () => clearTimeout(t);
  }, [searchText]);
  const [supplierCode, setSupplierCode] = useState<string>('');
  const didPresetSupplier = useRef(false);
  useEffect(() => {
    if (didPresetSupplier.current || !targetPoSupplierCode) return;
    didPresetSupplier.current = true;
    setSupplierCode(targetPoSupplierCode);
  }, [targetPoSupplierCode]);
  // Keeps a chosen supplier's name when other filters leave it no lines.
  const [knownSuppliers, setKnownSuppliers] = useState<ReadonlyMap<string, string>>(new Map());

  const [dialog, setDialog] = useState<{ title: string; body: string; goTo?: string; confirmLabel?: string; onConfirm?: () => void } | null>(null);
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

  const [openState, setOpenState] = useState<{ q: string; open: Record<string, boolean> }>({ q: '', open: {} });
  const openByGroup = openState.q === q ? openState.open : {};
  const isGroupOpen = (key: string): boolean => openByGroup[key] ?? isSearching;
  const setGroupOpen = (key: string, isOpen: boolean): void => setOpenState({ q, open: { ...openByGroup, [key]: isOpen } });

  // Picks outlive the search that showed them, so keep every row seen and which project it came from.
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

  const effectiveRemaining = (r: OutstandingSoItem): number =>
    r.remainingQty - (draftQtyById.get(r.soItemId) ?? 0);
  const hasRemaining = useCallback(
    (r: OutstandingSoItem): boolean => r.remainingQty - (draftQtyById.get(r.soItemId) ?? 0) > 0,
    [draftQtyById],
  );

  // One PO takes one supplier; lines without a supplier never lock.
  const lockedSupplier = useMemo(() => {
    if (targetPoSupplierCode) return targetPoSupplierCode;
    for (const [id, v] of Object.entries(picks)) {
      if (!v.picked) continue;
      const row = rowCache.current.get(id);
      if (row?.mainSupplierCode) return row.mainSupplierCode;
    }
    return null;
  }, [picks, targetPoSupplierCode]);

  const isRowLocked = (r: OutstandingSoItem): boolean =>
    Boolean(r.mainSupplierCode && lockedSupplier && r.mainSupplierCode !== lockedSupplier
      && !picks[r.soItemId]?.picked);

  const togglePick = (id: string, remaining: number) => {
    const row = rowOf(id);
    if (!row) return;
    if (row.mainSupplierCode && lockedSupplier && row.mainSupplierCode !== lockedSupplier
        && !picks[id]?.picked) return;
    const turningOn = !picks[id]?.picked;

    // A sofa SO converts as a unit with its accessories, so read every open line of the SO first.
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
      const sofaSupplier = members
        .find((r) => (r.itemGroup ?? '').toLowerCase() === 'sofa' && r.mainSupplierCode)?.mainSupplierCode
        ?? row.mainSupplierCode ?? lockedSupplier ?? null;
      const rideOn   = members.filter((r) => !r.mainSupplierCode || !sofaSupplier || r.mainSupplierCode === sofaSupplier);
      const splitOff = members.filter((r) => r.mainSupplierCode && sofaSupplier && r.mainSupplierCode !== sofaSupplier);
      setPicks((s) => {
        const next = { ...s };
        for (const m of rideOn) {
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
            // The row click would toggle the pick a second time.
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
        const cap = effectiveRemaining(r);
        return (
          <input
            type="number"
            min={0}
            max={cap}
            value={on ? p!.qty : ''}
            placeholder={String(cap)}
            disabled={locked}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              setQty(r.soItemId, Math.min(cap, Math.max(0, Number(e.target.value) || 0)))}
            style={{ ...FILTER_INPUT, width: 64, textAlign: 'right', ...(locked ? { cursor: 'not-allowed', background: 'var(--c-cream)' } : null) }}
          />
        );
      },
    },
    {
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

  const onSave = () => {
    if (pickedCount === 0) { setDialog({ title: 'Nothing picked', body: 'Tick at least one SO line first.' }); return; }

    if (targetPoId) {
      const picksPayload = picked.map(([soItemId, v]) => ({ soItemId, qty: v.qty }));
      createPos.mutate(
        { picks: picksPayload, targetPoId, idempotencyKey: idemKey },
        {
          onSuccess: (res) => {
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

      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        style={FILTER_INPUT}
        aria-label="Category filter"
      >
        {[{ value: 'all', label: 'All categories' }, ...withRowCategories(categoryOptions, [...(groupsQ.data?.categories ?? []).map(([group]) => group).filter((group) => !BLANK_CATEGORY_VALUES.has(group)), category === 'all' ? null : category])].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

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
        {setLoadingDoc ? ` · loading the sofa set on ${setLoadingDoc}…` : ''}
      </p>

      {/* Empty or failed is never "nothing left": the read fails closed per company. check-empty-state-claims.mjs gates this wording. */}
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
  rememberedPickCount: number;
  isShown: (r: OutstandingSoItem) => boolean;
  isLocked: (r: OutstandingSoItem) => boolean;
  buildColumns: (lineStatus: Record<string, LineStatus>) => GridColumn<OutstandingSoItem>[];
  onRowClick: (r: OutstandingSoItem) => void;
}

function ProjectGroupSection({
  group, isFiltered, isOpen, onToggleOpen, linesKey, readLines, pickedIds, rememberedPickCount,
  isShown, isLocked, buildColumns, onRowClick,
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

  const countLabel = isFiltered ? `${group.matching} of ${group.total}` : String(group.total);
  const hasNoLines = lines != null && lines.length === 0;

  return (
    <section className="border-b border-border-subtle last:border-b-0">
      <div className="flex items-center bg-surface-dim/70 transition-colors hover:bg-surface-dim">
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={isOpen}
          className="flex min-h-11 flex-1 items-center gap-1.5 py-2 pl-4 pr-4 text-left text-[11px] font-semibold uppercase tracking-brand text-ink sm:min-h-9"
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
            onRowClick={onRowClick}
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
