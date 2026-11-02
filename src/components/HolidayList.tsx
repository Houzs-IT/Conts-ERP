import { useMemo, useState } from 'react';
import { Button } from './Button';
import Icon from './Icon';
import { Modal } from './Modal';
import { Field } from './Field';
import { Select } from './Select';
import { DateField } from './inputs';
import { StatusBadge } from './StatusBadge';
import { StaleBanner, TableSkeleton } from './DataState';
import { EmptyState } from './States';
import { ConfirmDialog, type ConfirmSpec } from './ConfirmDialog';
import { useToast } from './Toast';
import { useApi } from '../lib/useApi';
import { api, notifyFailure, errorMessage } from '../lib/api';
import { date, plural, todayMyt, weekdayShort } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';

/* ------------------------------------------------------------------ *
 * The company's one public holiday list (migration 0202). Pricing sells
 * these nights at each unit's holiday price; leave and payroll count the
 * ones marked as a staff day off. Shown on Pricing > Public holidays and
 * on HR > Workers (Leave, Working hours): the same list in both places.
 * ------------------------------------------------------------------ */

export interface Holiday { id: string; date: string; name: string; state: string | null; staffDayOff: boolean; updatedAt: string }
interface Payload {
  data: Holiday[]; states: string[]; unitsByState: Record<string, number>; unmatchedUnits: number; totalUnits: number;
  years: number[]; builtinYears: number[]; canEdit: boolean;
}
interface LoadItem { date: string; name: string; check: boolean; status: 'new' | 'on_list' }
type Draft = { id?: string; date: string; name: string; state: string; staffDayOff: boolean };

const ALL = '';
const dayText = (d: string) => date(`${d}T12:00:00+08:00`);
const weekday = (d: string) => weekdayShort(`${d}T12:00:00+08:00`);
const queuedNote = (q: number | null | undefined) =>
  q == null ? 'The channels could not be updated; it is in History. Prices here are saved.' : q > 0 ? `${plural(q, 'connected unit')} sent their new prices to the channels.` : 'No connected unit needed new prices.';

