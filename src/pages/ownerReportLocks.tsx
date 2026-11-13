/** Unit report click-to-lock (chew, 13 Nov 2026; spec docs/superpowers/specs/2026-11-13-unit-report-click-locks-design.md):
 *  the pieces OwnerOverallReportPage puts in its table. Clicking a lockable amount locks it, clicking again unlocks it
 *  (no reason: chew wants the small unlocks without one, since the column lock is there); each category has Lock all and
 *  Unlock all over its column; Final is a lock too (Make final, and a click on a final statement unlocks it, with a
 *  reason). Locked amounts are teal with the lock on the left (chew's choice). The server decides everything: these only
 *  ask and say what came back (functions/api/owner-close/lock.ts, unlock.ts; statements/generate, finalise, unlock-final). */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Icon from '../components/Icon';
import { cx } from '../lib/design-tokens';
import { api, notifyFailure } from '../lib/api';
import { cellKey, settleOverrides, startClick, type Overrides } from '../lib/lockOverrides';
import { finalBatches } from '../lib/finalBatches';
import { useToast } from '../components/Toast';
import type { ConfirmSpec } from '../components/ConfirmDialog';
import { count, dateShort, monthLabel, personName, plural } from '../lib/format';
import type { ReportRow } from './OwnerOverallDetail';
import { STAGE_LABEL, type Stage } from '../lib/lockStages';

/** The report's columns that are a lock category's amount. The four bills and their total lock together as Utilities. */
export const STAGE_OF: Partial<Record<string, Stage>> = {
  revenue: 'income', cleaning: 'cleaning', electricity: 'utilities', water: 'utilities', internet: 'utilities', sewerage: 'utilities',
  utilities: 'utilities', additional: 'additional', misc: 'misc', o2: 'o2',
};
/** The permission each category's lock needs, as Users and roles names it. */
const PERMISSION: Record<Stage, string> = { income: 'Lock income', cleaning: 'Lock deductions', utilities: 'Lock deductions', additional: 'Lock deductions', misc: 'Lock deductions', o2: 'Lock O2' };

/** Make final generates the statement again first (spec: Make final regenerates first), which is Finance edit work. */
const NO_GENERATE = 'Make final generates the statement again first, which needs Finance edit access. Ask management for it.';

export interface LockMay { lock: Record<Stage, boolean>; unlock: boolean; makeFinal: boolean; unlockFinal: boolean; generate: boolean }
/** The owner's statement for the month (functions/api/portfolio/owner-report.ts OwnerFinal). */
export interface OwnerFinal {
  statementId: string | null; state: 'none' | 'draft' | 'final'; waiting: string | null; by: string | null; at: string | null; paid: boolean; transferring: boolean;
  /** Nothing in the month goes on this owner's statement (a master lease with no owner adjustment): no Make final. */
  noStatement?: boolean;
}
type Lock = { by: string; at: string };
export type CellState = 'locked' | 'blocked' | 'open';

/** A lock icon, closed or open. */
export function LockIcon({ open, className }: { open?: boolean; className?: string }) {
  return <span aria-hidden className={cx('inline-flex shrink-0', className)}><Icon name={open ? 'LockOpen' : 'Lock'} size="sm" style={{ width: 14, height: 14 }} /></span>;
}

/** A lockable amount as a button filling its cell: the lock on the left, the amount on the right. While its click is on
 *  its way (`busy`) it dims and further clicks are ignored by useReportLocks. */
