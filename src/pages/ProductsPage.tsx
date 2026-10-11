import { useMemo, useRef, useState } from 'react';
import { Search, Plus, Download, Upload, Pencil, Trash2 } from 'lucide-react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { MoneyInput, NumberInput } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm, todayMyt } from '../lib/format';
import { cx } from '../lib/design-tokens';

/** Products & Maintenance — the product/item master, ported from Houzs ERP's SKU master.
 *  Browsed by category. Money is integer sen; the form takes RM and converts at the edge. */

type Category = 'SOFA' | 'BEDFRAME' | 'ACCESSORY' | 'MATTRESS' | 'BEDLINES' | 'DINING' | 'DIFFUSER' | 'CARPET' | 'SERVICE';
const CATEGORIES: Category[] = ['SOFA', 'BEDFRAME', 'ACCESSORY', 'MATTRESS', 'BEDLINES', 'DINING', 'DIFFUSER', 'CARPET', 'SERVICE'];
const CAT_LABEL: Record<Category, string> = {
  SOFA: 'Sofa', BEDFRAME: 'Bedframe', ACCESSORY: 'Accessory', MATTRESS: 'Mattress',
  BEDLINES: 'Bedlines', DINING: 'Dining', DIFFUSER: 'Diffuser', CARPET: 'Carpet', SERVICE: 'Service',
};

const TABS: { key: string; label: string }[] = [
  { key: 'sku', label: 'SKU Master' },
  { key: 'modular', label: 'Modular' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'combos', label: 'Combo Pricing' },
  { key: 'variants', label: 'Variants' },
  { key: 'fabric', label: 'Fabric Converter' },
  { key: 'categories', label: 'Categories' },
];

interface Product {
  id: string; code: string; name: string; category: Category; description: string;
  baseModel: string; sizeCode: string; sizeLabel: string; branding: string; barcode: string;
  unitM3Milli: number; status: 'ACTIVE' | 'INACTIVE';
  basePriceSen: number | null; price1Sen: number | null; sellPriceSen: number | null; costPriceSen?: number;
}
interface Payload { data: Product[]; generatedAt: string }

const P = (o: Partial<Product> & Pick<Product, 'id' | 'code' | 'name' | 'category'>): Product => ({
  description: '', baseModel: '', sizeCode: '', sizeLabel: '', branding: '', barcode: '',
  unitM3Milli: 0, status: 'ACTIVE', basePriceSen: null, price1Sen: null, sellPriceSen: null, ...o,
});

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    P({ id: 'p1', code: 'SF-3S-GRY', name: 'Emma 3-Seater Sofa', category: 'SOFA', sizeLabel: '3-Seater', barcode: '9551234500123', unitM3Milli: 1240, basePriceSen: 328000, price1Sen: 298000 }),
    P({ id: 'p2', code: 'SF-2S-CHR', name: 'Emma 2-Seater Sofa, Charcoal', category: 'SOFA', sizeLabel: '2-Seater', barcode: '9551234500147', unitM3Milli: 980, basePriceSen: 248000, price1Sen: 218000 }),
    P({ id: 'p3', code: 'BF-KG-OAK', name: 'Nordic Bedframe, Oak', category: 'BEDFRAME', sizeLabel: 'King', barcode: '9551234500215', unitM3Milli: 920, basePriceSen: 189000, price1Sen: 169000 }),
    P({ id: 'p4', code: 'MT-KG-HIL', name: 'Hilton Pocket Spring Mattress', category: 'MATTRESS', sizeLabel: 'King', branding: 'HILTON', barcode: '9551234500307', unitM3Milli: 560, basePriceSen: 420000 }),
    P({ id: 'p5', code: 'AC-PIL-01', name: 'Memory Foam Pillow', category: 'ACCESSORY', sizeLabel: 'Standard', barcode: '9551234500413', unitM3Milli: 20, basePriceSen: 8900, price1Sen: 6900 }),
    P({ id: 'p6', code: 'DN-TBL-6', name: 'Solid Oak Dining Table, 6-Seat', category: 'DINING', sizeLabel: '6-Seater', barcode: '9551234500509', unitM3Milli: 680, basePriceSen: 245000, price1Sen: 215000 }),
    P({ id: 'p7', code: 'CP-RUG-01', name: 'Hand-Tufted Wool Carpet 200x300', category: 'CARPET', sizeLabel: '200x300', barcode: '9551234500603', unitM3Milli: 110, basePriceSen: 78000, price1Sen: 65000 }),
    P({ id: 'p8', code: 'SV-DEL-01', name: 'Delivery & Installation', category: 'SERVICE', barcode: '', unitM3Milli: 0, basePriceSen: 15000 }),
  ],
};

