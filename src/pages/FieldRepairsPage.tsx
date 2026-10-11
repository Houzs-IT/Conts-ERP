import { useState } from 'react';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner } from '../components/DataState';
import { EmptyState, Skeleton } from '../components/States';
import { useToast } from '../components/Toast';
import { StatusBadge } from '../components/StatusBadge';
import { Select } from '../components/Select';
import { useApi } from '../lib/useApi';
import { api, errorMessage } from '../lib/api';
import { cx } from '../lib/design-tokens';
import { dateShort, plural } from '../lib/format';
import {
  MediaGrid, MediaDrop, uploadTo, Checklist, Segmented, TEXTAREA, CATEGORY, hm, stamp, mytDay, dayLabel, type ChecklistItem, type MediaItem,
} from '../components/ops/OpsUi';

/* GET /api/field/maintenance (functions/api/field/maintenance.ts) */
interface Repair {
  id: string; unitId: string; title: string; detail: string | null; state: string; category: string; urgency: 'normal' | 'urgent'; blocksUnit: boolean;
  reportedAt: string; startedAt: string | null; endedAt: string | null; resolvedAt: string | null; doneNote: string | null; templateName: string | null;
  waitingForOwner: boolean; unit: { unitNumber: string; propertyName: string }; buildingId: string; addressLine: string; accessInstruction: string | null;
  photoCount: number; checklist: { done: number; total: number };
  windows: { id: string; startsAt: string; endsAt: string; note: string | null; guests: { guestName: string; checkOut: string; checkOutTime: string }[] }[];
  nextWindow: { startsAt: string; endsAt: string } | null; bucket: 'overdue' | 'today' | 'upcoming' | null;
  guestNow: { guestName: string; checkOut: string; checkOutTime: string } | null;
}
/* GET /api/field/maintenance/:id */
interface Part { skuId: string; code: string; name: string; unitLabel: string; trackStock: boolean; stockOnHand: number | null; plannedQty: number; usedQty: number }
interface Detail {
  instructions: string | null; reporter: string | null; checklist: ChecklistItem[]; media: MediaItem[]; parts: Part[];
  catalog: { id: string; code: string; name: string; unitLabel: string; trackStock: boolean; stockOnHand: number | null }[];
  access: { id: string; label: string; instruction: string }[];
}

const BUCKET: Record<'overdue' | 'today' | 'upcoming', string> = { overdue: 'Overdue', today: 'Today', upcoming: 'Upcoming' };
/** "Today 11:30 – 14:00", "Tue 14 Oct 11:30 – 14:00". */
const windowLabel = (w: { startsAt: string; endsAt: string }) => {
  const day = new Date(Date.parse(w.startsAt) + 8 * 3600e3).toISOString().slice(0, 10);
  const label = day === mytDay(0) ? 'Today' : day === mytDay(1) ? 'Tomorrow' : dayLabel(day);
  const sameDay = w.startsAt.slice(0, 10) === w.endsAt.slice(0, 10);
  return `${label} ${hm(w.startsAt)} – ${sameDay ? hm(w.endsAt) : stamp(w.endsAt)}`;
};

/** The technician's phone: the repairs given to their account, overdue first, then today, then upcoming, each with
 *  when they may enter, who is in the unit, the checklist, photos and videos, the parts used and "Work done".
 *  History lists what they finished. One column, 44px targets. */
