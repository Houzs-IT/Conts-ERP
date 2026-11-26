// ----------------------------------------------------------------------------
// PurchaseOrderFromProduction: Purchase Orders > Transfer from Production Order (owner, 23 Nov 2026: "订原材料").
// The raw materials of open production orders still to be bought, laid out like PurchaseOrderFromSo: tick lines,
// optionally edit the pick qty (capped at what is still to order), then review them in the New Purchase Order form and
// Save there (owner, 23 Nov 2026). One supplier per PO, as on Pick Sales Orders; the saved lines keep their material.
//
// Routing: /scm/purchase-orders/from-production.
// ----------------------------------------------------------------------------

import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save, X, CheckSquare, Square, Filter } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { fmtDateOrDash, fmtQty } from '@2990s/shared';
import { DataGridCompat, type GridColumn } from '../../components/DataGridCompat';
import { ActionResultDialog } from '../../vendor/scm/components/ActionResultDialog';
import { PageHeader } from '../../components/Layout';
import { useMaterialsToOrder, type MaterialToOrder } from '../../vendor/scm/lib/production-order-queries';
import { writeScmHandoff } from '../../lib/scmHandoffStorage';
import { isLockedOut, lockedSupplierOf, type ProductionPick } from './renovation-po-from-production';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const STORAGE_KEY = 'po-from-production.layout.v1';
const FILTER_INPUT: CSSProperties = {
  height: 28,
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 8px',
  fontSize: 'var(--fs-12)',
  background: 'var(--c-paper)',
  color: 'var(--c-ink)',
};

/* The server orders whole units (a PO line counts whole units), so the pick is capped at the rounded-up balance. */
const capOf = (r: MaterialToOrder): number => Math.ceil(r.qtyToOrder);
const projectOf = (r: MaterialToOrder): string => [r.projectCode, r.projectName].filter(Boolean).join(' · ');
const supplierOf = (r: MaterialToOrder): string => r.mainSupplierCode ? `${r.mainSupplierCode}${r.mainSupplierName ? ` · ${r.mainSupplierName}` : ''}` : '';

type Pick = { picked: boolean; qty: number };
type Dialog = { title: string; body: string };