const noPrice1 = (p: Product) => p.category === 'MATTRESS' || p.category === 'SERVICE';
const priceLabel = (sen: number | null | undefined) => (sen == null ? '—' : rm(sen));

/** Split one CSV line into cells, honouring double-quoted fields. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

type Draft = {
  id?: string; code: string; name: string; category: Category; sizeLabel: string;
  baseModel: string; branding: string; barcode: string; description: string;
  basePriceSen: number | null; price1Sen: number | null; costPriceSen: number | null; unitM3: number | null; status: 'ACTIVE' | 'INACTIVE';
};
const emptyDraft = (): Draft => ({
  code: '', name: '', category: 'SOFA', sizeLabel: '', baseModel: '', branding: '', barcode: '',
  description: '', basePriceSen: null, price1Sen: null, costPriceSen: null, unitM3: null, status: 'ACTIVE',
});
const draftFrom = (p: Product): Draft => ({
  id: p.id, code: p.code, name: p.name, category: p.category, sizeLabel: p.sizeLabel,
  baseModel: p.baseModel, branding: p.branding, barcode: p.barcode, description: p.description,
  basePriceSen: p.basePriceSen, price1Sen: p.price1Sen, costPriceSen: p.costPriceSen ?? null,
  unitM3: p.unitM3Milli ? p.unitM3Milli / 1000 : null, status: p.status,
});

export default function ProductsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/products', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);

  const [tab, setTab] = useState('sku');
  const [cat, setCat] = useState<'all' | Category>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<Draft | null>(null);
  const [editPrices, setEditPrices] = useState(false);
  const [priceEdits, setPriceEdits] = useState<Record<string, { basePriceSen?: number | null; price1Sen?: number | null }>>({});

  const [added, setAdded] = useState<Product[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Product>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const all = useMemo(
    () => [...added, ...(data?.data ?? [])].filter(p => !removed.has(p.id)).map(p => ({ ...p, ...edits[p.id] })),
    [added, data, edits, removed],
  );

  const q = search.trim().toLowerCase();
  const rows = all.filter(p =>
    (cat === 'all' || p.category === cat) &&
    (!q || `${p.code} ${p.name} ${p.barcode}`.toLowerCase().includes(q)),
  );

  const columns = useMemo<Column<Product>[]>(() => [
    { key: 'code', label: 'Product Code', type: 'ref', value: p => p.code, hideable: false },
    { key: 'name', label: 'Description', value: p => p.name, text: p => (p.branding ? `${p.name} · ${p.branding}` : p.name), width: 240,
      render: p => <span className="block whitespace-nowrap overflow-hidden text-ellipsis">{p.name}{p.branding ? <span className="text-muted-ink"> · {p.branding}</span> : ''}</span> },
    { key: 'category', label: 'Category', value: p => p.category, text: p => CAT_LABEL[p.category], filter: { kind: 'select' },
      render: p => <span className="inline-block text-[11px] font-semibold uppercase tracking-[0.06em] bg-[var(--color-gold-50)] text-gold-ink px-2.5 py-0.5 rounded-full">{CAT_LABEL[p.category]}</span> },
    { key: 'size', label: 'Size', value: p => p.sizeLabel, width: 110 },
    { key: 'price2', label: 'Price 2', type: 'money', value: p => p.basePriceSen,
      render: p => editPrices
        ? <span onClick={e => e.stopPropagation()}><PriceInput label={`Base price for ${p.code}`} valueSen={priceEdits[p.id]?.basePriceSen !== undefined ? priceEdits[p.id].basePriceSen! : p.basePriceSen} onChange={v => setPriceEdits(s => ({ ...s, [p.id]: { ...s[p.id], basePriceSen: v } }))} /></span>
        : <span className="tabular-nums whitespace-nowrap">{priceLabel(p.basePriceSen)}</span> },
    { key: 'price1', label: 'Price 1', type: 'money', value: p => (noPrice1(p) ? null : p.price1Sen),
      render: p => noPrice1(p) ? <span className="text-faint">—</span>
        : editPrices
          ? <span onClick={e => e.stopPropagation()}><PriceInput label={`Price 1 for ${p.code}`} valueSen={priceEdits[p.id]?.price1Sen !== undefined ? priceEdits[p.id].price1Sen! : p.price1Sen} onChange={v => setPriceEdits(s => ({ ...s, [p.id]: { ...s[p.id], price1Sen: v } }))} /></span>
          : <span className="tabular-nums whitespace-nowrap">{priceLabel(p.price1Sen)}</span> },
    { key: 'barcode', label: 'Barcode', value: p => p.barcode, width: 140 },
    { key: 'm3', label: 'Unit (m³)', type: 'number', value: p => (p.unitM3Milli ? p.unitM3Milli / 1000 : null), width: 100,
      render: p => p.unitM3Milli ? <span className="tabular-nums">{(p.unitM3Milli / 1000).toFixed(3)}</span> : <span className="text-muted-ink">—</span> },
    { key: 'status', label: 'Status', type: 'status', value: p => p.status, entity: 'active_flag' },
  ], [editPrices, priceEdits]);

  function patch(id: string, optimistic: Partial<Product>, apiBody?: Record<string, unknown>) {
    setEdits(e => ({ ...e, [id]: { ...e[id], ...optimistic } }));
    api.patch(`/products/${id}`, apiBody ?? optimistic).catch(notifyFailure);
  }

  function submitDraft(f: Draft) {
    const basePriceSen = f.basePriceSen;
    const price1Sen = f.category === 'MATTRESS' || f.category === 'SERVICE' ? null : f.price1Sen;
    const unitM3Milli = f.unitM3 == null ? 0 : Math.round(f.unitM3 * 1000);
    const shared: Partial<Product> = {
      code: f.code.trim(), name: f.name.trim(), category: f.category, sizeLabel: f.sizeLabel.trim(),
      baseModel: f.baseModel.trim(), branding: f.branding.trim(), barcode: f.barcode.trim(), description: f.description.trim(),
      unitM3Milli, status: f.status, basePriceSen, price1Sen, sellPriceSen: basePriceSen,
    };
    const apiBody: Record<string, unknown> = { ...shared, costPriceSen: f.costPriceSen };
    if (f.id) {
      patch(f.id, shared, apiBody);
      toast({ tone: 'success', title: 'Product updated.', body: `${f.code.trim()} ${f.name.trim()}` });
    } else {
      const local = P({ id: `prod-new-${crypto.randomUUID().slice(0, 8)}`, code: f.code.trim(), name: f.name.trim(), category: f.category, ...shared });
      setAdded(a => [local, ...a]);
      api.post('/products', apiBody).catch(notifyFailure);
      toast({ tone: 'success', title: 'Product added.', body: `${f.code.trim()} ${f.name.trim()}` });
    }
    setDrawer(null);
  }

  function remove(p: Product) {
    setRemoved(s => new Set(s).add(p.id));
    api.del(`/products/${p.id}`).catch(notifyFailure);
    toast({ tone: 'success', title: 'Product removed.', body: p.code });
    setDrawer(null);
  }

  function savePrices() {
    for (const [id, e] of Object.entries(priceEdits)) {
      const body: Partial<Product> = {};
      if (e.basePriceSen !== undefined) body.basePriceSen = e.basePriceSen;
      if (e.price1Sen !== undefined) body.price1Sen = e.price1Sen;
      if (Object.keys(body).length) patch(id, body);
    }
    const n = Object.keys(priceEdits).length;
    setPriceEdits({}); setEditPrices(false);
    if (n) toast({ tone: 'success', title: 'Prices saved.', body: `${n} ${n === 1 ? 'product' : 'products'} updated.` });
  }

  function exportCsv() {
    const head = ['code', 'name', 'category', 'size_label', 'branding', 'barcode', 'base_price', 'price1', 'unit_m3', 'status'];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const body = rows.map(p => [p.code, p.name, p.category, p.sizeLabel, p.branding, p.barcode,
      p.basePriceSen != null ? String(p.basePriceSen / 100) : '', p.price1Sen != null ? String(p.price1Sen / 100) : '',
      p.unitM3Milli ? String(p.unitM3Milli / 1000) : '', p.status].map(v => esc(String(v ?? ''))).join(','));
    const csv = [head.join(','), ...body].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `products-${todayMyt()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  async function importCsv(file: File) {
    const text = await file.text();
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { toast({ tone: 'critical', title: 'Nothing to import.', body: 'The file has no data rows.' }); return; }
    const header = splitCsv(lines[0]).map(h => h.trim().toLowerCase());
    const idx = (k: string) => header.indexOf(k);
    const rowsIn = lines.slice(1).map(line => {
      const c = splitCsv(line);
      const at = (k: string) => { const i = idx(k); return i >= 0 ? (c[i] ?? '').trim() : ''; };
      const rmCell = (k: string) => { const v = at(k); const n = Number(v); return v && Number.isFinite(n) ? Math.round(n * 100) : undefined; };
      return {
        code: at('code'), name: at('name'), category: at('category').toUpperCase(),
        size_label: at('size_label') || at('size'), branding: at('branding'), barcode: at('barcode'),
        base_price_sen: rmCell('base_price') ?? rmCell('price 2') ?? rmCell('price2'),
        price1_sen: rmCell('price1') ?? rmCell('price 1'),
        unit_m3_milli: (() => { const v = at('unit_m3') || at('unit (m³)'); const n = Number(v); return v && Number.isFinite(n) ? Math.round(n * 1000) : undefined; })(),
      };
    }).filter(r => r.code);
    try {
      const res = await api.post<{ upserted: number; failed: number }>('/products/batch-import', { rows: rowsIn });
      toast({ tone: res.failed ? 'warning' : 'success', title: `Imported ${res.upserted} ${res.upserted === 1 ? 'product' : 'products'}.`, body: res.failed ? `${res.failed} row(s) skipped.` : 'All rows loaded.' });
      reload();
    } catch (e) { notifyFailure(e); }
  }

  const countLabel = `${rows.length} ${rows.length === 1 ? 'product' : 'products'}${cat === 'all' ? '' : ` · ${CAT_LABEL[cat]}`}`;

  return (
    <>
      <PageHeader title="Products" sub="Master data · fit-out and furniture catalogue" />

      {/* Tab rail */}
      <div className="flex gap-0.5 overflow-x-auto rounded-control border border-solid border-line bg-card p-1 w-fit max-w-full">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cx('whitespace-nowrap rounded-[6px] px-[14px] py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] cursor-pointer border-none',
              tab === t.key ? 'bg-black text-white' : 'bg-transparent text-muted-ink')}>
            {t.label}
          </button>
        ))}
      </div>

      {tab !== 'sku' ? (
        <Card>
          <div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center">
            <span className="text-[14px] font-semibold">{TABS.find(t => t.key === tab)?.label} is part of the furniture-specific module.</span>
            <span className="text-[12.5px] text-muted-ink max-w-[420px]">The SKU Master is ported first. Modular models, variants, combo pricing and the fabric converter come across in a later step.</span>
          </div>
        </Card>
      ) : (
        <>
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">{countLabel}</div>

          <DataTable<Product>
            id="scm.products" columns={columns} rows={data ? rows : null} rowKey={p => p.id}
            loading={loading} error={error} onRetry={reload} pageSize={0}
            onRowClick={!editPrices && canWrite ? p => setDrawer(draftFrom(p)) : undefined}
            noun={['product', 'products']} exportName="products"
            toolbar={<>
              <div className="flex gap-2 flex-wrap">
                <Chip label="All" active={cat === 'all'} onClick={() => setCat('all')} />
                {CATEGORIES.map(c => <Chip key={c} label={CAT_LABEL[c]} active={cat === c} onClick={() => setCat(c)} />)}
              </div>
              <div className="relative">
                <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
                <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search all products..." aria-label="Search all products"
                  className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[240px] max-w-full" />
              </div>
            </>}
            actions={<>
              <Button variant="secondary" size="sm" icon={<Download size={16} strokeWidth={1.75} />} onClick={exportCsv} title="CSV in the column layout Import reads back">CSV for import</Button>
              {canWrite && <>
                <input ref={fileRef} type="file" accept=".csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = ''; }} />
                <Button variant="secondary" size="sm" icon={<Upload size={16} strokeWidth={1.75} />} onClick={() => fileRef.current?.click()}>Import</Button>
                <Button variant="secondary" size="sm" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer(emptyDraft())}>New SKU</Button>
                {editPrices
                  ? <>
                      <Button variant="secondary" size="sm" onClick={() => { setPriceEdits({}); setEditPrices(false); }}>Cancel</Button>
                      <Button variant="primary" size="sm" onClick={savePrices}>Save ({Object.keys(priceEdits).length})</Button>
                    </>
                  : <Button variant="primary" size="sm" icon={<Pencil size={16} strokeWidth={1.75} />} onClick={() => setEditPrices(true)}>Edit Prices</Button>}
              </>}
            </>}
            filtered={!!q || cat !== 'all'} onClearFilters={() => { setSearch(''); setCat('all'); }}
            empty={{ title: 'No products yet.', body: 'Add a product, or import your SKU sheet as a CSV.', action: canWrite ? { label: 'New SKU', onClick: () => setDrawer(emptyDraft()) } : undefined }} />
        </>
      )}

      {drawer && <ProductDrawer draft={drawer} onClose={() => setDrawer(null)} onSubmit={submitDraft} onDelete={drawer.id ? () => { const p = all.find(x => x.id === drawer.id); if (p) remove(p); } : undefined} />}
    </>
  );
}