export function LockCell({ state, title, onClick, children, label, busy }: { state: CellState; title: string; onClick: () => void; children: ReactNode; label: string; busy?: boolean }) {
  return (
    <button type="button" title={busy ? 'Saving…' : title} aria-label={label} aria-pressed={state === 'locked'} aria-busy={busy || undefined}
      onClick={e => { e.stopPropagation(); onClick(); }}
      className={cx('flex w-full items-center justify-between gap-2 bg-transparent border-0 p-0 font-sans text-copy',
        busy ? 'cursor-progress opacity-60' : 'cursor-pointer',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lock')}>
      {state === 'locked' ? <LockIcon className="text-lock" />
        : state === 'blocked' ? <span aria-hidden className="inline-flex shrink-0 text-warning"><Icon name="TriangleAlert" size="sm" style={{ width: 14, height: 14 }} /></span>
        : <LockIcon open className="text-faint opacity-70" />}
      <span className="min-w-0">{children}</span>
    </button>
  );
}

/** The background of a locked (teal) or waiting (amber) cell, used in place of the row's own; null: keep the row's. */
export const cellTone = (state: CellState | null) => (state === 'locked' ? 'bg-lock-bg text-lock-ink' : state === 'blocked' ? 'bg-warning-bg' : null);

/** The month's lock actions for the report: one cell, a whole column, and Final. A click shows on its cell at once
 *  (`over`) and the cell is busy until the server answers; another click on a busy cell is ignored. When the report
 *  reloads, every override whose click has been answered goes, so what the server stored always wins (final review I1:
 *  a double click no longer leaves a cell showing the opposite of its lock). src/lib/lockOverrides.ts has the rules. */
export function useReportLocks(o: { month: string; may?: LockMay; rows: ReportRow[]; owners: Record<string, OwnerFinal>; reload: () => void;
  ask: (spec: Omit<ConfirmSpec, 'onConfirm'>) => Promise<string | null> }) {
  const toast = useToast();
  const label = monthLabel(o.month, { long: true });
  const [over, setOver] = useState<Overrides>({});
  const [busy, setBusy] = useState<string | null>(null);
  // The cells whose click is on its way: a ref for the click guard (a double click lands before the screen draws again)
  // and a copy in state so those cells draw busy.
  const pending = useRef(new Set<string>());
  const [busyCells, setBusyCells] = useState<ReadonlySet<string>>(() => new Set());
  const showPending = () => setBusyCells(new Set(pending.current));
  // Another month's clicks never show on this one.
  useEffect(() => setOver({}), [o.month]);
  /** When the report reloads: only the clicks still on their way keep their overrides. */
  const settle = useCallback((_rows: ReportRow[]) => setOver(x => settleOverrides(x, pending.current)), []);
  /** "A, B and 2 more": a list in a sentence. */
  const listed = (items: string[], most = 6) => {
    const shown = [...items.slice(0, most), ...(items.length > most ? [`${items.length - most} more`] : [])];
    return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0] ?? '';
  };
  // The locks cover every unit the month's statements list, and the report leaves out a unit with no contract for the
  // month (owner-report.ts), so a whole column can lock or unlock units the table does not show: they are counted apart.
  const onReport = (id: string) => o.rows.some(r => r.unitId === id);
  const names = (ids: string[]) => {
    const off = ids.filter(id => !onReport(id)).length;
    return listed([...ids.filter(onReport).map(id => o.rows.find(r => r.unitId === id)!.code), ...(off ? [`${plural(off, 'unit')} not on this report`] : [])], 7);
  };
  const offReport = (ids: string[]) => {
    const n = ids.filter(id => !onReport(id)).length;
    return n ? `${n === 1 ? 'One of them has' : `${count(n)} of them have`} no contract for the month, so ${n === 1 ? 'it is' : 'they are'} not on this report.` : '';
  };
  const stale = (months: string[] | undefined) => (months?.length
    ? `The ${listed(months.map(m => monthLabel(m, { long: true })))} draft statement is now out of date: Make final generates it again first.` : '');

  /** A unit's locks as shown: the report's, with the clicks not yet reloaded on top. */
  const locksOf = (r: ReportRow): Partial<Record<Stage, Lock>> => {
    const mine = { ...(r.locks ?? {}), ...(over[r.unitId] ?? {}) };
    return Object.fromEntries(Object.entries(mine).filter(([, v]) => !!v)) as Partial<Record<Stage, Lock>>;
  };
  const stateOf = (r: ReportRow, stage: Stage): CellState => (locksOf(r)[stage] ? 'locked' : stage === 'income' && (r.toConfirm ?? 0) > 0 ? 'blocked' : 'open');
  const isBusy = (r: ReportRow, stage: Stage) => busyCells.has(cellKey(r.unitId, stage));
  const finalOf = (r: ReportRow) => (r.ownerId ? o.owners[r.ownerId] : undefined);
  const mark = (id: string, stage: Stage, v: Lock | null) => setOver(x => ({ ...x, [id]: { ...x[id], [stage]: v } }));

  async function toggle(r: ReportRow, stage: Stage) {
    const name = STAGE_LABEL[stage];
    // A second click on this cell while its first is on its way is ignored, whatever it would have done.
    const key = cellKey(r.unitId, stage);
    if (pending.current.has(key)) return;
    if (finalOf(r)?.state === 'final') { toast({ tone: 'warning', title: `${personName(r.ownerName)}'s ${label} statement is final.`, body: 'Unlock the final first, in the Final column.' }); return; }
    const was = locksOf(r)[stage] ?? null;
    if (was && !o.may?.unlock) { toast({ tone: 'warning', title: `You can't unlock ${name}.`, body: 'Ask management for the Unlock a step permission.' }); return; }
    if (!was && !o.may?.lock[stage]) { toast({ tone: 'warning', title: `You can't lock ${name}.`, body: `Ask management for the ${PERMISSION[stage]} permission.` }); return; }
    if (!was && stateOf(r, stage) === 'blocked') {
      toast({ tone: 'warning', title: `${r.code} Revenue can't be locked yet.`, body: `${plural(r.toConfirm ?? 0, 'Airbnb reservation')} still to confirm. Confirm ${(r.toConfirm ?? 0) === 1 ? 'it' : 'them'} on the Airbnb reconciliation tab first.` });
      return;
    }
    if (!startClick(pending.current, key)) return;
    showPending();
    try {
      if (was) {
        mark(r.unitId, stage, null);
        try {
          const res = await api.post<{ unlocked: string[]; notLocked: string[]; regenerate: string[] }>('/owner-close/unlock', { month: o.month, stage, unitIds: [r.unitId] });
          if (res.regenerate?.length) toast({ tone: 'warning', title: `${r.code} ${name} unlocked.`, body: stale(res.regenerate) });
        } catch (err) { mark(r.unitId, stage, was); notifyFailure(err); }
      } else {
        mark(r.unitId, stage, { by: 'You', at: new Date().toISOString() });
        try {
          const res = await api.post<{ locked: string[]; already: string[]; notLockable: string[]; final: string[]; notReady: { unitId: string; reason: string }[] }>('/owner-close/lock', { month: o.month, stage, unitIds: [r.unitId] });
          if (!res.locked.length && !res.already.length) {
            mark(r.unitId, stage, null);
            toast({ tone: 'warning', title: `${r.code} ${name} was not locked.`,
              body: res.notReady[0]?.reason ?? (res.final.length ? `The ${label} statement is already final.` : `${name} does not apply to this unit.`) });
          }
        } catch (err) { mark(r.unitId, stage, null); notifyFailure(err); }
      }
    } finally {
      // Answered: the override now waits only for the reload below, where what the server stored takes over.
      pending.current.delete(key);
      showPending();
      o.reload();
    }
  }

  async function column(stage: Stage, action: 'lock' | 'unlock') {
    const name = STAGE_LABEL[stage];
    if (action === 'lock' && !o.may?.lock[stage]) { toast({ tone: 'warning', title: `You can't lock ${name}.`, body: `Ask management for the ${PERMISSION[stage]} permission.` }); return; }
    if (action === 'unlock' && !o.may?.unlock) { toast({ tone: 'warning', title: `You can't unlock ${name}.`, body: 'Ask management for the Unlock a step permission.' }); return; }
    setBusy(`${action}:${stage}`);
    try {
      if (action === 'lock') {
        const res = await api.post<{ locked: string[]; final: string[]; notReady: { unitId: string; reason: string }[] }>('/owner-close/lock', { month: o.month, stage, unitIds: 'all' });
        const left = [res.notReady.length ? `Not locked yet: ${names(res.notReady.map(x => x.unitId))} (Airbnb reservations still to confirm).` : '',
          res.final.length ? `${plural(res.final.length, 'unit')} not locked: the statement is already final.` : ''].filter(Boolean).join(' ');
        toast({ tone: left ? 'warning' : 'success', title: res.locked.length ? `${name}: ${plural(res.locked.length, 'unit')} locked.` : `${name}: nothing more to lock.`,
          body: [offReport(res.locked), left].filter(Boolean).join(' ') || undefined });
      } else {
        const res = await api.post<{ unlocked: string[]; refused: { unitId: string; label: string; problem: string }[]; regenerate?: string[] }>('/owner-close/unlock', { month: o.month, stage, unitIds: 'all' });
        // The units left locked by name: the report's code, or the name the statement uses for one not on the report.
        const kept = listed(res.refused.map(x => o.rows.find(r => r.unitId === x.unitId)?.code ?? x.label), 7);
        toast({ tone: res.refused.length ? 'warning' : 'success',
          title: res.unlocked.length ? `${name}: ${plural(res.unlocked.length, 'unit')} unlocked.` : res.refused.length ? `${name}: nothing unlocked.` : `${name}: nothing to unlock.`,
          body: [offReport(res.unlocked), res.refused.length ? `Still locked, their owner's statement is final: ${kept}. Unlock the final first.` : '', stale(res.regenerate)]
            .filter(Boolean).join(' ') || undefined });
      }
    } catch (err) {
      notifyFailure(err);
    } finally {
      setBusy(null);
      o.reload();
    }
  }

  /** Make final for these owners: their statements are generated again first (so nobody presses Generate after the
   *  locks), then made final. Returns how many were made final and why the others were not. */
  async function makeFinal(ownerIds: string[]): Promise<{ done: number; failed: string[] }> {
    // In batches (src/lib/finalBatches.ts): finalise takes at most 200 statements a request.
    let done = 0;
    const failed: string[] = [];
    for (const batch of finalBatches(ownerIds)) {
      const gen = await api.post<{ statements: { ownerId: string; id: string }[] }>('/statements/generate', { period: o.month, ownerIds: batch });
      const ids = gen.statements.filter(s => batch.includes(s.ownerId)).map(s => s.id);
      if (!ids.length) { failed.push('No statement was made: nothing in the month for these owners.'); continue; }
      const res = await api.post<{ finalised: number; failed: { id: string; reason: string }[] }>('/statements/finalise', { statementIds: ids });
      done += res.finalised;
      failed.push(...res.failed.map(f => f.reason));
    }
    return { done, failed };
  }

  async function finalOne(r: ReportRow) {
    const f = finalOf(r);
    if (!r.ownerId || !f || f.noStatement) return;
    if (f.state === 'final') { await unlockFinal(r, f); return; }
    if (!o.may?.makeFinal) { toast({ tone: 'warning', title: "You can't make a statement final.", body: 'Ask management for the Make final permission.' }); return; }
    if (!o.may.generate) { toast({ tone: 'warning', title: "You can't make a statement final.", body: NO_GENERATE }); return; }
    if (f.waiting) { toast({ tone: 'warning', title: `${personName(r.ownerName)} is not ready.`, body: `${f.waiting}.` }); return; }
    setBusy(`final:${r.ownerId}`);
    try {
      const res = await makeFinal([r.ownerId]);
      toast(res.done ? { tone: 'success', title: `${personName(r.ownerName)}'s ${label} statement is final.`, body: 'It can now be sent to the owner from Owner statements.' }
        : { tone: 'warning', title: 'Not made final.', body: res.failed[0] });
    } catch (err) { notifyFailure(err); } finally { setBusy(null); o.reload(); }
  }

  async function unlockFinal(r: ReportRow, f: OwnerFinal) {
    if (!o.may?.unlockFinal) { toast({ tone: 'warning', title: "You can't unlock a final statement.", body: 'Ask management for the Unlock final permission.' }); return; }
    if (f.transferring) { toast({ tone: 'warning', title: 'The payout is being transferred.', body: 'Unlock it once the transfer is paid or has failed.' }); return; }
    const reason = await o.ask({
      title: `Unlock the final ${label} statement?`,
      body: f.paid
        ? `${personName(r.ownerName)}. Already paid: the paid amount stays. The month is worked out again with today's contract, and any difference goes to the next open month as an owner adjustment.`
        : `${personName(r.ownerName)}. The statement goes back to draft so it can be worked out again. A payout not yet transferred is cancelled; sending the statement again makes a new one. Its locks stay.`,
      reason: { label: 'Why are you unlocking?', placeholder: 'Owner disputes the cleaning fee', maxLength: 500 },
      confirmLabel: 'Unlock final', danger: true,
    });
    if (reason === null) return;
    try {
      const res = await api.post<{ outcome: 'draft' | 'paid'; payoutCancelled?: boolean; posted?: { month: string; amount: number }[] }>('/statements/unlock-final', { statementId: f.statementId, reason });
      toast(res.outcome === 'paid'
        ? { tone: 'success', title: 'Statement unlocked.', body: res.posted?.length ? `The difference went to ${monthLabel(res.posted[0].month, { long: true })} as an owner adjustment.` : 'Nothing has changed since it was paid, so nothing was posted.' }
        : { tone: 'success', title: 'Statement back to draft.', body: `${res.payoutCancelled ? 'Its payout is cancelled. ' : ''}Make it final again once it is right.` });
    } catch (err) { notifyFailure(err); } finally { o.reload(); }
  }

  /** The Final column's Lock all: every owner whose units are all locked is made final. */
  async function finalAll() {
    if (!o.may?.makeFinal) { toast({ tone: 'warning', title: "You can't make statements final.", body: 'Ask management for the Make final permission.' }); return; }
    if (!o.may.generate) { toast({ tone: 'warning', title: "You can't make statements final.", body: NO_GENERATE }); return; }
    const all = Object.entries(o.owners).filter(([id]) => o.rows.some(r => r.ownerId === id));
    const ready = all.filter(([, f]) => f.state !== 'final' && !f.waiting && !f.noStatement).map(([id]) => id);
    // Who still waits, by name (spec: Lock all "names who still waits").
    const waiting = all.filter(([, f]) => f.state !== 'final' && !!f.waiting).map(([id]) => personName(o.rows.find(r => r.ownerId === id)?.ownerName ?? ''));
    const waits = waiting.length ? `Still waiting for locks: ${listed(waiting, 5)}.` : '';
    if (!ready.length) { toast({ tone: 'warning', title: 'No owner is ready to be made final.', body: waits || 'Every owner is already final.' }); return; }
    setBusy('final:all');
    try {
      const res = await makeFinal(ready);
      toast({ tone: res.failed.length || waiting.length ? 'warning' : 'success', title: `${plural(res.done, 'owner')} made final.`,
        body: [res.failed.length ? `${plural(res.failed.length, 'statement')} not made final: ${res.failed[0]}` : '', waits].filter(Boolean).join(' ') || undefined });
    } catch (err) { notifyFailure(err); } finally { setBusy(null); o.reload(); }
  }

  /** The Final column's Unlock all: every final statement of the month unlocked, with one reason. */
  async function unlockFinalAll() {
    if (!o.may?.unlockFinal) { toast({ tone: 'warning', title: "You can't unlock final statements.", body: 'Ask management for the Unlock final permission.' }); return; }
    const finals = Object.entries(o.owners).filter(([id, f]) => f.state === 'final' && f.statementId && o.rows.some(r => r.ownerId === id));
    if (!finals.length) { toast({ tone: 'warning', title: 'No statement is final yet.' }); return; }
    const reason = await o.ask({
      title: `Unlock every final ${label} statement?`,
      body: `${plural(finals.length, 'statement')}. Statements not paid go back to draft and their payouts are cancelled; a paid one keeps its payment and the difference goes to the next open month. The locks stay.`,
      reason: { label: 'Why are you unlocking them?', placeholder: 'The October misc rate was wrong', maxLength: 500 },
      confirmLabel: 'Unlock all finals', danger: true,
    });
    if (reason === null) return;
    setBusy('unfinal:all');
    let done = 0; const refused: string[] = [];
    for (const [ownerId, f] of finals) {
      if (f.transferring) { refused.push(ownerId); continue; }
      try { await api.post('/statements/unlock-final', { statementId: f.statementId, reason }); done++; } catch { refused.push(ownerId); }
    }
    const nameOf = (id: string) => personName(o.rows.find(r => r.ownerId === id)?.ownerName ?? id);
    toast({ tone: refused.length ? 'warning' : 'success', title: `${plural(done, 'statement')} unlocked.`,
      body: refused.length ? `Not unlocked (a transfer under way, or refused): ${refused.slice(0, 5).map(nameOf).join(', ')}${refused.length > 5 ? '…' : ''}.` : undefined });
    setBusy(null);
    o.reload();
  }

  return { locksOf, stateOf, isBusy, toggle, column, finalOne, finalAll, unlockFinalAll, busy, settle };
}

/** A unit's Final cell: on the owner's first row, the statement as a lock (Make final, or final by whom and when, a
 *  click unlocks it); what it waits for; on the owner's other rows, "Same owner". */
export function FinalCell({ r, f, first, onClick, busy }: { r: ReportRow; f?: OwnerFinal; first: boolean; onClick: () => void; busy: boolean }) {
  if (!f) return <span className="text-meta text-muted-ink">—</span>;
  if (!first) return (
    <span className={cx('flex items-center gap-2 text-meta', f.state === 'final' ? 'text-lock-ink' : 'text-muted-ink')}>
      {f.state === 'final' && <LockIcon className="text-lock" />}Same owner
    </span>
  );
  if (f.state === 'final') return (
    <button type="button" onClick={e => { e.stopPropagation(); onClick(); }} disabled={busy}
      title={f.transferring ? 'The payout is being transferred: unlock it once the transfer is paid or has failed.' : 'Final. Click to unlock it (it asks why).'}
      className="flex w-full items-center gap-2 bg-transparent border-0 p-0 font-sans text-copy text-left text-lock-ink cursor-pointer">
      <LockIcon className="text-lock" />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="font-semibold">Final{f.paid ? ' · paid' : ''}</span>
        <span className="text-meta">{[f.by, f.at ? dateShort(f.at) : null].filter(Boolean).join(' · ')}</span>
      </span>
    </button>
  );
  if (f.waiting) return <span className="block max-w-[260px] truncate text-meta text-muted-ink" title={f.waiting}>{f.waiting}</span>;
  // Nothing in the month goes on this owner's statement (a master lease with no owner adjustment): nothing to make final.
  if (f.noStatement) return <span className="text-meta text-muted-ink" title="Nothing this month goes on this owner's statement, so there is nothing to make final.">No statement this month</span>;
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onClick(); }} disabled={busy}
      title={`Every category of ${personName(r.ownerName)}'s units is locked. Click to make the statement final (it is generated again first).`}
      className="flex items-center gap-2 bg-transparent border-0 p-0 font-sans text-copy font-semibold text-lock-ink cursor-pointer">
      <LockIcon open className="text-lock" />{busy ? 'Making final…' : 'Make final'}
    </button>
  );
}

