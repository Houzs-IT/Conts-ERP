import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
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
interface Percents { owner: number | null; cleaner: number | null }
interface CleaningPriceAccess { ready: boolean; mayPrice: boolean }

const PREVIEW_DELAY_MILLISECONDS = 400;

const changeText = (before: number | null, after: number | null): string => {
  const text = (sen: number | null) => (sen == null ? 'not set' : rm(sen));
  return before === after ? text(before) : `${text(before)} to ${text(after)}`;
};
const figuresText = ({ before, after }: { before: PriceFigures; after: PriceFigures }): string =>
  `Owner ${changeText(before.owner_price, after.owner_price)} · Cleaner ${changeText(before.internal_cost, after.internal_cost)}`;

/** Basic and Deep clean changed by a percent from a date: on every list price (All units) or on one unit. */
export function PercentSchedule({ unit, onSaved }: { unit: ScheduleUnit | null; onSaved: () => void }) {
  const toast = useToast();
  const access = useApi<CleaningPriceAccess>('/operations/service-prices?domain=cleaning');
  const [from, setFrom] = useState('');
  const [percents, setPercents] = useState<Record<string, Percents>>({});
  const [shouldIncludeOwn, setShouldIncludeOwn] = useState(true);
  const [previews, setPreviews] = useState<Record<string, RaisePreview>>({});
  const [previewError, setPreviewError] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const edits = CLEAN_KINDS.flatMap(([kind]) => {
    const { owner = null, cleaner = null } = percents[kind] ?? {};
    return owner || cleaner ? [{ cleanKind: kind as string, ownerPct: owner, internalPct: cleaner }] : [];
  });
  const requestOf = (edit: (typeof edits)[number], isDryRun: boolean) =>
    ({ ...edit, effectiveFrom: from, unitId: unit?.id ?? null, includeOwn: !unit && shouldIncludeOwn, dryRun: isDryRun });
  const editsKey = JSON.stringify([from, edits, shouldIncludeOwn, unit?.id]);

  useEffect(() => {
    setPreviews({});
    setPreviewError('');
    if (!from || !edits.length) return;
    let isStale = false;
    const timer = setTimeout(async () => {
      try {
        const answers = await Promise.all(edits.map(edit => api.post<RaisePreview>('/housekeeping/price-raise', requestOf(edit, true))));
        if (!isStale) setPreviews(Object.fromEntries(edits.map((edit, index) => [edit.cleanKind, answers[index]])));
      } catch (failure) {
        if (!isStale) setPreviewError(failure instanceof Error ? failure.message : 'The new prices could not be worked out.');
      }
    }, PREVIEW_DELAY_MILLISECONDS);
    return () => { isStale = true; clearTimeout(timer); };
  }, [editsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function schedule() {
    setIsBusy(true);
    try {
      for (const edit of edits) await api.post('/housekeeping/price-raise', requestOf(edit, false));
      toast({ tone: 'success', title: 'Change scheduled.', body: `${unit ? unit.label : 'All units'}: new prices for jobs from ${date(from)}. Earlier jobs keep theirs.` });
      onSaved();
    } catch (failure) { notifyFailure(failure); } finally { setIsBusy(false); }
  }

  if (access.error) return <p role="alert" className="m-0 text-copy text-critical">{access.error}</p>;
  if (!access.data) return <Skeleton height={220} />;
  if (!access.data.ready) return <p className="m-0 text-copy text-muted-ink">Service prices are not switched on yet.</p>;
  if (!access.data.mayPrice) return <p className="m-0 text-copy text-muted-ink">Only management schedules price changes.</p>;

  const isPreviewReady = edits.every(edit => previews[edit.cleanKind]);
  const hasSomethingToChange = edits.some(({ cleanKind }) => previews[cleanKind]?.unit || previews[cleanKind]?.list?.length || previews[cleanKind]?.ownPrices);
  return (
    <section className="flex flex-col gap-3">
      <DateField label="Applies from" value={from} min={todayMyt(1)} onChange={setFrom} />
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2.5">
        {CLEAN_KINDS.map(([kind, label]) => {
          const update = (change: Partial<Percents>) => setPercents(all => ({ ...all, [kind]: { owner: all[kind]?.owner ?? null, cleaner: all[kind]?.cleaner ?? null, ...change } }));
          return (
            <div key={kind} className="contents">
              <span className="col-span-2 text-copy font-medium">{label}</span>
              <PercentInput label="Owner is charged" placeholder="No change" min={-100} max={1000} value={percents[kind]?.owner ?? null} onChange={owner => update({ owner })} />
              <PercentInput label="Cleaner is paid" placeholder="No change" min={-100} max={1000} value={percents[kind]?.cleaner ?? null} onChange={cleaner => update({ cleaner })} />
            </div>
          );
        })}
      </div>
      <span className="text-meta text-muted-ink">
        {unit
          ? 'Worked out from this unit\'s price on that date and saved as its own price in RM, so it stops following later list changes.'
          : 'Worked out from each list price on that date (every bed size or layout) and saved in RM. Type -5 to lower by 5%.'}
      </span>
      {!unit && (
        <label className="flex items-center justify-between gap-3 min-h-11">
          <span className="text-copy">Also change units' own prices by the same percent</span>
          <Switch label="Also change units' own prices" checked={shouldIncludeOwn} onChange={setShouldIncludeOwn} />
        </label>
      )}

      {previewError && <p role="alert" className="m-0 text-copy text-critical">{previewError}</p>}
      {edits.length > 0 && from && isPreviewReady && (
        <div className="flex flex-col gap-2 p-3 rounded-control bg-muted">
          {edits.map(({ cleanKind }) => {
            const preview = previews[cleanKind];
            const name = CLEAN_KINDS.find(([kind]) => kind === cleanKind)?.[1] ?? cleanKind;
            return (
              <div key={cleanKind} className="flex flex-col gap-0.5">
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
        <Button size="sm" variant="primary" loading={isBusy} disabled={!from || !edits.length || !isPreviewReady || !hasSomethingToChange}
          disabledReason={!from ? 'Pick the date first.' : !edits.length ? 'Enter a percent first.' : !isPreviewReady ? 'Working out the new prices.' : 'No price in force on that date to change.'} onClick={() => void schedule()}>Schedule change</Button>
      </div>
    </section>
  );
}
