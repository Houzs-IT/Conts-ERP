/* Renovation SKU Master (Conts, spec 2026-10-09 section 3). Replaces the Houzs
   furniture-factory grid on the SKU Master tab while CONTS_RENOVATION_CATALOG is
   on (the Houzs grid stays in Products.tsx, unchanged).

   Group and sub-category chips; every status, so a Built-in SKU waiting for its
   photo is findable; a thumbnail; the main supplier (the SKU's default PO party).
   Clicking a row opens the SKU: name, group / sub-category, unit, active, photos,
   and the suppliers drawer the Houzs page already has. */
import { useMemo, useState } from 'react';
import { Plus, Search, Truck, Upload, X } from 'lucide-react';
import { Button } from '../../../components/Button';
import { DataTable } from '../../../components/DataTable';
import { useDebouncedValue } from '../../../vendor/scm/lib/hooks';
import { useNotify } from '../../../vendor/scm/components/NotifyDialog';
import {
  useRenovationSkus,
  useUpdateMfgProductCatalog,
  type MfgCategory,
  type MfgProductCatalogPatch,
  type MfgProductRow,
} from '../../../vendor/scm/lib/mfg-products-queries';
import { categoryGroupOf, isCatalogGroup, type CatalogGroup } from '../../../vendor/shared/renovation-catalog';
import { CatalogChips } from './CatalogChips';
import { CatalogCategoryPicker } from './CatalogCategoryPicker';
import { RenovationNewSku } from './RenovationNewSku';
import { SkuPhotoSection } from './SkuPhotoSection';
import { UomSelect } from './UomSelect';
import { SkuStatusBadge, SkuThumb, renovationSkuColumns, skuNeedsPhoto } from './renovationSkuColumns';
import styles from '../Products.module.css';

export function RenovationSkuMaster({
  onImport,
  onOpenSuppliers,
}: {
  onImport: () => void;
  onOpenSuppliers: (row: MfgProductRow) => void;
}) {
  const [group, setGroup] = useState<CatalogGroup | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 300);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const q = useRenovationSkus({ group, sub, search: debounced.trim() || undefined });
  const rows = q.data ?? null;
  const showCost = useMemo(() => (rows ?? []).some((r) => 'mainCostSen' in r), [rows]);
  const columns = useMemo(() => renovationSkuColumns({ showCost }), [showCost]);
  const needPhoto = useMemo(() => (rows ?? []).filter((r) => r.status !== 'ACTIVE' && skuNeedsPhoto(r)).length, [rows]);
  const openRow = openId ? (rows ?? []).find((r) => r.id === openId) ?? null : null;
  const count = rows ? `${rows.length} SKU${rows.length === 1 ? '' : 's'}` : 'Loading…';

  return (
    <div className="space-y-3">
      <CatalogChips group={group} sub={sub} onGroup={setGroup} onSub={setSub} />

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-0 flex-1 basis-56 items-center sm:max-w-sm">
          <Search size={14} strokeWidth={1.75} className="pointer-events-none absolute left-2.5 text-ink-muted" />
          <input
            type="search"
            aria-label="Search SKUs"
            placeholder="Search code, name, description"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-2 text-[13px] outline-none focus:border-primary"
          />
        </label>
        <span className="text-[12px] text-ink-secondary" aria-live="polite">
          {count}
          {needPhoto > 0 && <span className="text-amber-700"> · {needPhoto} need a photo</span>}
        </span>
        <div className="ml-auto flex flex-wrap gap-2 whitespace-nowrap">
          <Button variant="secondary" onClick={onImport}><Upload size={14} strokeWidth={1.75} /> Import SKUs</Button>
          <Button variant="primary" onClick={() => setNewOpen(true)}><Plus size={14} strokeWidth={1.75} /> New SKU</Button>
        </div>
      </div>

      <DataTable<MfgProductRow>
        tableId="renovation-sku-master"
        persistFilters={false}
        mobileCard={{ primary: 'name', cells: ['code', 'group', 'sub', 'uom', 'main', 'status'] }}
        exportName="sku-master"
        rows={rows}
        loading={q.isLoading}
        error={q.error ? (q.error instanceof Error ? q.error.message : 'Could not load the SKUs.') : null}
        emptyLabel={group || sub || debounced ? 'No SKUs match.' : 'No SKUs yet. Use New SKU or Import SKUs.'}
        getRowKey={(r) => r.id}
        columns={columns}
        onRowClick={(r) => setOpenId(r.id)}
      />

      {newOpen && (
        <RenovationNewSku
          initialGroup={group}
          initialSub={sub}
          onClose={() => setNewOpen(false)}
          onCreated={(c) => { setNewOpen(false); setOpenId(c.id); }}
        />
      )}
      {openRow && (
        <RenovationSkuDrawer row={openRow} onClose={() => setOpenId(null)} onOpenSuppliers={() => onOpenSuppliers(openRow)} />
      )}
    </div>
  );
}

