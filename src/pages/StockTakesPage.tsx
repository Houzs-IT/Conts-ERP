import { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { NumberInput, DateField } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { date } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';
import type { Tone } from '../lib/types';

/** Stock Takes — count stock in a warehouse; posting adjusts on-hand to the counted qty. */

type Status = 'OPEN' | 'POSTED' | 'CANCELLED';
const STATUS_LABEL: Record<Status, string> = { OPEN: 'Open', POSTED: 'Posted', CANCELLED: 'Cancelled' };
const STATUS_TONE: Record<Status, Tone> = { OPEN: 'info', POSTED: 'success', CANCELLED: 'neutral' };

interface TakeLine { id?: string; itemCode: string; description: string; systemQty: number; countedQty: number | null; variance: number | null }
interface Take { id: string; takeNumber: string; warehouseName: string; warehouseId: string; takeDate: string; status: Status; notes: string; lines?: TakeLine[] }
interface Opt { id: string; code: string; name: string }

const FALLBACK: { data: Take[]; generatedAt: string } = { generatedAt: '', data: [
  { id: 'k1', takeNumber: 'STK-2026-0001', warehouseName: 'Main Warehouse', warehouseId: 'w1', takeDate: '2026-09-15', status: 'POSTED', notes: 'Opening count', lines: [{ id: 'kl1', itemCode: 'SF-3S-GRY', description: 'Emma 3-Seater Sofa', systemQty: 3, countedQty: 4, variance: 1 }] },
] };
const WH_FALLBACK = { data: [{ id: 'w1', code: 'WH-MAIN', name: 'Main Warehouse' }, { id: 'w2', code: 'WH-KL', name: 'KL Transit Hub' }] };

export default function StockTakesPage() {
  const { data, loading, error, reload } = useApi<{ data: Take[]; generatedAt: string }>('/stock-takes', FALLBACK);
  const warehouses = useApi<{ data: Opt[] }>('/warehouses', WH_FALLBACK).data?.data ?? [];
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [drawer, setDrawer] = useState<{ mode: 'new' } | { mode: 'view'; k: Take } | null>(null);
  const [added, setAdded] = useState<Take[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Take>>>({});

  const rows = useMemo(() => [...added, ...(data?.data ?? [])].map(k => ({ ...k, ...edits[k.id] })), [added, data, edits]);

  const columns = useMemo<Column<Take>[]>(() => [
    { key: 'take', label: 'Take', type: 'ref', value: k => k.takeNumber, hideable: false },
    { key: 'warehouse', label: 'Warehouse', value: k => k.warehouseName },
    { key: 'date', label: 'Date', type: 'date', value: k => k.takeDate || null },
    { key: 'status', label: 'Status', type: 'status', value: k => k.status, status: k => ({ label: STATUS_LABEL[k.status], tone: STATUS_TONE[k.status] }) },
  ], []);

  function created(k: Take) { setAdded(a => [k, ...a]); toast({ tone: 'success', title: 'Stock take started.', body: k.takeNumber }); setDrawer(null); }
  function act(k: Take, patch: Record<string, unknown>, optimistic: Partial<Take>, title: string) {
    setEdits(e => ({ ...e, [k.id]: { ...e[k.id], ...optimistic } }));
    api.patch(`/stock-takes/${k.id}`, patch).catch(notifyFailure);
    toast({ tone: 'success', title, body: k.takeNumber });
    setDrawer(d => d && d.mode === 'view' ? { mode: 'view', k: { ...d.k, ...optimistic } } : d);
  }

  return (
    <>
      <PageHeader title="Stock takes" sub={`${rows.length} counts`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>New stock take</Button> : undefined} />
      <DataTable<Take>
        id="scm.stock-takes" columns={columns} rows={data ? rows : null} rowKey={k => k.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={k => setDrawer({ mode: 'view', k })}
        noun={['stock take', 'stock takes']} exportName="stock-takes"
        empty={{ title: 'No stock takes yet.', body: 'Start a count to check on-hand stock in a warehouse.', action: canWrite ? { label: 'New stock take', onClick: () => setDrawer({ mode: 'new' }) } : undefined }} />
      {drawer?.mode === 'new' && <CreateDrawer warehouses={warehouses} canWrite={canWrite} onClose={() => setDrawer(null)} onCreated={created} />}
      {drawer?.mode === 'view' && <CountDrawer k={drawer.k} canWrite={canWrite} onClose={() => setDrawer(null)} onAct={act} />}
    </>
  );
}

function CreateDrawer({ warehouses, canWrite, onClose, onCreated }: { warehouses: Opt[]; canWrite: boolean; onClose: () => void; onCreated: (k: Take) => void }) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [takeDate, setTakeDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<{ itemCode: string; description: string }[]>([{ itemCode: '', description: '' }]);
  const setItem = (i: number, k: 'itemCode' | 'description', v: string) => setItems(is => is.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const built = () => items.filter(i => i.itemCode.trim()).map(i => ({ itemCode: i.itemCode.trim(), description: i.description.trim() }));
  const canSave = canWrite && warehouseId !== '' && built().length > 0;

  const [tried, setTried] = useState(false);

  function submit() {
    setTried(true);
    if (!takeDate) return;
    const b = built();
    api.post('/stock-takes', { warehouseId, takeDate, notes, lines: b }).catch(notifyFailure);
    onCreated({ id: `stk-new-${crypto.randomUUID().slice(0, 8)}`, takeNumber: `STK-${new Date().getFullYear()}-NEW`, warehouseName: warehouses.find(w => w.id === warehouseId)?.name ?? '', warehouseId, takeDate, status: 'OPEN', notes, lines: b.map(i => ({ itemCode: i.itemCode, description: i.description, systemQty: 0, countedQty: null, variance: null })) });
  }

  return (
    <Drawer open onClose={onClose} width={640}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">New stock take</h2><button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3.5">
          <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Warehouse</label>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          </div>
          <DateField label="Date" required value={takeDate} onChange={setTakeDate} error={tried && !takeDate ? 'Required.' : undefined} />
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">Items to count</div>
          <div className="overflow-x-auto border border-solid border-line rounded-card">
            <table className="w-full border-collapse min-w-[420px]"><thead><tr className="bg-muted">{['Item code', 'Description', ''].map((th, i) => <th key={th || i} className="py-2 px-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink">{th}</th>)}</tr></thead>
              <tbody>{items.map((it, i) => (<tr key={i} className="[border-top:1px_solid_var(--color-line-soft,#EDEAE4)]">
                <td className="p-1.5"><input value={it.itemCode} onChange={e => setItem(i, 'itemCode', e.target.value)} className="h-8 w-[150px] box-border px-2 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none" /></td>
                <td className="p-1.5"><input value={it.description} onChange={e => setItem(i, 'description', e.target.value)} className="h-8 w-full box-border px-2 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none" /></td>
                <td className="p-1.5 text-center"><button onClick={() => setItems(is => is.length > 1 ? is.filter((_, j) => j !== i) : is)} aria-label="Remove" className="text-muted-ink hover:text-[var(--color-critical-fg)] bg-transparent border-none cursor-pointer p-1"><Trash2 size={15} /></button></td>
              </tr>))}</tbody>
            </table>
          </div>
          <div><Button size="sm" variant="secondary" icon={<Plus size={15} strokeWidth={1.75} />} onClick={() => setItems(is => [...is, { itemCode: '', description: '' }])}>Add item</Button></div>
        </div>
        <Field label="Notes" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Pick a warehouse and add an item" onClick={submit}>Start take</Button>
      </div>
    </Drawer>
  );
}

function CountDrawer({ k, canWrite, onClose, onAct }: { k: Take; canWrite: boolean; onClose: () => void; onAct: (k: Take, patch: Record<string, unknown>, optimistic: Partial<Take>, title: string) => void }) {
  const editable = canWrite && k.status === 'OPEN';
  const [lines, setLines] = useState<TakeLine[]>((k.lines ?? []).map(l => ({ ...l })));
  const setCount = (i: number, counted: number | null) => setLines(ls => ls.map((l, j) => j !== i ? l : { ...l, countedQty: counted, variance: counted === null ? null : counted - l.systemQty }));

  function saveCounts() { onAct(k, { lines: lines.map(l => ({ id: l.id, countedQty: l.countedQty })) }, { lines }, 'Counts saved.'); }
  function post() { onAct(k, { status: 'POSTED', lines: lines.map(l => ({ id: l.id, countedQty: l.countedQty })) }, { status: 'POSTED', lines }, 'Stock take posted — on-hand adjusted.'); }

  return (
    <Drawer open onClose={onClose} width={720}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{k.takeNumber}</h2><span className={cx('inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-0.5 rounded-full', TONE[STATUS_TONE[k.status]].bg, TONE[STATUS_TONE[k.status]].text)}><span className="w-1.5 h-1.5 rounded-full bg-current" />{STATUS_LABEL[k.status]}</span></div><button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="text-[13px] text-muted-ink">{k.warehouseName} · {k.takeDate ? date(k.takeDate) : ''}</div>
        <div className="overflow-x-auto border border-solid border-line rounded-card">
          <table className="w-full border-collapse min-w-[520px]">
            <thead><tr className="bg-muted">{['Item', 'System', 'Counted', 'Variance'].map((th, i) => <th key={th} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i === 0 ? 'text-left' : 'text-right')}>{th}</th>)}</tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id ?? i} className="[border-top:1px_solid_var(--color-line-soft,#EDEAE4)]">
                  <td className="py-2 px-3"><div className="flex flex-col"><span className="text-[13px]">{l.description || l.itemCode}</span><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px] text-muted-ink">{l.itemCode}</span></div></td>
                  <td className="py-2 px-3 text-right tabular-nums text-[13px] text-muted-ink">{l.systemQty}</td>
                  <td className="py-2 px-3 text-right">{editable ? <NumberInput aria-label="Counted quantity" min={0} value={l.countedQty} onChange={v => setCount(i, v)} className="h-8 w-[80px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" /> : <span className="tabular-nums text-[13px]">{l.countedQty ?? '—'}</span>}</td>
                  <td className={cx('py-2 px-3 text-right tabular-nums text-[13px] font-semibold', l.variance == null ? 'text-muted-ink' : l.variance === 0 ? 'text-muted-ink' : l.variance > 0 ? 'text-[var(--color-success-fg)]' : 'text-[var(--color-critical-fg)]')}>{l.variance == null ? '—' : l.variance > 0 ? `+${l.variance}` : l.variance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <div>{editable && <Button size="sm" variant="danger" onClick={() => onAct(k, { status: 'CANCELLED' }, { status: 'CANCELLED' }, 'Stock take cancelled.')}>Cancel</Button>}</div>
        <div className="flex gap-2.5">
          {editable && <Button size="sm" variant="secondary" onClick={saveCounts}>Save counts</Button>}
          {editable && <Button size="sm" variant="primary" onClick={post}>Post &amp; adjust</Button>}
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Drawer>
  );
}
