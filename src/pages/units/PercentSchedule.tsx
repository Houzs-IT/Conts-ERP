import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Segmented } from '../../components/Metric';
import { Skeleton } from '../../components/States';
import { Switch } from '../../components/Switch';
import { useToast } from '../../components/Toast';
import { DateField, PercentInput } from '../../components/inputs';
import { api, notifyFailure } from '../../lib/api';
import { date, plural, rm, todayMyt } from '../../lib/format';
import { useApi } from '../../lib/useApi';
import { CLEAN_KINDS } from './UnitCleaning';
import type { ScheduleUnit } from './ScheduledChanges';

export interface PriceFigures { owner_price: number | null; internal_cost: number | null }
export interface ListChange { key: string; label: string; before: PriceFigures; after: PriceFigures }
export interface RaisePreview { list?: ListChange[]; ownPrices?: number; unit?: { before: PriceFigures; after: PriceFigures } }
type Direction = 'increase' | 'decrease';
type AppliesTo = 'both' | 'owner' | 'cleaner';
type KindPreview = { preview: RaisePreview } | { problem: string };
interface CleaningPriceAccess { ready: boolean; mayPrice: boolean }

const PREVIEW_DELAY_MILLISECONDS = 400;

const changeText = (before: number | null, after: number | null): string => {
  const text = (sen: number | null) => (sen == null ? 'not set' : rm(sen));
  return before === after ? text(before) : `${text(before)} to ${text(after)}`;
};
const figuresText = ({ before, after }: { before: PriceFigures; after: PriceFigures }): string =>
  `Owner ${changeText(before.owner_price, after.owner_price)} · Cleaner ${changeText(before.internal_cost, after.internal_cost)}`;
const hasChange = (kindPreview: KindPreview | undefined): boolean =>
  !!kindPreview && 'preview' in kindPreview && !!(kindPreview.preview.unit || kindPreview.preview.list?.length || kindPreview.preview.ownPrices);