/* ---------- small primitives ---------- */

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid',
        active ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>
      {label}
    </button>
  );
}

function PriceInput({ label, valueSen, onChange }: { label: string; valueSen: number | null; onChange: (v: number | null) => void }) {
  return (
    <MoneyInput valueSen={valueSen} onChangeSen={onChange} aria-label={label}
      className="h-8 w-[110px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" />
  );
}

/* ---------- New / Edit drawer ---------- */

function ProductDrawer({ draft, onClose, onSubmit, onDelete }: { draft: Draft; onClose: () => void; onSubmit: (d: Draft) => void; onDelete?: () => void }) {
  const [f, setF] = useState<Draft>(draft);
  const set = <K extends keyof Draft>(k: K) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value as Draft[K] }));
  const isSofa = f.category === 'SOFA';
  const isMattress = f.category === 'MATTRESS';
  const hidePrice1 = isMattress || f.category === 'SERVICE';
  const canSubmit = f.code.trim() !== '' && f.name.trim() !== '';

  return (
    <Drawer open onClose={onClose} width={640}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">{f.id ? 'Edit product' : 'New SKU'}</h2>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted">✕</button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow">
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Code" placeholder="e.g. SF-3S-GRY" value={f.code} onChange={set('code')} />
          <Field label="Name" placeholder="Product name" value={f.name} onChange={set('name')} />
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Category</label>
            <select value={f.category} onChange={set('category')}
              className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
            </select>
          </div>
          <Field label="Size label" placeholder="e.g. King / 3-Seater" value={f.sizeLabel} onChange={set('sizeLabel')} />
          {isSofa && <Field label="Base model" placeholder="Model family" value={f.baseModel} onChange={set('baseModel')} />}
          {isMattress && <Field label="Branding" placeholder="e.g. HILTON" value={f.branding} onChange={set('branding')} />}
          <Field label="Barcode" placeholder="optional" value={f.barcode} onChange={set('barcode')} />
          <div className="col-span-2"><Field label="Description" placeholder="Secondary description" value={f.description} onChange={set('description')} /></div>
          <MoneyInput label={isMattress ? 'Price (RM)' : 'Base price / Price 2 (RM)'} valueSen={f.basePriceSen} onChangeSen={v => setF(s => ({ ...s, basePriceSen: v }))} />
          {!hidePrice1 && <MoneyInput label="Price 1 (RM)" valueSen={f.price1Sen} onChangeSen={v => setF(s => ({ ...s, price1Sen: v }))} />}
          <MoneyInput label="Cost price (RM)" valueSen={f.costPriceSen} onChangeSen={v => setF(s => ({ ...s, costPriceSen: v }))} />
          <NumberInput label="Unit (m³)" decimals={3} placeholder="0.000" min={0} value={f.unitM3} onChange={v => setF(s => ({ ...s, unitM3: v }))} />
          {f.id && (
            <div className="flex flex-col gap-[7px]">
              <label className="text-[12px] font-medium text-muted-ink">Status</label>
              <select value={f.status} onChange={set('status')}
                className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{onDelete && <ConfirmButton icon={<Trash2 size={15} strokeWidth={1.75} />} confirm={{ title: `Delete product ${draft.code}?`, body: 'It is deleted for good and drops off the product list.', confirmLabel: 'Delete product', cancelLabel: 'Keep it' }} onConfirm={onDelete}>Delete</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSubmit} disabledReason="Enter a code and a name first" onClick={() => onSubmit(f)}>{f.id ? 'Save' : 'Create SKU'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
