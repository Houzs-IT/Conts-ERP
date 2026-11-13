import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import { Button } from './Button';
import { useToast } from './Toast';
import { Skeleton } from './States';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { cx } from '../lib/design-tokens';
import { count, monthLabel, plural, todayMyt } from '../lib/format';
import { STAGE_LABEL, type Stage } from '../lib/lockStages';

/** GET /api/owner-close/summary (functions/api/owner-close/summary.ts). */
interface Summary {
  month: string; lockProblem: string | null; airbnbFiles: number;
  counts: Record<Stage, { locked: number; total: number }>;
  notReady: { unitId: string; label: string; reason: string }[];
  may: { lock: Record<Stage, boolean>; unlock: boolean };
}
interface LockAnswer { locked: string[]; already: string[]; final: string[]; notReady: { unitId: string; reason: string }[] }
interface UnlockAnswer { unlocked: string[]; refused: { unitId: string; label: string; problem: string }[] }

const shift = (ym: string, by: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
/** "A, B and 3 more". */
const listed = (items: string[], most = 5) => {
  const shown = [...items.slice(0, most), ...(items.length > most ? [`${items.length - most} more`] : [])];
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0] ?? '';
};

/** A work page's lock bars (Unit report locks, spec goal 5): for each category, how many of the units it lists are locked
 *  for the month, the units whose Revenue waits for Airbnb reservations to be confirmed, and Lock all / Unlock all for the
 *  whole month. They are the Unit report's own locks (chew: the two places are linked; one store), so a lock taken here shows there and
 *  the other way round; the Unit report locks unit by unit. Lock all and Unlock all show only to whoever holds the power.
 *  Without `month` the bars keep their own month, last month to begin with (Utility bills shows many months at once). */
