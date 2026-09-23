import { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Drawer } from '../components/Dialog';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { date } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';

/** Stock Transfers — move stock between warehouses; posts TRANSFER_OUT/IN movements. */

interface Line { itemCode: string; description: string; qty: number }
interface Transfer { id: string; transferNumber: string; fromName: string; toName: string; fromWarehouseId: string; toWarehouseId: string; transferDate: string; status: 'POSTED' | 'CANCELLED'; notes: string; lines?: Line[] }
interface Opt { id: string; code: string; name: string }

const FALLBACK: { data: Transfer[]; generatedAt: string } = { generatedAt: '', data: [
  { id: 't1', transferNumber: 'TRF-2026-0001', fromName: 'Main Warehouse', toName: 'KL Transit Hub', fromWarehouseId: 'w1', toWarehouseId: 'w2', transferDate: '2026-09-20', status: 'POSTED', notes: '', lines: [{ itemCode: 'SF-3S-GRY', description: 'Emma 3-Seater Sofa', qty: 2 }] },
] };
const WH_FALLBACK = { data: [{ id: 'w1', code: 'WH-MAIN', name: 'Main Warehouse' }, { id: 'w2', code: 'WH-KL', name: 'KL Transit Hub' }] };

export default function StockTransfersPage() {
  const { data, loading, error, reload } = useApi<{ data: Transfer[]; generatedAt: string }>('/stock-transfers', FALLBACK);
  const warehouses = useApi<{ data: Opt[] }>('/warehouses', WH_FALLBACK).data?.data ?? [];
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [drawer, setDrawer] = useState<{ mode: 'new' } | { mode: 'view'; t: Transfer } | null>(null);
  const [added, setAdded] = useState<Transfer[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Transfer>>>({});

  const rows = useMemo(() => [...added, ...(data?.data ?? [])].map(t => ({ ...t, ...edits[t.id] })), [added, data, edits]);

  function created(t: Transfer) { setAdded(a => [t, ...a]); toast({ tone: 'success', title: 'Stock transferred.', body: t.transferNumber }); setDrawer(null); }
  function cancel(t: Transfer) { setEdits(e => ({ ...e, [t.id]: { ...e[t.id], status: 'CANCELLED' } })); api.patch(`/stock-transfers/${t.id}`, { status: 'CANCELLED' }).catch(notifyFailure); toast({ tone: 'success', title: 'Transfer cancelled.', body: t.transferNumber }); setDrawer(null); }

  return (
    <>
      <PageHeader title="Stock transfers" sub={`${rows.length} transfers · between warehouses`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>New transfer</Button> : undefined} />
      {error && <StaleBanner message={`Showing the last transfer list we have. ${error}`} onRetry={reload} />}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[680px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
              {['Transfer', 'From', 'To', 'Date', 'Status'].map(h => <th key={h} className="py-[11px] px-4 text-left text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && rows.length === 0 ? <tr><td colSpan={5}><TableSkeleton rows={5} cols={5} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={5}><div className="py-[38px] px-[22px] text-center text-[14px] font-semibold">No stock transfers yet.</div></td></tr>
              : rows.map(t => (
                <tr key={t.id} onClick={() => setDrawer({ mode: 'view', t })} className="[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)] cursor-pointer hover:bg-muted">
                  <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{t.transferNumber}</td>
                  <td className="py-[13px] px-4 text-[13px]">{t.fromName}</td>
                  <td className="py-[13px] px-4 text-[13px]">{t.toName}</td>
                  <td className="py-[13px] px-4 text-[13px] text-[var(--color-ink-2)]">{t.transferDate ? date(t.transferDate) : '—'}</td>
                  <td className="py-[13px] px-4"><span className={cx('inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-0.5 rounded-full', t.status === 'POSTED' ? cx(TONE.success.bg, TONE.success.text) : cx(TONE.neutral.bg, TONE.neutral.text))}><span className="w-1.5 h-1.5 rounded-full bg-current" />{t.status === 'POSTED' ? 'Posted' : 'Cancelled'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {drawer?.mode === 'new' && <CreateDrawer warehouses={warehouses} canWrite={canWrite} onClose={() => setDrawer(null)} onCreated={created} />}
      {drawer?.mode === 'view' && <ViewDrawer t={drawer.t} canWrite={canWrite} onClose={() => setDrawer(null)} onCancel={cancel} />}
    </>
  );
}

function CreateDrawer({ warehouses, canWrite, onClose, onCreated }: { warehouses: Opt[]; canWrite: boolean; onClose: () => void; onCreated: (t: Transfer) => void }) {
  const [from, setFrom] = useState(warehouses[0]?.id ?? '');
  const [to, setTo] = useState(warehouses[1]?.id ?? '');
  const [tdate, setTdate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<{ itemCode: string; description: string; qty: string }[]>([{ itemCode: '', description: '', qty: '1' }]);
  const setLine = (i: number, k: 'itemCode' | 'description' | 'qty', v: string) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const built = () => lines.filter(l => l.itemCode.trim() && (Number(l.qty) || 0) > 0).map(l => ({ itemCode: l.itemCode.trim(), description: l.description.trim(), qty: Number(l.qty) || 0 }));
  const canSave = canWrite && from !== '' && to !== '' && from !== to && built().length > 0;

  function submit() {
    const b = built();
    api.post('/stock-transfers', { fromWarehouseId: from, toWarehouseId: to, transferDate: tdate, notes, lines: b }).catch(notifyFailure);
    onCreated({ id: `trf-new-${crypto.randomUUID().slice(0, 8)}`, transferNumber: `TRF-${new Date().getFullYear()}-NEW`, fromName: warehouses.find(w => w.id === from)?.name ?? '', toName: warehouses.find(w => w.id === to)?.name ?? '', fromWarehouseId: from, toWarehouseId: to, transferDate: tdate, status: 'POSTED', notes, lines: b });
  }

  return (
    <Drawer open onClose={onClose} width={720}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">New stock transfer</h2><button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5">
          <Sel label="From warehouse" value={from} onChange={setFrom} options={warehouses} />
          <Sel label="To warehouse" value={to} onChange={setTo} options={warehouses} />
          <Field label="Date" type="date" value={tdate} onChange={e => setTdate(e.target.value)} />
        </div>
        {from !== '' && to !== '' && from === to && <div className="text-[12.5px] text-[var(--color-critical-fg)]">Source and destination must differ.</div>}
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">Lines</div>
          <div className="overflow-x-auto border border-solid border-line rounded-card">
            <table className="w-full border-collapse min-w-[480px]">
              <thead><tr className="bg-muted">{['Item code', 'Description', 'Qty', ''].map((th, i) => <th key={th || i} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i === 2 ? 'text-right' : 'text-left')}>{th}</th>)}</tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="[border-top:1px_solid_var(--color-line-soft,#EDEAE4)]">
                    <td className="p-1.5"><input value={l.itemCode} onChange={e => setLine(i, 'itemCode', e.target.value)} className="h-8 w-[140px] box-border px-2 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none" /></td>
                    <td className="p-1.5"><input value={l.description} onChange={e => setLine(i, 'description', e.target.value)} className="h-8 w-full box-border px-2 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none" /></td>
                    <td className="p-1.5 text-right"><input type="number" min={0} value={l.qty} onChange={e => setLine(i, 'qty', e.target.value)} className="h-8 w-[70px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" /></td>
                    <td className="p-1.5 text-center"><button onClick={() => setLines(ls => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)} aria-label="Remove" className="text-muted-ink hover:text-[var(--color-critical-fg)] bg-transparent border-none cursor-pointer p-1"><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div><Button size="sm" variant="secondary" icon={<Plus size={15} strokeWidth={1.75} />} onClick={() => setLines(ls => [...ls, { itemCode: '', description: '', qty: '1' }])}>Add line</Button></div>
        </div>
        <Field label="Notes" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Pick two different warehouses and add a line" onClick={submit}>Post transfer</Button>
      </div>
    </Drawer>
  );
}

function ViewDrawer({ t, canWrite, onClose, onCancel }: { t: Transfer; canWrite: boolean; onClose: () => void; onCancel: (t: Transfer) => void }) {
  return (
    <Drawer open onClose={onClose} width={620}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">{t.transferNumber}</h2><button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="text-[13px]"><span className="text-muted-ink">{t.fromName}</span> → <span className="text-muted-ink">{t.toName}</span> · {t.transferDate ? date(t.transferDate) : ''}</div>
        <div className="overflow-x-auto border border-solid border-line rounded-card">
          <table className="w-full border-collapse min-w-[360px]">
            <thead><tr className="bg-muted">{['Item', 'Qty'].map((th, i) => <th key={th} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i === 1 ? 'text-right' : 'text-left')}>{th}</th>)}</tr></thead>
            <tbody>{(t.lines ?? []).map((l, i) => (<tr key={i} className="[border-top:1px_solid_var(--color-line-soft,#EDEAE4)]"><td className="py-2 px-3"><div className="flex flex-col"><span className="text-[13px]">{l.description || l.itemCode}</span><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px] text-muted-ink">{l.itemCode}</span></div></td><td className="py-2 px-3 text-right tabular-nums text-[13px]">{l.qty}</td></tr>))}</tbody>
          </table>
        </div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <div>{canWrite && t.status === 'POSTED' && <Button size="sm" variant="danger" onClick={() => onCancel(t)}>Cancel transfer</Button>}</div>
        <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </Drawer>
  );
}

function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Opt[] }) {
  return (
    <div className="flex flex-col gap-[7px]">
      <label className="text-[12px] font-medium text-muted-ink">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
        <option value="">—</option>{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
}
