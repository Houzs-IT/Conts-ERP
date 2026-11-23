// ----------------------------------------------------------------------------
// PurchaseOrderFromProduction: Purchase Orders > Transfer from Production Order (owner, 23 Nov 2026: "订原材料").
// The raw materials of open production orders still to be bought, laid out like PurchaseOrderFromSo: tick lines,
// optionally edit the pick qty (capped at what is still to order), create. The server (/production-orders/material-pos,
// the same convert MRP uses) makes one PO per supplier and warehouse and links every PO line to its material.
//
// Routing: /scm/purchase-orders/from-production.
// ----------------------------------------------------------------------------

import { useMemo, useState, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Save, X, CheckSquare, Square, Filter } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { fmtDateOrDash, fmtQty } from '@2990s/shared';
import { DataGridCompat, type GridColumn } from '../../components/DataGridCompat';
import { ActionResultDialog } from '../../vendor/scm/components/ActionResultDialog';
import { PageHeader } from '../../components/Layout';
import {
  createMaterialPos,
  useMaterialsToOrder,
  MATERIALS_TO_ORDER_KEY,
  type MaterialToOrder,
} from '../../vendor/scm/lib/production-order-queries';
import { createContentBoundKey, sendWithContentKey, unansweredSaveQuestion, type ContentBoundKey } from '../../lib/idempotency';
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
type Dialog = { title: string; body: string; primaryLabel?: string; onPrimary?: () => void; onCancel?: () => void };

