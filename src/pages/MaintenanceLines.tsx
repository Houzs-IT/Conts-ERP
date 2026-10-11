import { useEffect, useState, type KeyboardEvent } from 'react';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { Select } from '../components/Select';
import { MoneyInput, NumberInput } from '../components/inputs';
import { Skeleton } from '../components/States';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, errorMessage } from '../lib/api';
import { rm } from '../lib/format';
import { INPUT } from '../components/ops/OpsUi';
import type { Sku } from './MaintenanceCatalog';

/* GET /api/maintenance/issues/:id/lines (functions/api/maintenance/issues/[id]/lines.ts) */
export interface Line {
  id: string; skuId: string | null; code: string | null; description: string; kind: 'service' | 'part' | 'other'; uom: string;
  unitPrice: number | null; plannedQty: number; qty: number; amount: number | null; trackStock: boolean; stockOnHand: number | null;
}
interface Payload { data: Line[]; total: number | null }

/** What the job used and costs: items picked from the maintenance list (qty x its price) and "Other" lines typed in.
 *  The total is what closing the job posts to the unit, unless a different final cost is entered. */
export function JobLines({ issueId, done, money, skus, onChanged }: { issueId: string; done: boolean; money: boolean; skus: Sku[]; onChanged: () => void }) {
  const toast = useToast();
  const { data, loading, reload } = useApi<Payload>(`/maintenance/issues/${issueId}/lines`);
  const [pick, setPick] = useState('');
  const [pickQty, setPickQty] = useState<number | null>(1);
  const [other, setOther] = useState<{ open: boolean; description: string; qty: number | null; price: number | null }>({ open: false, description: '', qty: 1, price: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const lines = data?.data ?? [];

  async function send(key: string, fn: () => Promise<unknown>, after?: () => void) {
    setBusy(key); setErr(null);
    try { await fn(); after?.(); reload(); onChanged(); }
    catch (e) { const m = errorMessage(e, 'Not saved. Try again.'); setErr(m); toast({ tone: 'critical', title: 'Not saved.', body: m }); }
    finally { setBusy(null); }
  }
  const options = skus.filter(s => s.active && !lines.some(l => l.skuId === s.id))
    .map(s => ({ value: s.id, label: `${s.code} · ${s.name}`, hint: money && s.defaultPrice != null ? `${rm(s.defaultPrice)} / ${s.unitLabel}` : s.unitLabel }));

  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-copy font-semibold">Items used {money && data?.total != null && lines.length > 0 && <span className="text-muted-ink font-normal">· {rm(data.total)}</span>}</h3>
      {loading && !data ? <Skeleton height={60} /> : lines.length === 0 ? <span className="text-muted-ink">{done ? 'No items were recorded.' : 'None yet. Pick from the maintenance items, or add an Other line.'}</span> : (
        <div className="flex flex-col">
          {lines.map(l => (
            <div key={l.id} className="flex items-center gap-2 min-h-10 [border-bottom:1px_solid_var(--color-line-soft)] py-1">
              <span className="flex-1 min-w-0">
                <span className="block truncate text-ink">{l.description}</span>
                <span className="block text-meta text-muted-ink">{l.code ?? 'Other'}{l.plannedQty > 0 ? ` · usually ${l.plannedQty}` : ''}{l.stockOnHand != null ? ` · ${l.stockOnHand} in store` : ''}</span>
              </span>
              {done ? <span className="tabular-nums whitespace-nowrap">{l.qty} {l.uom}</span> : (
                <span className="w-[72px] flex-none"><CommitNumber value={l.qty} label={`Quantity of ${l.description}`}
                  onCommit={v => void send(`q-${l.id}`, () => api.post(`/maintenance/issues/${issueId}/lines`, { lineId: l.id, qty: v }))} /></span>
              )}
              {money && (done ? <span className="tabular-nums whitespace-nowrap w-[90px] text-right">{rm(l.unitPrice ?? 0)}</span> : (
                <span className="w-[100px] flex-none"><CommitNumber money value={l.unitPrice ?? 0} label={`Price of ${l.description}`}
                  onCommit={v => void send(`p-${l.id}`, () => api.post(`/maintenance/issues/${issueId}/lines`, { lineId: l.id, unitPrice: v }))} /></span>
              ))}
              {money && <b className="tabular-nums whitespace-nowrap w-[84px] text-right">{rm(l.amount ?? 0)}</b>}
              {!done && <button type="button" aria-label={`Remove ${l.description}`} disabled={!!busy} onClick={() => void send(`d-${l.id}`, () => api.del(`/maintenance/issues/${issueId}/lines?lineId=${encodeURIComponent(l.id)}`))}
                className="w-8 h-8 grid place-items-center text-muted-ink hover:text-danger cursor-pointer"><Icon name="X" size="sm" /></button>}
            </div>
          ))}
        </div>
      )}
      {!done && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2 items-end">
            <div className="flex-1 min-w-0"><Select label="Add a maintenance item" size="md" className="w-full" value={pick} onChange={setPick}
              placeholder={options.length ? 'Pick a maintenance item' : 'No maintenance items set up yet'} options={options} /></div>
            <span className="w-[72px] flex-none"><NumberInput className={INPUT} value={pickQty} min={1} max={999} aria-label="Quantity to add" onChange={setPickQty} /></span>
            <Button size="sm" variant="secondary" className="h-10" disabled={!pick || !pickQty} disabledReason="Pick an item and a quantity." loading={busy === 'add'}
              onClick={() => void send('add', () => api.post(`/maintenance/issues/${issueId}/lines`, { skuId: pick, qty: pickQty }), () => { setPick(''); setPickQty(1); })}>Add</Button>
          </div>
          {!other.open ? (
            <Button size="sm" variant="secondary" className="self-start" icon={<Icon name="Plus" size="sm" />} onClick={() => setOther(o => ({ ...o, open: true }))}>Other, not on the list</Button>
          ) : (
            <div className="rounded-control bg-muted p-2.5 flex flex-col gap-2">
              <input className={INPUT} value={other.description} maxLength={160} placeholder="What it is, e.g. Replace shower hose" aria-label="Other item description" autoFocus
                onChange={e => setOther(o => ({ ...o, description: e.target.value }))} />
              <div className="flex gap-2 items-center flex-wrap">
                <span className="w-[72px]"><NumberInput className={INPUT} value={other.qty} min={1} max={999} aria-label="Other item quantity" onChange={v => setOther(o => ({ ...o, qty: v }))} /></span>
                {money && <span className="w-[120px]"><MoneyInput className={INPUT} valueSen={other.price} maxSen={100_000_000} placeholder="Price, RM" aria-label="Other item price in RM" onChangeSen={v => setOther(o => ({ ...o, price: v }))} /></span>}
                <span className="flex-1" />
                <Button size="sm" variant="secondary" onClick={() => setOther({ open: false, description: '', qty: 1, price: null })}>Cancel</Button>
                <Button size="sm" variant="primary" disabled={!other.description.trim() || !other.qty} disabledReason="Describe it and give a quantity." loading={busy === 'other'}
                  onClick={() => void send('other', () => api.post(`/maintenance/issues/${issueId}/lines`, { description: other.description.trim(), qty: other.qty, ...(money ? { unitPrice: other.price ?? 0 } : {}) }),
                    () => setOther({ open: false, description: '', qty: 1, price: null }))}>Add line</Button>
              </div>
            </div>
          )}
        </div>
      )}
      {err && <span className="text-meta text-danger" role="alert">{err}</span>}
    </section>
  );
}

/** A quantity or a price on a line, saved when the field is left (or Enter), not on every keystroke. */
function CommitNumber({ value, onCommit, label, money }: { value: number; onCommit: (v: number) => void; label: string; money?: boolean }) {
  const [v, setV] = useState<number | null>(value);
  useEffect(() => { setV(value); }, [value]);
  const commit = () => { if (v == null) setV(value); else if (v !== value) onCommit(v); };
  const enter = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); };
  return money
    ? <MoneyInput className={INPUT} valueSen={v} onChangeSen={setV} maxSen={100_000_000} aria-label={label} onBlur={commit} onKeyDown={enter} />
    : <NumberInput className={INPUT} value={v} onChange={setV} min={0} max={999} aria-label={label} onBlur={commit} onKeyDown={enter} />;
}
