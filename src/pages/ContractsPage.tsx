import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { color } from '../theme';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { Field } from '../components/Field';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { rm, date, todayMyt, titleCase, plural } from '../lib/format';
import { Select } from '../components/Select';
import { EmptyState } from '../components/States';
import { TONE, cx } from '../lib/design-tokens';
import type { Tone } from '../lib/types';
import { useUrlState, usePhone, ListCard, SearchBox, Chip, STICKY_HEAD } from './finance/listKit';

type FeeModel = 'management' | 'grr';
type ContractState = 'Active' | 'Ending soon' | 'Ended';

interface Contract {
  id: string;
  ownerId?: string;
  ownerName: string;
  unitsLabel: string;
  unitCount?: number;
  model: FeeModel;
  managementFeePct: number;
  grrAmount: number; // integer sen, per month
  startsOn: string;
  renewsOn: string | null;
  endsOn?: string | null;
  offerLetter: string | null;
}
interface Payload { data: Contract[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'c1', ownerName: 'Lim Chee Keong', unitsLabel: 'Vista Jaya One #A-12-03', model: 'management', managementFeePct: 25, grrAmount: 0, startsOn: '2025-03-01', renewsOn: '2027-03-01', offerLetter: 'offer-letter-limck.pdf' },
    { id: 'c2', ownerName: 'Wong Mei Ling', unitsLabel: 'Arcoris #B-08-11', model: 'management', managementFeePct: 25, grrAmount: 0, startsOn: '2025-06-01', renewsOn: '2027-06-01', offerLetter: null },
    { id: 'c3', ownerName: 'Rajesh Kumar', unitsLabel: 'Tribeca #2207', model: 'grr', managementFeePct: 0, grrAmount: 350000, startsOn: '2024-11-01', renewsOn: '2026-11-01', offerLetter: 'offer-letter-rajesh.pdf' },
    { id: 'c4', ownerName: 'Chong Wei Han', unitsLabel: 'Scarletz #15-06', model: 'management', managementFeePct: 25, grrAmount: 0, startsOn: '2025-08-01', renewsOn: '2027-08-01', offerLetter: null },
  ],
};

/** A contract within this many days of its end date is flagged for a renewal conversation. */
const ENDING_WINDOW_DAYS = 60;
const STATE_TONE: Record<ContractState, Tone> = { Active: 'success', 'Ending soon': 'warning', Ended: 'neutral' };
const COLS_CLASS = 'grid-cols-[minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1.05fr)_minmax(96px,0.8fr)_40px]';

const DAY = 86_400_000;
/** The date the agreement stops: its end date, else its renewal date. */
const expiryOf = (c: Contract) => c.endsOn ?? c.renewsOn ?? null;
const daysUntil = (iso: string | null): number | null => {
  if (!iso) return null;
  const today = Date.parse(`${todayMyt()}T00:00:00Z`);
  return Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - today) / DAY);
};
const stateOf = (c: Contract): ContractState => {
  const d = daysUntil(expiryOf(c));
  if (d === null) return 'Active';
  if (d < 0) return 'Ended';
  if (d <= ENDING_WINDOW_DAYS) return 'Ending soon';
  return 'Active';
};
const feeLabel = (c: Contract) =>
  c.model === 'grr' ? `GRR ${rm(c.grrAmount, { cents: false })}/mo` : `${c.managementFeePct}% fee`;
const inDays = (d: number) => d === 0 ? 'ends today' : d > 0 ? `in ${d} ${d === 1 ? 'day' : 'days'}` : `${-d} ${d === -1 ? 'day' : 'days'} ago`;

type FilterKey = 'all' | 'soon' | 'active' | 'ended';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All contracts' },
  { key: 'soon', label: `Ending within ${ENDING_WINDOW_DAYS} days` },
  { key: 'active', label: 'Active' },
  { key: 'ended', label: 'Ended' },
];
type SortKey = 'expiry' | 'owner' | 'start';