export const PurchaseOrderFromProduction = () => {
  const navigate = useNavigate();
  const q = useMaterialsToOrder();
  const items = useMemo(() => q.data ?? [], [q.data]);

  const [picks, setPicks] = useState<Partial<Record<string, Pick>>>({});
  const [supplier, setSupplier] = useState('all');
  const [order, setOrder] = useState('all');
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const supplierOptions = useMemo(() => [...new Map(items.map((r) => [r.mainSupplierCode ?? '', supplierOf(r) || '— none —'])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1])), [items]);
  const orderOptions = useMemo(() => [...new Set(items.map((r) => r.productionOrderNo))].sort(), [items]);
  const rows = useMemo(() => items.filter((r) =>
    (supplier === 'all' || (r.mainSupplierCode ?? '') === supplier) && (order === 'all' || r.productionOrderNo === order)), [items, supplier, order]);
  const [shownRows, setShownRows] = useState<MaterialToOrder[] | null>(null);

  const rowById = useMemo(() => new Map(items.map((r) => [r.materialId, r])), [items]);
  const picked = Object.entries(picks).flatMap(([id, v]) => (v ? [[id, v] as const] : [])).filter(([id, v]) => v.picked && v.qty > 0 && rowById.has(id));
  const pickedCount = picked.length;
  const pickedIds = useMemo(() => new Set(picked.map(([id]) => id)), [picked]);
  const lockedSupplier = lockedSupplierOf(items, pickedIds);
  const isRowLocked = (r: MaterialToOrder): boolean => isLockedOut(r, lockedSupplier, pickedIds);

  const togglePick = (r: MaterialToOrder) => {
    if (isRowLocked(r)) return;
    setPicks((s) => ({ ...s, [r.materialId]: s[r.materialId]?.picked ? { picked: false, qty: 0 } : { picked: true, qty: capOf(r) } }));
  };
  const setQty = (r: MaterialToOrder, qty: number) => {
    if (isRowLocked(r)) return;
    setPicks((s) => ({ ...s, [r.materialId]: { picked: qty > 0, qty } }));
  };
  /* Ticks what the grid shows, on one supplier: the first bound supplier met, or the one already locked. */
  const selectAll = () => setPicks((s) => {
    const next = { ...s };
    const ids = new Set(Object.entries(next).flatMap(([id, v]) => (v?.picked ? [id] : [])));
    let lock = lockedSupplierOf(items, ids);
    for (const r of shownRows ?? rows) {
      if (r.mainSupplierCode && lock && r.mainSupplierCode !== lock) continue;
      if (r.mainSupplierCode) lock = r.mainSupplierCode;
      next[r.materialId] = { picked: true, qty: capOf(r) };
    }
    return next;
  });

  const columns = useMemo<GridColumn<MaterialToOrder>[]>(() => [
    {
      key: 'pick', label: '', width: 40, sortable: false, groupable: false,
      accessor: (r) => (
        <input
          type="checkbox"
          checked={Boolean(picks[r.materialId]?.picked)}
          disabled={isRowLocked(r)}
          onChange={() => togglePick(r)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Pick ${r.itemCode}`}
        />
      ),
    },
    {
      key: 'productionOrderNo', label: 'Production Order', width: 140, sortable: true, groupable: true,
      accessor: (r) => <span className={styles.codeCell}>{r.productionOrderNo}</span>,
      searchValue: (r) => r.productionOrderNo,
      groupValue: (r) => r.productionOrderNo,
    },
    {
      key: 'soDocNos', label: 'SO Doc No', width: 130, sortable: true,
      accessor: (r) => r.soDocNos.join(', ') || '—',
      searchValue: (r) => r.soDocNos.join(' '),
    },
    {
      key: 'project', label: 'Project', width: 200, sortable: true, groupable: true,
      accessor: (r) => projectOf(r) || '—',
      searchValue: (r) => projectOf(r),
      groupValue: (r) => projectOf(r) || '(none)',
    },
    {
      key: 'mainSupplier', label: 'Main Supplier', width: 200, sortable: true, groupable: true,
      accessor: (r) => r.mainSupplierCode
        ? <span>{supplierOf(r)}</span>
        : <span className={styles.muted} style={{ color: 'var(--c-festive-b, var(--c-festive-b))' }}>— none —</span>,
      searchValue: (r) => supplierOf(r),
      groupValue: (r) => supplierOf(r) || '(none)',
    },
    {
      key: 'itemCode', label: 'Item Code', width: 130, sortable: true,
      accessor: (r) => <span style={{ fontWeight: 600 }}>{r.itemCode}</span>,
      searchValue: (r) => r.itemCode,
    },
    {
      key: 'description', label: 'Description', width: 220, sortable: true,
      accessor: (r) => r.description ?? '—',
      searchValue: (r) => r.description ?? '',
    },
    { key: 'uom', label: 'UOM', width: 70, sortable: true, accessor: (r) => r.uom ?? '—', searchValue: (r) => r.uom ?? '' },
    {
      key: 'qtyNeeded', label: 'Needed', width: 80, align: 'right', sortable: true,
      accessor: (r) => fmtQty(r.qtyNeeded), sortFn: (a, b) => a.qtyNeeded - b.qtyNeeded, numberValue: (r) => r.qtyNeeded,
    },
    {
      key: 'qtyOrdered', label: 'Ordered', width: 80, align: 'right', sortable: true,
      accessor: (r) => <span className={styles.muted}>{fmtQty(r.qtyOrdered)}</span>, sortFn: (a, b) => a.qtyOrdered - b.qtyOrdered, numberValue: (r) => r.qtyOrdered,
    },
    {
      key: 'qtyToOrder', label: 'To Order', width: 80, align: 'right', sortable: true,
      accessor: (r) => <span style={{ fontWeight: 600 }}>{fmtQty(r.qtyToOrder)}</span>, sortFn: (a, b) => a.qtyToOrder - b.qtyToOrder, numberValue: (r) => r.qtyToOrder,
    },
    {
      key: 'pickQty', label: 'Pick Qty', width: 90, align: 'right', sortable: false, groupable: false,
      accessor: (r) => {
        const p = picks[r.materialId];
        const cap = capOf(r);
        return (
          <input
            type="number"
            min={0}
            max={cap}
            value={p?.picked ? p.qty : ''}
            placeholder={String(cap)}
            onClick={(e) => e.stopPropagation()}
            disabled={isRowLocked(r)}
            onChange={(e) => setQty(r, Math.min(cap, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
            aria-label={`Pick qty ${r.itemCode}`}
            style={{ ...FILTER_INPUT, width: 64, textAlign: 'right' }}
          />
        );
      },
    },
    {
      key: 'processingDate', label: 'Processing Date', width: 120, sortable: true,
      accessor: (r) => fmtDateOrDash(r.processingDate), searchValue: (r) => r.processingDate ?? '',
      sortFn: (a, b) => String(a.processingDate ?? '').localeCompare(String(b.processingDate ?? '')),
    },
    {
      key: 'deliveryDate', label: 'Delivery Date', width: 120, sortable: true,
      accessor: (r) => fmtDateOrDash(r.deliveryDate), searchValue: (r) => r.deliveryDate ?? '',
      sortFn: (a, b) => String(a.deliveryDate ?? '').localeCompare(String(b.deliveryDate ?? '')),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accessors read only the pick state already in deps
  ], [picks, lockedSupplier]);

  /* Review first (owner, 23 Nov 2026): the picks go to the New Purchase Order form, where supplier, price and dates can
     change before Save, the same hand-over Pick Sales Orders makes. */
  const onSave = () => {
    if (pickedCount === 0) { setDialog({ title: 'Nothing picked', body: 'Tick at least one material first.' }); return; }
    const out: ProductionPick[] = picked.map(([id, v]) => ({ ...rowById.get(id)!, _pickQty: v.qty }));
    if (!writeScmHandoff('poFromProductionPicks', out)) {
      setDialog({ title: 'Unable to continue', body: 'This browser could not safely store your picked lines. Your selection is still here; free some browser storage and try again.' });
      return;
    }
    navigate('/scm/purchase-orders/new');
  };

  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <Button variant="ghost" size="sm" onClick={selectAll} disabled={rows.length === 0}>
        <CheckSquare {...ICON} /> Select all
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setPicks({})} disabled={pickedCount === 0}>
        <Square {...ICON} /> Clear all
      </Button>
      <span style={{ width: 1, height: 20, background: 'var(--line)' }} aria-hidden />
      <Filter size={14} strokeWidth={1.75} style={{ color: 'var(--fg-muted)' }} aria-label="Filters" />
      <select value={supplier} onChange={(e) => setSupplier(e.target.value)} style={FILTER_INPUT} aria-label="Supplier filter">
        <option value="all">All suppliers</option>
        {supplierOptions.map(([code, label]) => <option key={code || 'none'} value={code}>{label}</option>)}
      </select>
      <select value={order} onChange={(e) => setOrder(e.target.value)} style={FILTER_INPUT} aria-label="Production order filter">
        <option value="all">All production orders</option>
        {orderOptions.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        back="/scm/purchase-orders"
        eyebrow="Procurement"
        title="Pick Production Order materials for a PO"
        actions={
          <div className={styles.actions}>
            <Button variant="ghost" size="md" onClick={() => navigate('/scm/purchase-orders')}>
              <X {...ICON} /> Cancel
            </Button>
            <Button
              variant="primary" size="md"
              onClick={onSave}
              disabled={pickedCount === 0}
              title="Add the picked materials into the New PO form"
            >
              <Save {...ICON} />
              {pickedCount === 0 ? 'Pick at least 1 line' : `Add ${pickedCount} line${pickedCount === 1 ? '' : 's'} to PO`}
            </Button>
          </div>
        }
      />
      <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
        Raw materials of submitted production orders not yet on a PO.
      </p>
      {lockedSupplier && (
        <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          One supplier per PO — locked to <strong>{lockedSupplier}</strong>. Other suppliers' lines
          are greyed out; clear picks to switch.
        </p>
      )}

      <DataGridCompat<MaterialToOrder>
        rows={rows}
        columns={columns}
        storageKey={STORAGE_KEY}
        rowKey={(r) => r.materialId}
        searchPlaceholder="Search production order, SO, project, item…"
        onFilteredRowsChange={setShownRows}
        exportName="po-from-production"
        onRowClick={togglePick}
        rowStyle={(r) => isRowLocked(r) ? { opacity: 0.45, background: 'var(--c-cream)', cursor: 'not-allowed' } : undefined}
        toolbar={toolbar}
        groupBanner={false}
        isLoading={q.isLoading}
        emptyMessage={q.isError
          ? "We couldn't load the materials, so this list is incomplete. That is not the same as there being none left — please refresh and try again."
          : (supplier !== 'all' || order !== 'all')
            ? 'No material matches these filters. Clear the filters to see the full list.'
            : 'This search came back with no materials still to order. That is not the same as everything being bought: only submitted production orders that are not on hold in the company you are working in are listed. Open the production order to check its materials.'}
      />

      {dialog && (
        <ActionResultDialog
          title={dialog.title}
          body={dialog.body}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
};