export default function FieldRepairsPage() {
  const [view, setView] = useState<'todo' | 'history'>('todo');
  const { data, loading, error, reload } = useApi<{ rows: Repair[] }>(`/field/maintenance?view=${view}`);
  const [open, setOpen] = useState<string | null>(null);
  const rows = data?.rows ?? [];
  const overdue = rows.filter(r => r.bucket === 'overdue').length;

  return (
    <>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="m-0 text-title font-semibold">My repairs</h1>
          <div className="text-copy text-muted-ink">
            {!data ? 'Loading' : view === 'todo' ? `${plural(rows.length, 'job')} to do${overdue ? `, ${overdue} overdue` : ''}` : `${plural(rows.length, 'job')} finished`}
          </div>
        </div>
        <Segmented label="Show" value={view} onChange={v => { setView(v); setOpen(null); }} options={[{ value: 'todo', label: 'To do' }, { value: 'history', label: 'History' }]} />
      </div>
      {error && <StaleBanner message={error} onRetry={reload} />}
      {loading && !data ? <><Skeleton height={120} /><Skeleton height={120} /></>
        : rows.length === 0 ? (view === 'todo'
          ? <EmptyState icon="Wrench" title="No repairs for you right now." body="A repair the office gives you appears here, with when you may enter the unit." />
          : <EmptyState icon="History" title="Nothing finished yet." body="Repairs you mark as done are listed here." />)
        : view === 'history' ? rows.map(r => <RepairCard key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onChanged={reload} />)
        : (['overdue', 'today', 'upcoming'] as const).map(b => {
          const list = rows.filter(r => r.bucket === b);
          if (!list.length) return null;
          return (
            <section key={b} className="flex flex-col gap-2">
              <h2 className={cx('m-0 text-heading font-semibold flex items-center gap-2', b === 'overdue' && 'text-danger')}>{BUCKET[b]}<span className="text-copy text-muted-ink font-normal">{list.length}</span></h2>
              {list.map(r => <RepairCard key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onChanged={reload} />)}
            </section>
          );
        })}
    </>
  );
}