export default function ContractsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/contracts', FALLBACK);
  const toast = useToast();
  const navigate = useNavigate();
  const phone = usePhone();
  const url = useUrlState();
  const [edits, setEdits] = useState<Record<string, Partial<Contract>>>({});
  const [modal, setModal] = useState<null | { mode: 'add' } | { mode: 'edit'; id: string }>(null);

  const filter: FilterKey = (['soon', 'active', 'ended'].includes(url.get('state')) ? url.get('state') : 'all') as FilterKey;
  const sort: SortKey = (['owner', 'start'].includes(url.get('sort')) ? url.get('sort') : 'expiry') as SortKey;
  const model = url.get('model');
  const q = url.get('q').toLowerCase();

  const rows = useMemo(
    () => (data?.data ?? []).map(c => ({ ...c, ...edits[c.id] })),
    [data, edits],
  );

  const counts = useMemo(() => {
    const c = { all: rows.length, soon: 0, active: 0, ended: 0 };
    rows.forEach(r => {
      const s = stateOf(r);
      if (s === 'Ending soon') c.soon++;
      else if (s === 'Ended') c.ended++;
      else c.active++;
    });
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const list = rows.filter(r => {
      const s = stateOf(r);
      if (filter === 'soon' && s !== 'Ending soon') return false;
      if (filter === 'active' && s !== 'Active') return false;
      if (filter === 'ended' && s !== 'Ended') return false;
      if (model && r.model !== model) return false;
      return !q || r.ownerName.toLowerCase().includes(q) || r.unitsLabel.toLowerCase().includes(q);
    });
    // Expiry order: the next to end first, open-ended after, the ones already ended last (latest first).
    const rank = (r: Contract) => {
      const d = daysUntil(expiryOf(r));
      return d === null ? [1, 0] : d < 0 ? [2, -d] : [0, d];
    };
    list.sort((a, b) => {
      if (sort === 'owner') return a.ownerName.localeCompare(b.ownerName);
      if (sort === 'start') return b.startsOn.localeCompare(a.startsOn);
      const [ga, va] = rank(a), [gb, vb] = rank(b);
      return ga - gb || va - vb || a.ownerName.localeCompare(b.ownerName);
    });
    return list;
  }, [rows, filter, model, q, sort]);

  const soonList = useMemo(() => rows.filter(r => stateOf(r) === 'Ending soon')
    .sort((a, b) => (daysUntil(expiryOf(a)) ?? 0) - (daysUntil(expiryOf(b)) ?? 0)), [rows]);
  const filtered = filter !== 'all' || !!model || !!q;
  const editing = modal?.mode === 'edit' ? rows.find(r => r.id === modal.id) ?? null : null;

  async function addContract(input: Omit<Contract, 'id'>) {
    try {
      await api.post('/contracts', input);
      toast({ tone: 'success', title: 'Contract added.', body: `Management agreement recorded for ${titleCase(input.ownerName)}.` });
      setModal(null); reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'Contract was not added.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    }
  }
  async function saveEdit(id: string, input: Omit<Contract, 'id'>) {
    try {
      await api.patch(`/contracts/${id}`, input);
      setEdits(e => ({ ...e, [id]: { ...e[id], ...input } }));
      toast({ tone: 'success', title: 'Contract updated.', body: `Terms saved for ${titleCase(input.ownerName)}.` });
      setModal(null); reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'Contract was not updated.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    }
  }

  const openOwner = (r: Contract) => { if (r.ownerId) navigate(`/owners/${encodeURIComponent(r.ownerId)}`); };

  const EndsCell = ({ r }: { r: Contract }) => {
    const exp = expiryOf(r), d = daysUntil(exp), s = stateOf(r);
    return (
      <div className="flex flex-col gap-[2px] min-w-0">
        <span className="text-copy tabular-nums whitespace-nowrap">{exp ? date(exp) : 'No end date'}</span>
        {d !== null && (s === 'Ending soon' || (d < 0 && d >= -ENDING_WINDOW_DAYS)) && (
          <span className="self-start"><Badge tone={s === 'Ending soon' ? 'warning' : 'neutral'} label={inDays(d)} size="sm" /></span>
        )}
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="Contracts"
        sub={`${plural(counts.all, 'management agreement')} · ${counts.soon} ending within ${ENDING_WINDOW_DAYS} days · ${counts.ended} ended`}
        primary={<Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({ mode: 'add' })}>Add contract</Button>}
      />

      {error && <StaleBanner message={`Showing the last agreements we have. ${error}`} onRetry={reload} />}

      {soonList.length > 0 && filter !== 'soon' && (
        <div role="status" className={cx('flex items-start gap-3 flex-wrap py-[12px] px-[16px] rounded-control [border-left:3px_solid_var(--color-warning-line,#E2B04A)]', TONE.warning.bg)}>
          <div className="flex flex-col gap-[3px] min-w-0 flex-1">
            <span className={cx('text-copy font-semibold', TONE.warning.text)}>
              {soonList.length} {soonList.length === 1 ? 'contract ends' : 'contracts end'} within {ENDING_WINDOW_DAYS} days
            </span>
            <span className="text-meta text-ink-2 [text-wrap:pretty]">
              {soonList.slice(0, 4).map(r => `${titleCase(r.ownerName)} (${inDays(daysUntil(expiryOf(r)) ?? 0)})`).join(' · ')}{soonList.length > 4 ? ` · and ${soonList.length - 4} more` : ''}
            </span>
          </div>
          <Button size="sm" variant="secondary" onClick={() => url.set({ state: 'soon' })}>Show them</Button>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <SearchBox className="flex-1 min-w-[200px]" label="Search contracts" placeholder="Search owner or unit" value={url.get('q')} onChange={v => url.set({ q: v || null })} />
        <Select className="flex-[1_1_160px] sm:flex-[0_1_180px]" label="Fee model" value={model} onChange={v => url.set({ model: v || null })}
          options={[{ value: '', label: 'All fee models' }, { value: 'management', label: 'Management fee' }, { value: 'grr', label: 'Guaranteed rent' }]} />
        <Select className="flex-[1_1_160px] sm:flex-[0_1_180px]" label="Sort by" value={sort === 'expiry' ? '' : sort} onChange={v => url.set({ sort: v || null })}
          options={[{ value: '', label: 'Sort: ending soonest' }, { value: 'owner', label: 'Sort: owner A-Z' }, { value: 'start', label: 'Sort: newest first' }]} />
        <div className={cx('flex gap-2', phone ? 'w-full overflow-x-auto pb-1' : 'flex-wrap')}>
          {FILTERS.map(f => (
            <Chip key={f.key} on={filter === f.key} onClick={() => url.set({ state: f.key === 'all' ? null : f.key })} count={counts[f.key]}>{f.label}</Chip>
          ))}
        </div>
        {filtered && <Button size="sm" variant="tertiary" onClick={() => url.set({ state: null, model: null, q: null })}>Clear filters</Button>}
      </div>

      <ListCard busy={loading && !!data}>
        {loading && !data ? (
          <TableSkeleton rows={8} cols={phone ? 2 : 7} />
        ) : visible.length === 0 ? (
          rows.length === 0
            ? <EmptyState bare icon="FileSignature" title="No contracts yet." body="Add the first management agreement: owner, unit and how the owner is paid." />
            : <EmptyState bare kind="filtered" title="No contracts match these filters." action={{ label: 'Clear filters', onClick: () => url.set({ state: null, model: null, q: null }) }} />
        ) : phone ? (
          <div>
            {visible.map(r => {
              const state = stateOf(r);
              return (
                <div key={r.id} role="button" tabIndex={0} onClick={() => openOwner(r)} onKeyDown={e => { if (e.key === 'Enter') openOwner(r); }}
                  className={cx('min-h-[64px] flex flex-col gap-1 py-3 pr-4 pl-[13px] [border-bottom:1px_solid_var(--color-line-soft)] cursor-pointer',
                    state === 'Ending soon' ? '[border-left:3px_solid_var(--color-warning-line,#E2B04A)]' : '[border-left:3px_solid_transparent]')}>
                  <span className="flex items-start justify-between gap-2 w-full">
                    <span className="text-copy font-medium min-w-0 [overflow-wrap:anywhere]">{titleCase(r.ownerName)}</span>
                    <span className="shrink-0"><Badge tone={STATE_TONE[state]} label={state} size="sm" /></span>
                  </span>
                  <span className="text-meta text-muted-ink truncate w-full" title={r.unitsLabel}>{r.unitsLabel}</span>
                  <span className="flex items-center justify-between gap-2 w-full flex-wrap">
                    <span className="text-meta font-medium">{feeLabel(r)}</span>
                    <EndsCell r={r} />
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div role="table" aria-label="Contracts">
            <div role="row" className={cx('grid', COLS_CLASS, 'gap-[14px] py-[9px] pr-[22px] pl-[19px] [border-left:3px_solid_transparent]', STICKY_HEAD)}>
              <div>Owner</div><div>Units</div><div>Fee model</div><div>Started</div><div>Ends</div><div>Status</div><div />
            </div>
            {visible.map(r => {
              const state = stateOf(r);
              const soon = state === 'Ending soon';
              return (
                <div role="row" key={r.id} onClick={() => openOwner(r)}
                  className={cx('grid', COLS_CLASS, 'gap-[14px] items-center min-h-[52px] py-[7px] pr-[22px] pl-[19px] [border-bottom:1px_solid_var(--color-line-soft)] cursor-pointer hover:bg-page',
                    soon ? '[border-left:3px_solid_var(--color-warning-line,#E2B04A)] bg-[color-mix(in_srgb,var(--color-warning-bg)_45%,white)]' : '[border-left:3px_solid_transparent]',
                    state === 'Ended' ? 'text-muted-ink' : '')}>
                  <div className="flex items-center gap-[10px] min-w-0">
                    <Icon name="FileSignature" size="sm" color={color.textMuted} />
                    <div className="flex flex-col gap-px min-w-0">
                      <span className="text-copy font-medium truncate" title={r.ownerName}>{titleCase(r.ownerName)}</span>
                      {r.offerLetter && (
                        <span className="inline-flex items-center gap-1 text-caption text-muted-ink truncate">
                          <Icon name="Paperclip" size="sm" color={color.faint} style={{ width: 12, height: 12 }} />{r.offerLetter}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-copy text-muted-ink truncate" title={r.unitsLabel}>{r.unitsLabel}</span>
                  <span className="text-copy font-medium truncate" title={feeLabel(r)}>{feeLabel(r)}</span>
                  <span className="text-copy tabular-nums whitespace-nowrap">{date(r.startsOn)}</span>
                  <EndsCell r={r} />
                  <div><Badge tone={STATE_TONE[state]} label={state} /></div>
                  <div className="flex justify-end">
                    <button
                      onClick={e => { e.stopPropagation(); setModal({ mode: 'edit', id: r.id }); }}
                      aria-label={`Edit contract for ${titleCase(r.ownerName)}`}
                      className="grid place-items-center w-9 h-9 rounded-control bg-card border border-solid border-line cursor-pointer text-muted-ink"
                    >
                      <Icon name="Pencil" size="sm" />
                    </button>
                  </div>
                </div>
              );
            })}
            <div className="py-[11px] px-[22px] bg-page text-meta text-muted-ink">
              {visible.length === rows.length ? plural(rows.length, 'contract') : `${visible.length} of ${plural(rows.length, 'contract')}`} · Ends shows the end date, or the renewal date when no end date is recorded
            </div>
          </div>
        )}
      </ListCard>

      {modal?.mode === 'add' && <ContractModal onClose={() => setModal(null)} onSubmit={addContract} />}
      {modal?.mode === 'edit' && editing && <ContractModal existing={editing} onClose={() => setModal(null)} onSubmit={input => saveEdit(editing.id, input)} />}
    </>
  );
}

/* ---------- form modal ---------- */
function Modal({ title, sub, onClose, onSubmit, submitLabel, canSubmit, children }: {
  title: string; sub?: string; onClose: () => void; onSubmit: () => void; submitLabel: string; canSubmit: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input,select')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div ref={ref} className="relative w-full max-w-[480px] max-h-[88vh] overflow-y-auto bg-card rounded-card [box-shadow:var(--shadow-overlay)]">
        <form onSubmit={e => { e.preventDefault(); if (canSubmit) onSubmit(); }}>
          <div className="pt-[22px] px-[22px] pb-[4px] flex flex-col gap-[5px]">
            <h2 className="m-0 text-title font-semibold">{title}</h2>
            {sub && <p className="m-0 text-copy text-muted-ink">{sub}</p>}
          </div>
          <div className="py-4 px-[22px] flex flex-col gap-[14px]">{children}</div>
          <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex justify-end gap-[9px]">
            <Button size="sm" variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button size="sm" variant="primary" type="submit" disabled={!canSubmit} disabledReason="Fill the required fields first">{submitLabel}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Placeholder upload — records the chosen filename locally; the real upload lands with the backend. */
function OfferLetterField({ value, onChange }: { value: string | null; onChange: (name: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-[7px]">
      <label className="text-meta font-medium text-muted-ink">Offer letter</label>
      <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => onChange(e.target.files?.[0]?.name ?? null)} />
      <div className="flex items-center gap-[10px]">
        <Button size="sm" variant="secondary" type="button" icon={<Icon name="Upload" size="sm" />} onClick={() => inputRef.current?.click()}>
          {value ? 'Replace file' : 'Upload offer letter'}
        </Button>
        <span className={cx('text-meta min-w-0 whitespace-nowrap overflow-hidden text-ellipsis', value ? 'text-ink' : 'text-faint')}>
          {value ?? 'No file selected'}
        </span>
        {value && (
          <button type="button" onClick={() => onChange(null)} aria-label="Remove offer letter" className="grid place-items-center bg-transparent border-none cursor-pointer text-muted-ink p-[2px]">
            <Icon name="X" size="sm" />
          </button>
        )}
      </div>
    </div>
  );
}

function ContractModal({ existing, onClose, onSubmit }: { existing?: Contract; onClose: () => void; onSubmit: (c: Omit<Contract, 'id'>) => void }) {
  const [ownerName, setOwnerName] = useState(existing?.ownerName ?? '');
  const [unitsLabel, setUnitsLabel] = useState(existing?.unitsLabel ?? '');
  const [model, setModel] = useState<FeeModel>(existing?.model ?? 'management');
  const [feePct, setFeePct] = useState(existing ? String(existing.managementFeePct) : '25');
  const [grr, setGrr] = useState(existing && existing.grrAmount ? String(existing.grrAmount / 100) : '');
  const [startsOn, setStartsOn] = useState(existing?.startsOn ?? '');
  const [renewsOn, setRenewsOn] = useState(existing?.renewsOn ?? '');
  const [endsOn, setEndsOn] = useState(existing?.endsOn ?? '');
  const [offerLetter, setOfferLetter] = useState<string | null>(existing?.offerLetter ?? null);

  const canSubmit =
    ownerName.trim() !== '' && unitsLabel.trim() !== '' && startsOn !== '' &&
    (model === 'management' ? feePct !== '' : grr !== '');

  const submit = () => onSubmit({
    ownerName: ownerName.trim(),
    unitsLabel: unitsLabel.trim(),
    model,
    managementFeePct: model === 'management' ? Number(feePct) || 0 : 0,
    grrAmount: model === 'grr' ? Math.round(Number(grr) * 100) : 0,
    startsOn,
    renewsOn: renewsOn || null,
    ...(endsOn ? { endsOn } : {}),
    offerLetter,
  });

  return (
    <Modal
      title={existing ? 'Edit management agreement' : 'Add contract'}
      sub={existing ? `Update the terms for ${titleCase(existing.ownerName)}.` : 'Record a management agreement — owner, unit and how the owner is paid.'}
      onClose={onClose}
      submitLabel={existing ? 'Save changes' : 'Add contract'}
      canSubmit={canSubmit}
      onSubmit={submit}
    >
      {existing ? (
        <div className="py-[10px] px-3 rounded-control bg-page border border-solid border-line flex flex-col gap-[2px]">
          <span className="text-copy font-medium">{titleCase(existing.ownerName)}</span>
          <span className="text-meta text-muted-ink">{existing.unitsLabel}</span>
        </div>
      ) : (<>
        <Field label="Owner" placeholder="e.g. Lim Chee Keong" value={ownerName} onChange={e => setOwnerName(e.target.value)} />
        <Field label="Unit" placeholder="e.g. Vista Jaya One #A-12-03" value={unitsLabel} onChange={e => setUnitsLabel(e.target.value)} help="For multiple units, name the primary one; link the rest on the owner." />
      </>)}
      <Select showLabel size="md" label="Fee model" value={model} onChange={v => setModel(v as FeeModel)}
        options={[{ value: 'management', label: 'Management fee (% of revenue)' }, { value: 'grr', label: 'GRR — guaranteed monthly rent' }]} />
      {model === 'management'
        ? <Field label="Management fee %" type="number" min={0} max={100} numeric value={feePct} onChange={e => setFeePct(e.target.value)} help="The Conts keeps this share; the owner receives the rest." />
        : <Field label="Guaranteed rent (RM / month)" type="number" min={0} numeric placeholder="e.g. 3500" value={grr} onChange={e => setGrr(e.target.value)} help="The owner is paid this fixed amount regardless of occupancy." />}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date" type="date" value={startsOn} onChange={e => setStartsOn(e.target.value)} />
        <Field label="Ends on" type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)} help={`Highlighted ${ENDING_WINDOW_DAYS} days before.`} />
      </div>
      <Field label="Renews on" type="date" value={renewsOn} onChange={e => setRenewsOn(e.target.value)} help="Optional. Used as the end date when no end date is recorded." />
      <OfferLetterField value={offerLetter} onChange={setOfferLetter} />
    </Modal>
  );
}