export const PurchaseOrderFromProduction = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const q = useMaterialsToOrder();
  const items = useMemo(() => q.data ?? [], [q.data]);

  const [picks, setPicks] = useState<Partial<Record<string, Pick>>>({});
  const [supplier, setSupplier] = useState('all');
  const [order, setOrder] = useState('all');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [saving, setSaving] = useState(false);
  /* One key per picked content: a double click or a retry of the same picks replays instead of raising a second PO.
     A new key set after each success, so the same picks made again later (after a PO was cancelled) are a new intent. */
  const [keys, setKeys] = useState<ContentBoundKey>(() => createContentBoundKey());

  const supplierOptions = useMemo(() => [...new Map(items.map((r) => [r.mainSupplierCode ?? '', supplierOf(r) || '— none —'])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1])), [items]);
  const orderOptions = useMemo(() => [...new Set(items.map((r) => r.productionOrderNo))].sort(), [items]);
  const rows = useMemo(() => items.filter((r) =>
    (supplier === 'all' || (r.mainSupplierCode ?? '') === supplier) && (order === 'all' || r.productionOrderNo === order)), [items, supplier, order]);
  const [shownRows, setShownRows] = useState<MaterialToOrder[] | null>(null);

  const rowById = useMemo(() => new Map(items.map((r) => [r.materialId, r])), [items]);
  const picked = Object.entries(picks).flatMap(([id, v]) => (v ? [[id, v] as const] : [])).filter(([id, v]) => v.picked && v.qty > 0 && rowById.has(id));
  const pickedCount = picked.length;

  const togglePick = (r: MaterialToOrder) =>
    setPicks((s) => ({ ...s, [r.materialId]: s[r.materialId]?.picked ? { picked: false, qty: 0 } : { picked: true, qty: capOf(r) } }));
  const setQty = (id: string, qty: number) => setPicks((s) => ({ ...s, [id]: { picked: qty > 0, qty } }));
  const selectAll = () => setPicks((s) => {
    const next = { ...s };
    for (const r of shownRows ?? rows) next[r.materialId] = { picked: true, qty: capOf(r) };
    return next;
  });

  const columns = useMemo<GridColumn<MaterialToOrder>[]>(() => [
    {
      key: 'pick', label: '', width: 40, sortable: false, groupable: false,
      accessor: (r) => (
        <input
          type="checkbox"
          checked={Boolean(picks[r.materialId]?.picked)}
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
        : <span className={styles.muted} style={{ color: 'var(--c-festive-b, #B8331F)' }}>— none —</span>,
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
            onChange={(e) => setQty(r.materialId, Math.min(cap, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
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
  ], [picks]);

  const onSave = async () => {
    if (pickedCount === 0) { setDialog({ title: 'Nothing picked', body: 'Tick at least one material first.' }); return; }
    const unbound = [...new Set(picked.map(([id]) => rowById.get(id)!).filter((r) => !r.mainSupplierId).map((r) => r.itemCode))];
    if (unbound.length > 0) {
      setDialog({ title: 'No supplier for these materials', body: `Give these raw materials a main supplier first, then try again:\n${unbound.map((c) => `• ${c}`).join('\n')}` });
      return;
    }
    const content = picked.map(([materialId, v]) => ({ materialId, qty: v.qty, supplierId: null })).sort((a, b) => a.materialId.localeCompare(b.materialId));
    setSaving(true);
    try {
      const res = await sendWithContentKey(keys, content,
        () => new Promise<boolean>((resolve) => {
          const qn = unansweredSaveQuestion('purchase order', 'Purchase Orders');
          setDialog({ title: qn.title, body: qn.body, primaryLabel: qn.confirmLabel, onPrimary: () => { setDialog(null); resolve(true); }, onCancel: () => resolve(false) });
        }),
        (key) => createMaterialPos({ idempotencyKey: key, mode: 'combined', picks: content }));
      if (!res.sent) return;
      setKeys(createContentBoundKey());
      setPicks({});
      await queryClient.invalidateQueries({ queryKey: MATERIALS_TO_ORDER_KEY });
      void queryClient.invalidateQueries({ queryKey: ['mfg-purchase-orders'] });
      const created = res.value.created;
      if (created.length === 0) {
        setDialog({ title: 'Already ordered', body: 'These materials are already on a PO. The list has been refreshed.' });
        return;
      }
      const only = created.length === 1 ? created[0]! : null;
      setDialog({
        title: `Created ${created.length} PO${created.length === 1 ? '' : 's'}`,
        body: created.map((p) => p.poNumber).join(', '),
        primaryLabel: only ? `Open ${only.poNumber}` : 'Open Purchase Orders',
        onPrimary: () => { setDialog(null); navigate(only ? `/scm/purchase-orders/${only.id}` : '/scm/purchase-orders'); },
      });
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Something went wrong.';
      void queryClient.invalidateQueries({ queryKey: MATERIALS_TO_ORDER_KEY });
      setDialog(raw.includes('missing_bindings')
        ? { title: 'No supplier for these materials', body: 'Give these raw materials a main supplier first, then try again.' }
        : { title: 'Could not create the PO', body: raw });
    } finally {
      setSaving(false);
    }
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
              onClick={() => { void onSave(); }}
              disabled={pickedCount === 0 || saving}
              title="Create one PO per supplier for the picked materials"
            >
              <Save {...ICON} />
              {saving ? 'Creating…' : pickedCount === 0 ? 'Pick at least 1 line' : `Create PO for ${pickedCount} line${pickedCount === 1 ? '' : 's'}`}
            </Button>
          </div>
        }
      />
      <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
        Raw materials of submitted production orders not yet on a PO. One PO is made per supplier.
      </p>

      <DataGridCompat<MaterialToOrder>
        rows={rows}
        columns={columns}
        storageKey={STORAGE_KEY}
        rowKey={(r) => r.materialId}
        searchPlaceholder="Search production order, SO, project, item…"
        onFilteredRowsChange={setShownRows}
        exportName="po-from-production"
        onRowClick={togglePick}
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
          primaryLabel={dialog.primaryLabel}
          onPrimary={dialog.onPrimary}
          onClose={() => { dialog.onCancel?.(); setDialog(null); }}
        />
      )}
    </div>
  );
};