function RepairCard({ r, open, onToggle, onChanged }: { r: Repair; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const toast = useToast();
  const finished = !!r.endedAt || r.state === 'resolved';
  const detail = useApi<Detail>(open ? `/field/maintenance/${r.id}` : null);
  const [ticks, setTicks] = useState<ChecklistItem[] | null>(null);
  const [parts, setParts] = useState<Part[] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const items = ticks ?? detail.data?.checklist ?? null;
  const partList = parts ?? detail.data?.parts ?? [];
  const files = detail.data?.media.length ?? r.photoCount;
  const started = !!r.startedAt;
  const guestsInWindow = r.windows.find(w => r.nextWindow && w.startsAt === r.nextWindow.startsAt)?.guests ?? [];

  async function act(key: string, fn: () => Promise<unknown>, ok: string, after?: () => void) {
    setBusy(key);
    try { await fn(); toast({ tone: 'success', title: ok }); after?.(); onChanged(); detail.reload(); }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Check your signal and try again.') }); }
    finally { setBusy(null); }
  }
  async function setUsed(skuId: string, qty: number) {
    setBusy(`p-${skuId}`);
    try { const res = await api.post<{ data: Part[] }>(`/maintenance/issues/${r.id}/parts`, { skuId, usedQty: qty }); setParts(res.data); }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Check your signal and try again.') }); }
    finally { setBusy(null); }
  }

  const status = r.state === 'resolved' ? <StatusBadge tone="success">Closed</StatusBadge>
    : finished ? <StatusBadge tone="success">Work done</StatusBadge>
    : r.waitingForOwner ? <StatusBadge tone="warning">Waiting for owner</StatusBadge>
    : started ? <StatusBadge tone="info">In progress</StatusBadge>
    : <StatusBadge tone="neutral">To do</StatusBadge>;

  return (
    <article className={cx('bg-card rounded-card border border-solid overflow-hidden', open ? 'border-gold' : 'border-line')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full text-left p-4 flex flex-col gap-2 cursor-pointer">
        <div className="flex items-start gap-2">
          <span className="flex-1 min-w-0">
            <span className="block text-meta text-muted-ink">{r.unit.propertyName}</span>
            <b className="text-heading">{r.unit.unitNumber}<span className="text-copy font-normal"> · {r.title}</span></b>
          </span>
          {status}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {r.urgency === 'urgent' && <StatusBadge tone="critical">Urgent</StatusBadge>}
          <StatusBadge tone="neutral">{CATEGORY[r.category] ?? r.category}</StatusBadge>
          {r.checklist.total > 0 && <StatusBadge tone="neutral">{r.checklist.done} of {r.checklist.total} steps</StatusBadge>}
        </div>
        {finished ? (
          <span className="text-copy text-muted-ink">Done {stamp(r.endedAt ?? r.resolvedAt)}{r.doneNote ? ` · ${r.doneNote}` : ''}</span>
        ) : (
          <div className={cx('rounded-control px-2.5 py-2 text-copy', r.bucket === 'overdue' ? 'bg-critical-bg' : 'bg-muted')}>
            <span className="block text-meta text-muted-ink">{r.bucket === 'overdue' ? 'Repair window passed' : 'When you may enter'}</span>
            {r.nextWindow ? <b className="tabular-nums">{windowLabel(r.nextWindow)}</b>
              : r.windows.length ? <b className="tabular-nums">{windowLabel(r.windows[r.windows.length - 1])}</b>
              : <span>No time agreed yet. Call the office before you go.</span>}
          </div>
        )}
        {!finished && (r.guestNow || guestsInWindow.length > 0) && (
          <div className="rounded-control bg-warning-bg text-warning px-2.5 py-2 text-copy flex gap-2">
            <Icon name="TriangleAlert" size="sm" />
            <span>{r.guestNow
              ? `Guest in the unit now: ${r.guestNow.guestName}, until ${dateShort(r.guestNow.checkOut)} ${r.guestNow.checkOutTime}. Knock first and enter only at the agreed time.`
              : `A guest is staying during this window: ${guestsInWindow[0].guestName}, until ${dateShort(guestsInWindow[0].checkOut)} ${guestsInWindow[0].checkOutTime}. Knock first.`}</span>
          </div>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col gap-4 [border-top:1px_solid_var(--color-line-soft)] pt-3">
          {r.addressLine && <div className="text-copy"><span className="block text-meta text-muted-ink">Address</span>{r.addressLine}</div>}
          {(detail.data?.access.length ? detail.data.access : r.accessInstruction ? [{ id: 'a', label: 'Access', instruction: r.accessInstruction }] : []).map(a => (
            <div key={a.id} className="rounded-control bg-muted p-2.5 text-copy"><b>{a.label}</b><div className="text-muted-ink">{a.instruction}</div></div>
          ))}
          {r.detail && <div className="text-copy"><span className="block text-meta text-muted-ink">What is wrong{detail.data?.reporter ? `, reported by ${detail.data.reporter}` : ''}</span><span className="whitespace-pre-wrap">{r.detail}</span></div>}
          {detail.data?.instructions && <div className="rounded-control bg-gold-tint p-2.5 text-copy"><span className="block text-meta text-muted-ink">How to do it{r.templateName ? ` (${r.templateName})` : ''}</span>{detail.data.instructions}</div>}
          {r.windows.length > 1 && (
            <div className="text-copy"><span className="block text-meta text-muted-ink">All agreed times</span>
              {r.windows.map(w => <div key={w.id} className="tabular-nums">{windowLabel(w)}{w.note ? <span className="text-muted-ink"> · {w.note}</span> : null}</div>)}
            </div>
          )}

          {!finished && !started && (
            <Button size="touch" variant="secondary" icon={<Icon name="Play" size="sm" />} loading={busy === 'start'} disabled={r.waitingForOwner} disabledReason="The owner has not approved the quote yet."
              onClick={() => void act('start', () => api.post(`/maintenance/issues/${r.id}/start`, {}), 'Started.')}>Start the repair</Button>
          )}
          {started && !finished && <span className="text-copy text-muted-ink">Started {stamp(r.startedAt)}.</span>}

          {(items === null || items.length > 0 || !finished) && (
            <section className="flex flex-col gap-1">
              <h3 className="m-0 text-copy font-semibold">Checklist {items && items.length > 0 && <span className="text-muted-ink font-normal">{items.filter(c => c.done).length} of {items.length}</span>}</h3>
              {items ? <Checklist taskId={r.id} endpoint={`/maintenance/issues/${r.id}/checklist`} items={items} readOnly={finished} onChange={setTicks} /> : <Skeleton height={100} />}
            </section>
          )}

          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-copy font-semibold">Photos and videos <span className="text-muted-ink font-normal">{files}{!finished && ', at least 1 to finish'}</span></h3>
            {detail.data && <MediaGrid items={detail.data.media} cols={3} />}
            {!finished && <MediaDrop capture upload={uploadTo(`/maintenance/issues/${r.id}/photos`, { kind: started ? 'after' : 'before' })} onDone={() => { detail.reload(); onChanged(); }}
              label={started ? 'Add photos or videos of the work' : 'Add before photos or videos'} />}
          </section>

          {detail.data && (partList.length > 0 || (!finished && detail.data.catalog.length > 0)) && (
            <section className="flex flex-col gap-2">
              <h3 className="m-0 text-copy font-semibold">Parts used</h3>
              {partList.map(p => (
                <div key={p.skuId} className="flex items-center gap-2">
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{p.name}</span>
                    <span className="block text-meta text-muted-ink">{p.plannedQty > 0 ? `Usually ${p.plannedQty}` : p.code}{p.stockOnHand != null ? ` · ${p.stockOnHand} in the store` : ''}</span>
                  </span>
                  {finished ? <b className="tabular-nums">{p.usedQty}</b> : <>
                    <button type="button" aria-label={`One less ${p.name}`} disabled={p.usedQty === 0 || busy === `p-${p.skuId}`} onClick={() => void setUsed(p.skuId, p.usedQty - 1)}
                      className="w-11 h-11 grid place-items-center rounded-control border border-solid border-line bg-card cursor-pointer disabled:opacity-40 disabled:cursor-default"><Icon name="Minus" size="sm" /></button>
                    <b className="w-8 text-center tabular-nums" aria-live="polite">{p.usedQty}</b>
                    <button type="button" aria-label={`One more ${p.name}`} disabled={busy === `p-${p.skuId}`} onClick={() => void setUsed(p.skuId, p.usedQty + 1)}
                      className="w-11 h-11 grid place-items-center rounded-control border border-solid border-line bg-card cursor-pointer disabled:opacity-40"><Icon name="Plus" size="sm" /></button>
                  </>}
                </div>
              ))}
              {!finished && (
                <div className="flex gap-2">
                  <Select label="Add a part" size="md" className="flex-1 min-w-0" value={adding} onChange={setAdding} placeholder="Add a part from the catalog"
                    options={detail.data.catalog.filter(c => !partList.some(p => p.skuId === c.id)).map(c => ({ value: c.id, label: c.name, hint: c.code }))} />
                  <Button size="touch" variant="secondary" disabled={!adding} disabledReason="Pick a part first." loading={busy === `p-${adding}`}
                    onClick={() => { const id = adding; setAdding(''); void setUsed(id, 1); }}>Add</Button>
                </div>
              )}
            </section>
          )}

          {!finished && started && (
            <section className="flex flex-col gap-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-meta font-medium text-muted-ink">What you did (optional)</span>
                <textarea className={TEXTAREA} value={note} onChange={e => setNote(e.target.value)} maxLength={2000} placeholder="e.g. Replaced the washer, no more drip." />
              </label>
              <Button size="touch" variant="primary" loading={busy === 'done'} disabled={files === 0} disabledReason="Add at least one photo or video of the work first."
                onClick={() => void act('done', () => api.post(`/maintenance/issues/${r.id}/end`, { note: note.trim() || undefined }), `${r.unit.unitNumber} work done. Thank you.`, () => setNote(''))}>
                Work done
              </Button>
              <span className="text-meta text-muted-ink">The office then closes the job with its cost.</span>
            </section>
          )}
          {finished && r.doneNote && <div className="text-copy"><span className="block text-meta text-muted-ink">Your note</span>{r.doneNote}</div>}
        </div>
      )}
    </article>
  );
}
