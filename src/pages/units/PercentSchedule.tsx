import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Segmented } from '../../components/Metric';
import { Switch } from '../../components/Switch';
import { useToast } from '../../components/Toast';
import { DateField, PercentInput } from '../../components/inputs';
import { api, notifyFailure } from '../../lib/api';
import { date, plural, rm, todayMyt } from '../../lib/format';
import type { PriceKind, ScheduleUnit } from './PriceChangePanel';

export interface PriceFigures { owner_price: number | null; internal_cost: number | null }
export interface ListChange { key: string; label: string; before: PriceFigures; after: PriceFigures }
export interface RaisePreview { list?: ListChange[]; ownPrices?: number; unit?: { before: PriceFigures; after: PriceFigures }; backOn?: string | null }
export interface PriceTarget { key: string; name: string; request: { cleanKind: string } | { itemId: string } }
type Direction = 'increase' | 'decrease';
type AppliesTo = 'both' | 'owner' | 'internal';
type Duration = 'dates' | 'onward';
type TargetPreview = { preview: RaisePreview } | { problem: string };

const PREVIEW_DELAY_MILLISECONDS = 400;
const INTERNAL_LABEL: Record<PriceKind, string> = { cleaning: 'Cleaner pay', maintenance: 'Internal cost' };

const changeText = (before: number | null, after: number | null): string => {
  const text = (sen: number | null) => (sen == null ? 'not set' : rm(sen));
  return before === after ? text(before) : `${text(before)} to ${text(after)}`;
};
const hasChange = (targetPreview: TargetPreview | undefined): boolean =>
  !!targetPreview && 'preview' in targetPreview && !!(targetPreview.preview.unit || targetPreview.preview.list?.length || targetPreview.preview.ownPrices);

function scopeNote(kind: PriceKind, unit: ScheduleUnit | null, isUntilLastDay: boolean): string {
  if (kind === 'cleaning' && !isUntilLastDay) return unit
    ? "Basic and Deep clean, worked out from this unit's price on that date. Saved as its own price from then on, so it stops following later list changes."
    : 'Basic and Deep clean, worked out from each list price on that date (every bed size or layout) and saved in RM from then on.';
  if (kind === 'maintenance') return 'Worked out from each item\'s list price on that date and saved in RM. Jobs from that date use it.';
  return unit
    ? 'Basic and Deep clean, worked out from this unit\'s price on the first day. Only jobs from the first to the last day use it; after that the unit\'s price goes back.'
    : 'Basic and Deep clean, worked out from each list price on the first day (every bed size or layout). Only jobs from the first to the last day use it; after that the prices go back.';
}