export function LockBars({ month: given, stages, onChange }: { month?: string; stages: Stage[]; onChange?: () => void }) {
  const [own, setOwn] = useState(() => shift(todayMyt().slice(0, 7), -1));
  const month = given ?? own;
  const { data, loading, reload } = useApi<Summary>(`/owner-close/summary?month=${month}`);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  // Someone who cannot read the month's locks (or a failed read) gets no bar: the page is theirs without it. While the
  // first read is on its way the bar keeps its place, in the same shape, so the page below it does not jump.
  if (!data && !loading) return null;
  const long = monthLabel(month, { long: true });
  const labelOf = (id: string) => data?.notReady.find(x => x.unitId === id)?.label;

  async function act(stage: Stage, action: 'lock' | 'unlock') {
    const name = STAGE_LABEL[stage];
    setBusy(`${action}:${stage}`);
    try {
      if (action === 'lock') {
        const res = await api.post<LockAnswer>('/owner-close/lock', { month, stage, unitIds: 'all' });
        const waiting = res.notReady.map(x => labelOf(x.unitId) ?? 'a unit');
        const left = [waiting.length ? `Not locked yet, Airbnb reservations still to confirm: ${listed(waiting)}.` : '',
          res.final.length ? `${plural(res.final.length, 'unit')} not locked: the statement is already final.` : ''].filter(Boolean).join(' ');
        toast({ tone: left ? 'warning' : 'success', title: res.locked.length ? `${long} ${name}: ${plural(res.locked.length, 'unit')} locked.` : `${long} ${name}: nothing more to lock.`, body: left || undefined });
      } else {
        const res = await api.post<UnlockAnswer>('/owner-close/unlock', { month, stage, unitIds: 'all' });
        toast({ tone: res.refused.length ? 'warning' : 'success', title: res.unlocked.length ? `${long} ${name}: ${plural(res.unlocked.length, 'unit')} unlocked.` : `${long} ${name}: nothing to unlock.`,
          body: res.refused.length ? `Still locked, their owner's statement is final: ${listed(res.refused.map(x => x.label))}. Unlock the final on the Unit report first.` : undefined });
      }
    } catch (err) {
      notifyFailure(err);
    } finally {
      setBusy(null);
      reload();
      onChange?.();
    }
  }

  return (
    <section aria-label={`${long} locks`} aria-busy={!data || undefined} className="rounded-card border border-solid border-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 [border-bottom:1px_solid_var(--color-line-soft)]">
        <span className="flex items-center gap-2 text-copy font-semibold">
          <span aria-hidden className="inline-flex text-lock"><Icon name="Lock" size="sm" /></span>
          {given ? `${long} locks` : (
            <span className="inline-flex items-center gap-1">
              <button type="button" aria-label="Previous month" onClick={() => setOwn(m => shift(m, -1))}
                className="grid h-7 w-7 place-items-center rounded-control border-0 bg-transparent text-muted-ink hover:text-ink cursor-pointer"><Icon name="ChevronLeft" size="sm" /></button>
              <span className="min-w-[124px] text-center tabular-nums">{long} locks</span>
              <button type="button" aria-label="Next month" onClick={() => setOwn(m => shift(m, 1))}
                className="grid h-7 w-7 place-items-center rounded-control border-0 bg-transparent text-muted-ink hover:text-ink cursor-pointer"><Icon name="ChevronRight" size="sm" /></button>
            </span>
          )}
        </span>
        <Link to={`/portfolio/owner-report?month=${month}`} className="text-meta text-muted-ink hover:text-ink">Unit by unit on the Unit report</Link>
      </div>
      {!data
        ? stages.map((stage, i) => (
          // Loading: each category's row at its loaded height (the name, the bar and count, the two buttons).
          <div key={stage} aria-hidden className={cx('flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5', i > 0 && '[border-top:1px_solid_var(--color-line-soft)]')}>
            <span className="w-[76px] shrink-0 text-copy font-medium text-muted-ink">{STAGE_LABEL[stage]}</span>
            <span className="flex min-w-[180px] flex-1 items-center gap-2.5">
              <span className="w-16 sm:w-28 shrink-0"><Skeleton height={6} radius={999} /></span>
              <Skeleton width={128} height={12} />
            </span>
            {/* The two buttons' places, at the small control height the buttons have. */}
            <span className="flex items-center gap-2">
              <span className="skeleton block h-[var(--control-height-sm)] w-[92px] rounded-control" />
              <span className="skeleton block h-[var(--control-height-sm)] w-[84px] rounded-control" />
            </span>
          </div>
        ))
        : data.lockProblem
        ? <p className="m-0 px-4 py-2.5 text-meta text-muted-ink">{data.lockProblem}</p>
        : stages.map((stage, i) => {
          const c = data.counts[stage] ?? { locked: 0, total: 0 };
          const every = c.total > 0 && c.locked >= c.total;
          const waiting = stage === 'income' ? data.notReady : [];
          return (
            <div key={stage} className={cx('flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5', i > 0 && '[border-top:1px_solid_var(--color-line-soft)]')}>
              <span className="w-[76px] shrink-0 text-copy font-medium">{STAGE_LABEL[stage]}</span>
              <span className="flex min-w-[180px] flex-1 items-center gap-2.5">
                <span aria-hidden className="h-1.5 w-16 sm:w-28 shrink-0 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-lock" style={{ width: `${c.total ? Math.round((c.locked / c.total) * 100) : 0}%` }} />
                </span>
                <span className={cx('text-meta tabular-nums', every ? 'font-semibold text-lock-ink' : 'text-muted-ink')}>
                  {c.total ? `${count(c.locked)} of ${plural(c.total, 'unit')} locked` : 'No unit to lock this month'}
                </span>
              </span>
              {(data.may.lock[stage] || data.may.unlock) && (
                <span className="flex items-center gap-2">
                  {data.may.lock[stage] && (
                    <Button size="sm" variant="secondary" icon={<Icon name="Lock" size="sm" />} loading={busy === `lock:${stage}`} onClick={() => void act(stage, 'lock')}
                      disabled={!!busy || every || !c.total} disabledReason={busy ? 'Working…' : !c.total ? 'No unit to lock this month.' : 'Every unit is locked.'}>Lock all</Button>
                  )}
                  {data.may.unlock && (
                    <Button size="sm" variant="ghost" loading={busy === `unlock:${stage}`} onClick={() => void act(stage, 'unlock')}
                      disabled={!!busy || !c.locked} disabledReason={busy ? 'Working…' : 'Nothing is locked.'}>Unlock all</Button>
                  )}
                </span>
              )}
              {(waiting.length > 0 || (stage === 'income' && data.airbnbFiles === 0)) && (
                <p className="m-0 basis-full text-meta">
                  {waiting.length > 0 && <span className="text-warning">Waiting for Airbnb reservations to be confirmed: {listed(waiting.map(w => w.label))}. </span>}
                  {stage === 'income' && data.airbnbFiles === 0 && <span className="text-muted-ink">No Airbnb payout file is uploaded for {long} yet.</span>}
                </p>
              )}
            </div>
          );
        })}
    </section>
  );
}