export function RenovationSkuDrawer({ row, onClose, onOpenSuppliers }: { row: MfgProductRow; onClose: () => void; onOpenSuppliers: () => void }) {
  const notify = useNotify();
  const save = useUpdateMfgProductCatalog();
  const derived = row.category_group ?? categoryGroupOf(row.category) ?? 'WORKS';
  const storedGroup: CatalogGroup = isCatalogGroup(derived) ? derived : 'WORKS';
  const [name, setName] = useState(row.name);
  const [group, setGroup] = useState<CatalogGroup>(storedGroup);
  const [sub, setSub] = useState<string | null>(row.sub_category ?? null);
  const [uom, setUom] = useState(row.uom ?? 'UNIT');
  const [error, setError] = useState<string | null>(null);

  const catChanged = group !== storedGroup || (sub ?? null) !== (row.sub_category ?? null);
  const dirty = name.trim() !== row.name || catChanged || uom !== (row.uom ?? 'UNIT');

  const run = (patch: MfgProductCatalogPatch & { id: string }, done: string) => {
    setError(null);
    save.mutate(patch, {
      onSuccess: () => void notify({ title: done }),
      onError: (e) => setError(e instanceof Error ? e.message : 'Could not save.'),
    });
  };
  const saveDetails = () => {
    if (!name.trim()) return setError('Name is required.');
    if (!sub && group !== 'SERVICE') return setError(group === 'WORKS' ? 'Choose the trade.' : 'Choose the sub-category.');
    run(
      {
        id: row.id,
        ...(name.trim() !== row.name ? { name: name.trim() } : {}),
        // A legacy category moves to the group code only when the user changes the pick.
        ...(catChanged ? { category: group as MfgCategory, subCategory: sub } : {}),
        ...(uom !== (row.uom ?? 'UNIT') ? { uom } : {}),
      },
      `${row.code} saved.`,
    );
  };
  const toggleActive = () =>
    run(
      { id: row.id, status: row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
      row.status === 'ACTIVE' ? `${row.code} is inactive.` : `${row.code} is active.`,
    );

  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <aside className={styles.drawer} role="dialog" aria-label={`SKU ${row.code}`} onClick={(e) => e.stopPropagation()}>
        <header className={styles.drawerHeader}>
          <div className="flex min-w-0 items-center gap-3">
            <SkuThumb row={row} size={44} />
            <div className="min-w-0">
              <h2 className={`${styles.drawerTitle} truncate`}>{row.code}</h2>
              <SkuStatusBadge row={row} />
            </div>
          </div>
          <button type="button" aria-label="Close" className={styles.iconBtn} onClick={onClose}><X size={16} strokeWidth={1.75} /></button>
        </header>
        <div className={`${styles.drawerBody} space-y-5`}>
          <section className={styles.formGrid}>
            <label className={`${styles.field} ${styles.formGridFull}`}>
              <span className={styles.fieldLabel}>Name *</span>
              <input aria-label="Name" className={styles.fieldInput} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <CatalogCategoryPicker idPrefix={`sku-${row.id}`} group={group} sub={sub} onChange={(n) => { setGroup(n.group); setSub(n.sub); }} />
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Unit</span>
              <UomSelect value={uom} onChange={setUom} />
            </label>
          </section>
          {error && <p role="alert" className="text-[12px] text-red-700">{error}</p>}

          <section className="space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-secondary">Photos</h3>
            <SkuPhotoSection productId={row.id} productName={row.name} category={row.category} photoCount={row.photoCount ?? 0} />
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-secondary">Main supplier</h3>
            <p className="text-[13px]">
              {row.mainSupplierName ?? <span className="text-ink-muted">None yet. The first supplier added becomes the main supplier.</span>}
            </p>
            <Button variant="secondary" onClick={onOpenSuppliers}><Truck size={14} strokeWidth={1.75} /> Suppliers and cost</Button>
          </section>
        </div>
        <footer className={styles.drawerFooter}>
          <Button variant="secondary" onClick={toggleActive} disabled={save.isPending}>
            {row.status === 'ACTIVE' ? 'Make inactive' : 'Make active'}
          </Button>
          <Button variant="primary" onClick={saveDetails} disabled={!dirty || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </footer>
      </aside>
    </div>
  );
}