/** A Whole column cell's two buttons (third header row), side by side on one line so the row stays low and the table
 *  keeps its rows (chew, 13 Nov 2026). */
export function ColumnButtons({ onLock, onUnlock, busy, wide, name }: { onLock: () => void; onUnlock: () => void; busy: 'lock' | 'unlock' | null; wide?: boolean; name: string }) {
  const btn = 'bg-transparent border-0 p-0 font-sans text-meta cursor-pointer whitespace-nowrap hover:underline disabled:opacity-60 disabled:cursor-default';
  return (
    <span className="flex items-center justify-center gap-x-1.5 whitespace-nowrap">
      {wide && <span className="mr-1.5 text-meta font-semibold text-lock-ink">{name}</span>}
      <button type="button" className={cx(btn, 'font-semibold text-lock-ink')} disabled={!!busy} onClick={onLock} aria-label={`Lock all ${name}`}>{busy === 'lock' ? 'Locking…' : 'Lock all'}</button>
      <span aria-hidden className="text-meta text-faint">·</span>
      <button type="button" className={cx(btn, 'text-ink-2')} disabled={!!busy} onClick={onUnlock} aria-label={`Unlock all ${name}`}>{busy === 'unlock' ? 'Unlocking…' : 'Unlock all'}</button>
    </span>
  );
}