/** The list for one year, with add, edit, remove and the Malaysia starting list. `compact` drops the explainer, for HR. */
export function HolidayList({ compact = false, onChanged }: { compact?: boolean; onChanged?: () => void }) {
  const toast = useToast();
  const thisYear = Number(todayMyt().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const { data, loading, error, reload } = useApi<Payload>(`/holidays?year=${year}`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [loadList, setLoadList] = useState<LoadItem[] | null>(null);

  const canEdit = !!data?.canEdit;
  const years = useMemo(() => [...new Set([thisYear, thisYear + 1, ...(data?.years ?? []), ...(data?.builtinYears ?? [])])].sort(), [data, thisYear]);
  const rows = data?.data ?? [];
  const unitsFor = (state: string | null) => (state === null ? data?.totalUnits ?? 0 : data?.unitsByState[state] ?? 0);
  const changed = () => { reload(); onChanged?.(); };

  async function save() {
    if (!draft) return;
    setBusy(true); setDraftError({});
    const body = { date: draft.date, name: draft.name, state: draft.state || null, staffDayOff: draft.staffDayOff };
    try {
      const r = draft.id ? await api.put<{ queued: number | null }>(`/holidays/${draft.id}`, body) : await api.post<{ queued: number | null }>('/holidays', body);
      toast({ tone: 'success', title: draft.id ? 'Holiday updated.' : `${draft.name} added.`, body: queuedNote(r.queued) });
      setDraft(null);
      if (draft.date.slice(0, 4) !== String(year)) setYear(Number(draft.date.slice(0, 4)));
      changed();
    } catch (e) {
      const fields = (e as { fields?: Record<string, string> })?.fields;
      if (fields) setDraftError(fields); else notifyFailure(e);
    } finally { setBusy(false); }
  }

  function remove(h: Holiday) {
    setConfirm({
      title: `Remove ${h.name}?`,
      body: `${dayText(h.date)} goes back to its weekend or nightly price on every channel${h.staffDayOff ? ', and leave and payroll stop counting it as a day off' : ''}. You can add it again any time.`,
      meta: `${h.state ?? 'All states'} · ${plural(unitsFor(h.state), 'unit')}`,
      confirmLabel: 'Remove holiday', busyLabel: 'Removing…', danger: true,
      onConfirm: async () => {
        try {
          const r = await api.del<{ queued: number | null }>(`/holidays/${h.id}`);
          toast({ tone: 'success', title: `${h.name} removed.`, body: queuedNote(r.queued) });
          changed();
        } catch (e) { notifyFailure(e); }
        setConfirm(null);
      },
    });
  }

  async function previewLoad() {
    setBusy(true);
    try { setLoadList((await api.post<{ items: LoadItem[] }>('/holidays/load', { year, dryRun: true })).items); }
    catch (e) { notifyFailure(e); }
    finally { setBusy(false); }
  }
  async function confirmLoad() {
    setBusy(true);
    try {
      const r = await api.post<{ added: number; queued: number | null }>('/holidays/load', { year });
      toast({ tone: 'success', title: `${plural(r.added, 'holiday')} added for ${year}.`, body: `Check each date against the official list. ${queuedNote(r.queued)}` });
      setLoadList(null); changed();
    } catch (e) { toast({ tone: 'critical', title: 'Holidays not added.', body: errorMessage(e, 'Try again in a moment.') }); }
    finally { setBusy(false); }
  }

  const fresh = loadList?.filter(i => i.status === 'new') ?? [];

  return (
    <div className="flex flex-col gap-4">
      {!compact && (
        <p className="m-0 text-copy text-muted-ink max-w-[760px]">
          One list for the whole company. Pricing sells these nights at each unit's holiday price (units follow their building's state);
          leave and payroll count the ones marked <span className="font-medium text-ink">Staff day off</span>. HR sees and edits the same list.
        </p>
      )}
      <div className="flex items-end gap-2 flex-wrap">
        <Select label="Year" showLabel className="w-[120px]" value={String(year)} onChange={v => setYear(Number(v))} options={years.map(y => ({ value: String(y), label: String(y) }))} />
        <span className="flex-1" />
        {canEdit && data?.builtinYears.includes(year) && (
          <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} loading={busy && !draft && !loadList} onClick={() => void previewLoad()}>
            Load Malaysia public holidays for {year}
          </Button>
        )}
        {canEdit && (
          <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />}
            onClick={() => { setDraftError({}); setDraft({ date: `${year}-01-01` < todayMyt() && year === thisYear ? todayMyt() : `${year}-01-01`, name: '', state: ALL, staffDayOff: true }); }}>
            Add holiday
          </Button>
        )}
      </div>

      {error && <StaleBanner message={error} onRetry={reload} />}
      {loading && !data ? <TableSkeleton rows={4} cols={3} /> : rows.length === 0 ? (
        <EmptyState bare title={`No public holidays for ${year} yet.`} body={canEdit ? (data?.builtinYears.includes(year) ? 'Load the Malaysia list to start from, or add them one by one.' : 'Add them one by one.') : 'Someone with Pricing or HR access adds them.'} />
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col border border-solid border-line rounded-card bg-card overflow-hidden" aria-label={`Public holidays ${year}`}>
          {rows.map(h => {
            const past = h.date < todayMyt();
            return (
              <li key={h.id} className={cx('flex items-center gap-3 px-4 py-2.5 min-h-[52px] [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0 flex-wrap', past && 'opacity-70')}>
                <span className="flex flex-col w-[112px] flex-none">
                  <span className="text-copy font-semibold tabular-nums">{dayText(h.date)}</span>
                  <span className="text-caption text-faint">{weekday(h.date)}{past ? ' · past' : ''}</span>
                </span>
                <span className="flex flex-col flex-1 min-w-[160px]">
                  <span className="text-copy">{h.name}</span>
                  <span className="text-caption text-muted-ink">{h.state ?? 'All states'} · {plural(unitsFor(h.state), 'unit')}</span>
                </span>
                <span className="flex items-center gap-2 flex-wrap">
                  {h.staffDayOff ? <StatusBadge tone="info" label="Staff day off" size="sm" /> : <StatusBadge tone="neutral" label="Pricing only" size="sm" />}
                  {canEdit && <>
                    <Button size="sm" variant="tertiary" aria-label={`Edit ${h.name}`} icon={<Icon name="Pencil" size="sm" />}
                      onClick={() => { setDraftError({}); setDraft({ id: h.id, date: h.date, name: h.name, state: h.state ?? ALL, staffDayOff: h.staffDayOff }); }}>Edit</Button>
                    <Button size="sm" variant="tertiary" aria-label={`Remove ${h.name}`} icon={<Icon name="Trash2" size="sm" />} onClick={() => remove(h)}>Remove</Button>
                  </>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {!!data?.unmatchedUnits && (
        <span className={cx('text-meta', TONE.warning.text)}>
          {plural(data.unmatchedUnits, 'unit')} sit in buildings whose state is not a Malaysian state we recognise; they take only the All states holidays. Fix the state on the building to change that.
        </span>
      )}

      {draft && (
        <Modal title={draft.id ? 'Edit holiday' : 'Add holiday'} sub="Units in the chosen state sell this night at their holiday price." onClose={() => !busy && setDraft(null)} width={520}
          footer={<>
            <Button size="sm" variant="secondary" onClick={() => setDraft(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} disabled={!draft.date || !draft.name.trim()} disabledReason="Pick a date and name the holiday." onClick={() => void save()}>
              {draft.id ? 'Save holiday' : 'Add holiday'}
            </Button>
          </>}>
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-[170px_1fr]">
              <DateField label="Date" value={draft.date} onChange={v => setDraft(d => d && ({ ...d, date: v }))} error={draftError.date} />
              <Field label="Name" value={draft.name} onChange={e => setDraft(d => d && ({ ...d, name: e.target.value }))} placeholder="Hari Merdeka" error={draftError.name} maxLength={80} />
            </div>
            <Select label="State" showLabel className="w-full" value={draft.state}
              onChange={v => setDraft(d => d && ({ ...d, state: v, staffDayOff: d.id ? d.staffDayOff : v === ALL }))}
              options={[{ value: ALL, label: `All states · ${plural(data?.totalUnits ?? 0, 'unit')}` }, ...(data?.states ?? []).map(s => ({ value: s, label: `${s} · ${plural(data?.unitsByState[s] ?? 0, 'unit')}` }))]} />
            {draftError.state && <span className={cx('text-meta', TONE.critical.text)}>{draftError.state}</span>}
            <label className="flex items-start gap-2.5 text-copy cursor-pointer">
              <input type="checkbox" className="w-4 h-4 mt-[3px] accent-ink" checked={draft.staffDayOff} onChange={e => setDraft(d => d && ({ ...d, staffDayOff: e.target.checked }))} />
              <span className="flex flex-col"><span>Staff day off</span><span className="text-meta text-muted-ink">Leave balances leave it out and payroll pays it at the holiday rate.</span></span>
            </label>
          </div>
        </Modal>
      )}

      {loadList && (
        <Modal title={`Malaysia public holidays ${year}`} sub="A starting list typed in from the national calendar. Check every date against the official gazette before relying on it." onClose={() => !busy && setLoadList(null)} width={600}
          footer={<>
            <Button size="sm" variant="secondary" onClick={() => setLoadList(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} disabled={!fresh.length} disabledReason="Every holiday on this list is already added." onClick={() => void confirmLoad()}>
              {fresh.length ? `Add ${plural(fresh.length, 'holiday')}` : 'Nothing to add'}
            </Button>
          </>}>
          <div className="flex flex-col gap-3">
            <span className={cx('text-meta rounded-control px-3 py-2 border border-solid', TONE.warning.text, TONE.warning.bg, TONE.warning.border)}>
              Starting list to check. Dates marked "Check date" follow the moon or the lunar calendar and can move by a day; replacement holidays and state holidays are not included.
            </span>
            <ul className="m-0 p-0 list-none flex flex-col">
              {loadList.map(i => (
                <li key={i.date} className="flex items-center gap-x-3 gap-y-1 py-2 min-h-10 text-copy flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
                  <span className="w-[96px] flex-none tabular-nums">{dayText(i.date)}</span>
                  <span className="flex-1 min-w-[150px]">{i.name}</span>
                  <span className="flex items-center gap-1.5 flex-none ml-auto">
                    {i.check && <StatusBadge tone="warning" label="Check date" size="sm" />}
                    {i.status === 'on_list' ? <StatusBadge tone="neutral" label="Already added" size="sm" /> : <StatusBadge tone="success" label="New" size="sm" />}
                  </span>
                </li>
              ))}
            </ul>
            <span className="text-meta text-muted-ink">Each is added for all states as a staff day off. Edit or remove any of them afterwards.</span>
          </div>
        </Modal>
      )}

      <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