/** Prices up or down by one percent from a date: cleaning for all units or one, maintenance for the chosen catalog items. */
export function PercentSchedule({ kind, targets, unit, onSaved }: { kind: PriceKind; targets: PriceTarget[]; unit: ScheduleUnit | null; onSaved: () => void }) {
  const toast = useToast();
  const [from, setFrom] = useState('');
  const [lastDay, setLastDay] = useState('');
  const [duration, setDuration] = useState<Duration>('dates');
  const [direction, setDirection] = useState<Direction>('increase');
  const [percent, setPercent] = useState<number | null>(null);
  const [appliesTo, setAppliesTo] = useState<AppliesTo>('both');
  const [shouldIncludeOwn, setShouldIncludeOwn] = useState(true);
  const [previews, setPreviews] = useState<Record<string, TargetPreview>>({});
  const [isBusy, setIsBusy] = useState(false);

  const canIncludeOwn = kind === 'cleaning' && !unit;
  const needsLastDay = kind === 'cleaning' && duration === 'dates';
  const isDateReady = !!from && (!needsLastDay || (!!lastDay && lastDay >= from));
  const internalLabel = INTERNAL_LABEL[kind];
  const signedPercent = percent ? (direction === 'decrease' ? -percent : percent) : null;
  const requestOf = ({ request }: PriceTarget, isDryRun: boolean) => ({
    ...request, effectiveFrom: from, effectiveTo: needsLastDay ? lastDay : null, unitId: unit?.id ?? null, includeOwn: canIncludeOwn && shouldIncludeOwn, dryRun: isDryRun,
    ownerPct: appliesTo === 'internal' ? null : signedPercent, internalPct: appliesTo === 'owner' ? null : signedPercent,
  });
  const requestKey = JSON.stringify([from, needsLastDay ? lastDay : null, signedPercent, appliesTo, shouldIncludeOwn, unit?.id, targets.map(({ key }) => key)]);

  useEffect(() => {
    setPreviews({});
    if (!isDateReady || !signedPercent) return;
    let isStale = false;
    const timer = setTimeout(async () => {
      const answers = await Promise.allSettled(targets.map(target => api.post<RaisePreview>('/housekeeping/price-raise', requestOf(target, true))));
      if (isStale) return;
      setPreviews(Object.fromEntries(targets.map(({ key }, index) => {
        const answer = answers[index];
        return [key, answer.status === 'fulfilled' ? { preview: answer.value }
          : { problem: answer.reason instanceof Error ? answer.reason.message : 'The new price could not be worked out.' }];
      })));
    }, PREVIEW_DELAY_MILLISECONDS);
    return () => { isStale = true; clearTimeout(timer); };
  }, [requestKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const targetsToSave = targets.filter(({ key }) => hasChange(previews[key]));
  const isPreviewReady = targets.every(({ key }) => previews[key]);
  const shownTargets = targets.filter(({ key }) => hasChange(previews[key]) || 'problem' in (previews[key] ?? {}));
  const unchangedCount = targets.length - shownTargets.length;
  const previewBackOn = Object.values(previews).flatMap(targetPreview => ('preview' in targetPreview && targetPreview.preview.backOn ? [targetPreview.preview.backOn] : []))[0];
  const figuresText = ({ before, after }: { before: PriceFigures; after: PriceFigures }): string =>
    `Owner ${changeText(before.owner_price, after.owner_price)} · ${internalLabel} ${changeText(before.internal_cost, after.internal_cost)}`;

  async function schedule() {
    setIsBusy(true);
    try {
      for (const target of targetsToSave) await api.post('/housekeeping/price-raise', requestOf(target, false));
      const scope = kind === 'maintenance' ? plural(targetsToSave.length, 'item') : unit ? unit.label : 'All units';
      const period = needsLastDay ? `jobs from ${date(from)} to ${date(lastDay)}, then the old prices come back` : `jobs from ${date(from)}`;
      toast({ tone: 'success', title: 'Change scheduled.', body: `${scope}: new prices for ${period}. Other jobs keep theirs.` });
      onSaved();
    } catch (failure) { notifyFailure(failure); } finally { setIsBusy(false); }
  }

  return (
    <section className="flex flex-col gap-3">
      {kind === 'cleaning' && <Segmented<Duration> label="How long" value={duration} onChange={setDuration}
        options={[{ key: 'dates', label: 'For set dates' }, { key: 'onward', label: 'From then on' }]} />}
      <div className={needsLastDay ? 'grid grid-cols-1 min-[420px]:grid-cols-2 gap-3' : 'contents'}>
        <DateField label={needsLastDay ? 'First day' : 'Applies from'} value={from} min={todayMyt(1)} onChange={setFrom} />
        {needsLastDay && <DateField label="Last day" value={lastDay} min={from || todayMyt(1)} onChange={setLastDay} />}
      </div>
      <Segmented<Direction> label="Increase or decrease" value={direction} onChange={setDirection}
        options={[{ key: 'increase', label: 'Increase' }, { key: 'decrease', label: 'Decrease' }]} />
      <PercentInput label="By how much" placeholder="0" min={0} max={direction === 'decrease' ? 100 : 1000} value={percent} onChange={setPercent} />
      <Segmented<AppliesTo> label="Apply to" value={appliesTo} onChange={setAppliesTo}
        options={[{ key: 'both', label: 'Both' }, { key: 'owner', label: 'Owner price' }, { key: 'internal', label: internalLabel }]} />
      <span className="text-meta text-muted-ink">{scopeNote(kind, unit, needsLastDay)}</span>
      {canIncludeOwn && (
        <label className="flex items-center justify-between gap-3 min-h-11">
          <span className="text-copy">Also change units' own prices by the same percent</span>
          <Switch label="Also change units' own prices" checked={shouldIncludeOwn} onChange={setShouldIncludeOwn} />
        </label>
      )}

      {isDateReady && signedPercent && isPreviewReady && (
        <div className="flex flex-col gap-2 p-3 rounded-control bg-muted">
          {shownTargets.map(({ key, name }) => {
            const targetPreview = previews[key];
            if ('problem' in targetPreview) {
              return (
                <div key={key} className="flex flex-col gap-0.5">
                  <span className="text-copy font-medium [overflow-wrap:anywhere]">{name}</span>
                  <span className="text-meta text-muted-ink">{targetPreview.problem} Not changed.</span>
                </div>
              );
            }
            const { preview } = targetPreview;
            return (
              <div key={key} className="flex flex-col gap-0.5">
                <span className="text-copy font-medium [overflow-wrap:anywhere]">{name}</span>
                {preview.unit && <span className="text-meta text-muted-ink [overflow-wrap:anywhere]">{figuresText(preview.unit)}</span>}
                {preview.list?.map(change => (
                  <span key={change.key} className="text-meta text-muted-ink [overflow-wrap:anywhere]">{change.label}: {figuresText(change)}</span>
                ))}
                {canIncludeOwn && shouldIncludeOwn && <span className="text-meta text-muted-ink">{preview.ownPrices ? `${plural(preview.ownPrices, 'unit')} with their own price also change.` : 'No unit has its own price on that date.'}</span>}
              </div>
            );
          })}
          {needsLastDay && targetsToSave.length > 0 && <span className="text-meta text-muted-ink">From {date(previewBackOn ?? '')} the prices go back to what they were.</span>}
          {unchangedCount > 0 && <span className="text-meta text-muted-ink">{plural(unchangedCount, kind === 'maintenance' ? 'item' : 'clean type')} with no price on that date, not changed.</span>}
        </div>
      )}
      <div>
        <Button size="sm" variant="primary" loading={isBusy} disabled={!isDateReady || !signedPercent || !isPreviewReady || !targetsToSave.length}
          disabledReason={!from ? 'Pick the date first.' : !isDateReady ? 'Pick the last day, on or after the first day.' : !signedPercent ? 'Type the percent first.' : !isPreviewReady ? 'Working out the new prices.' : 'No price in force on that date to change.'}
          onClick={() => void schedule()}>Schedule change</Button>
      </div>
    </section>
  );
}