/** Basic and Deep clean up or down by one percent from a date: on every list price (All units) or on one unit. */
export function PercentSchedule({ unit, onSaved }: { unit: ScheduleUnit | null; onSaved: () => void }) {
  const toast = useToast();
  const access = useApi<CleaningPriceAccess>('/operations/service-prices?domain=cleaning');
  const [from, setFrom] = useState('');
  const [direction, setDirection] = useState<Direction>('increase');
  const [percent, setPercent] = useState<number | null>(null);
  const [appliesTo, setAppliesTo] = useState<AppliesTo>('both');
  const [shouldIncludeOwn, setShouldIncludeOwn] = useState(true);
  const [previews, setPreviews] = useState<Record<string, KindPreview>>({});
  const [isBusy, setIsBusy] = useState(false);

  const signedPercent = percent ? (direction === 'decrease' ? -percent : percent) : null;
  const requestOf = (cleanKind: string, isDryRun: boolean) => ({
    cleanKind, effectiveFrom: from, unitId: unit?.id ?? null, includeOwn: !unit && shouldIncludeOwn, dryRun: isDryRun,
    ownerPct: appliesTo === 'cleaner' ? null : signedPercent, internalPct: appliesTo === 'owner' ? null : signedPercent,
  });
  const requestKey = JSON.stringify([from, signedPercent, appliesTo, shouldIncludeOwn, unit?.id]);

  useEffect(() => {
    setPreviews({});
    if (!from || !signedPercent) return;
    let isStale = false;
    const timer = setTimeout(async () => {
      const answers = await Promise.allSettled(CLEAN_KINDS.map(([kind]) => api.post<RaisePreview>('/housekeeping/price-raise', requestOf(kind, true))));
      if (isStale) return;
      setPreviews(Object.fromEntries(CLEAN_KINDS.map(([kind], index) => {
        const answer = answers[index];
        return [kind, answer.status === 'fulfilled' ? { preview: answer.value }
          : { problem: answer.reason instanceof Error ? answer.reason.message : 'The new price could not be worked out.' }];
      })));
    }, PREVIEW_DELAY_MILLISECONDS);
    return () => { isStale = true; clearTimeout(timer); };
  }, [requestKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const kindsToSave = CLEAN_KINDS.filter(([kind]) => hasChange(previews[kind])).map(([kind]) => kind as string);
  const isPreviewReady = CLEAN_KINDS.every(([kind]) => previews[kind]);

  async function schedule() {
    setIsBusy(true);
    try {
      for (const kind of kindsToSave) await api.post('/housekeeping/price-raise', requestOf(kind, false));
      toast({ tone: 'success', title: 'Change scheduled.', body: `${unit ? unit.label : 'All units'}: new prices for jobs from ${date(from)}. Earlier jobs keep theirs.` });
      onSaved();
    } catch (failure) { notifyFailure(failure); } finally { setIsBusy(false); }
  }

  if (access.error) return <p role="alert" className="m-0 text-copy text-critical">{access.error}</p>;
  if (!access.data) return <Skeleton height={220} />;
  if (!access.data.ready) return <p className="m-0 text-copy text-muted-ink">Service prices are not switched on yet.</p>;
  if (!access.data.mayPrice) return <p className="m-0 text-copy text-muted-ink">Only management schedules price changes.</p>;

  return (
    <section className="flex flex-col gap-3">
      <DateField label="Applies from" value={from} min={todayMyt(1)} onChange={setFrom} />
      <Segmented<Direction> label="Increase or decrease" value={direction} onChange={setDirection}
        options={[{ key: 'increase', label: 'Increase' }, { key: 'decrease', label: 'Decrease' }]} />
      <PercentInput label="By how much" placeholder="0" min={0} max={direction === 'decrease' ? 100 : 1000} value={percent} onChange={setPercent} />
      <Segmented<AppliesTo> label="Apply to" value={appliesTo} onChange={setAppliesTo}
        options={[{ key: 'both', label: 'Both' }, { key: 'owner', label: 'Owner price' }, { key: 'cleaner', label: 'Cleaner pay' }]} />
      <span className="text-meta text-muted-ink">
        {unit
          ? 'Basic and Deep clean, worked out from this unit\'s price on that date. Saved as its own price, so it stops following later list changes.'
          : 'Basic and Deep clean, worked out from each list price on that date (every bed size or layout) and saved in RM.'}
      </span>
      {!unit && (
        <label className="flex items-center justify-between gap-3 min-h-11">
          <span className="text-copy">Also change units' own prices by the same percent</span>
          <Switch label="Also change units' own prices" checked={shouldIncludeOwn} onChange={setShouldIncludeOwn} />
        </label>
      )}

      {from && signedPercent && isPreviewReady && (
        <div className="flex flex-col gap-2 p-3 rounded-control bg-muted">
          {CLEAN_KINDS.map(([kind, name]) => {
            const kindPreview = previews[kind];
            if ('problem' in kindPreview) {
              return (
                <div key={kind} className="flex flex-col gap-0.5">
                  <span className="text-copy font-medium">{name}</span>
                  <span className="text-meta text-muted-ink">{kindPreview.problem} Not changed.</span>
                </div>
              );
            }
            const { preview } = kindPreview;
            return (
              <div key={kind} className="flex flex-col gap-0.5">
                <span className="text-copy font-medium">{name}</span>
                {preview.unit && <span className="text-meta text-muted-ink [overflow-wrap:anywhere]">{figuresText(preview.unit)}</span>}
                {preview.list?.map(change => (
                  <span key={change.key} className="text-meta text-muted-ink [overflow-wrap:anywhere]">{change.label}: {figuresText(change)}</span>
                ))}
                {preview.list && !preview.list.length && <span className="text-meta text-muted-ink">No list price in force on that date.</span>}
                {!unit && shouldIncludeOwn && <span className="text-meta text-muted-ink">{preview.ownPrices ? `${plural(preview.ownPrices, 'unit')} with their own price also change.` : 'No unit has its own price on that date.'}</span>}
              </div>
            );
          })}
        </div>
      )}
      <div>
        <Button size="sm" variant="primary" loading={isBusy} disabled={!from || !signedPercent || !isPreviewReady || !kindsToSave.length}
          disabledReason={!from ? 'Pick the date first.' : !signedPercent ? 'Type the percent first.' : !isPreviewReady ? 'Working out the new prices.' : 'No price in force on that date to change.'}
          onClick={() => void schedule()}>Schedule change</Button>
      </div>
    </section>
  );
}
