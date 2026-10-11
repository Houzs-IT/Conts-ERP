import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { color } from '../theme';
import PageHeader from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { HistoryDisclosure } from '../components/RecordHistory';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { FileRow, FileDropRow } from '../components/Attachments';
import { Field } from '../components/Field';
import { MoneyInput, PercentInput, DateField } from '../components/inputs';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api, errorMessage } from '../lib/api';
import { rm, date, todayMyt, titleCase, plural } from '../lib/format';
import { Select } from '../components/Select';
import { TONE, cx } from '../lib/design-tokens';
import { useUrlState, usePhone, SearchBox } from './finance/listKit';
import { FilterBar } from '../components/FilterBar';
import { statusOf } from '../lib/status';

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
/** The stored-status key for each contract state (lib/status.ts, entity contract). */
const STATE_KEY: Record<ContractState, string> = { Active: 'active', 'Ending soon': 'ending_soon', Ended: 'ended' };

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
  c.model === 'grr' ? `GRR ${rm(c.grrAmount, { cents: false })}/mo` : `${c.managementFeePct}% operator share`;
const inDays = (d: number) => d === 0 ? 'ends today' : d > 0 ? `in ${d} ${d === 1 ? 'day' : 'days'}` : `${-d} ${d === -1 ? 'day' : 'days'} ago`;

type FilterKey = 'all' | 'soon' | 'active' | 'ended';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All contracts' },
  { key: 'soon', label: `Ending within ${ENDING_WINDOW_DAYS} days` },
  { key: 'active', label: 'Active' },
  { key: 'ended', label: 'Ended' },
];

export default function ContractsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/contracts', FALLBACK);
  const toast = useToast();
  const navigate = useNavigate();
  const phone = usePhone();
  const url = useUrlState();
  const [edits, setEdits] = useState<Record<string, Partial<Contract>>>({});
  const [modal, setModal] = useState<null | { mode: 'add' } | { mode: 'edit'; id: string }>(null);

  const filter: FilterKey = (['soon', 'active', 'ended'].includes(url.get('state')) ? url.get('state') : 'all') as FilterKey;
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
    // Until someone sorts by a column: the next to end first, open-ended after, the ones already ended last (latest first).
    const rank = (r: Contract) => {
      const d = daysUntil(expiryOf(r));
      return d === null ? [1, 0] : d < 0 ? [2, -d] : [0, d];
    };
    list.sort((a, b) => {
      const [ga, va] = rank(a), [gb, vb] = rank(b);
      return ga - gb || va - vb || a.ownerName.localeCompare(b.ownerName);
    });
    return list;
  }, [rows, filter, model, q]);

  const soonList = useMemo(() => rows.filter(r => stateOf(r) === 'Ending soon')
    .sort((a, b) => (daysUntil(expiryOf(a)) ?? 0) - (daysUntil(expiryOf(b)) ?? 0)), [rows]);
  const filtered = filter !== 'all' || !!model || !!q;
  const editing = modal?.mode === 'edit' ? rows.find(r => r.id === modal.id) ?? null : null;

  async function addContract(input: Omit<Contract, 'id'>) {
    try {
      await api.post('/contracts', input);
      toast({ tone: 'success', title: 'Contract added.', body: `Contract recorded for ${titleCase(input.ownerName)}.` });
      setModal(null); reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'Contract was not added.', body: errorMessage(e, 'Try again in a moment.') });
    }
  }
  async function saveEdit(id: string, input: Omit<Contract, 'id'>) {
    try {
      await api.patch(`/contracts/${id}`, input);
      setEdits(e => ({ ...e, [id]: { ...e[id], ...input } }));
      toast({ tone: 'success', title: 'Contract updated.', body: `Terms saved for ${titleCase(input.ownerName)}.` });
      setModal(null); reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'Contract was not updated.', body: errorMessage(e, 'Try again in a moment.') });
    }
  }

  const openOwner = (r: Contract) => { if (r.ownerId) navigate(`/owners/${encodeURIComponent(r.ownerId)}`); };
  const clearFilters = () => url.set({ state: null, model: null, q: null, page: null });

  const EndsCell = ({ r }: { r: Contract }) => {
    const exp = expiryOf(r), d = daysUntil(exp), s = stateOf(r);
    return (
      <div className="flex flex-col gap-[2px] min-w-0">
        <span className="text-copy tabular-nums whitespace-nowrap">{exp ? date(exp) : 'No end date'}</span>
        {d !== null && (s === 'Ending soon' || (d < 0 && d >= -ENDING_WINDOW_DAYS)) && (
          <span className="self-start"><StatusBadge tone={s === 'Ending soon' ? 'warning' : 'neutral'} label={inDays(d)} size="sm" /></span>
        )}
      </div>
    );
  };

  const columns: Column<Contract>[] = [
    { key: 'owner', label: 'Owner', value: r => r.ownerName, hideable: false, width: 210,
      render: r => (
        <span className="flex items-center gap-[10px] min-w-0">
          <Icon name="FileSignature" size="sm" color={color.textMuted} />
          <span className="flex flex-col gap-px min-w-0">
            <span className="text-copy font-medium truncate" title={r.ownerName}>{titleCase(r.ownerName)}</span>
            {r.offerLetter && (
              <span className="inline-flex items-center gap-1 text-caption text-muted-ink truncate">
                <Icon name="Paperclip" size="sm" color={color.faint} style={{ width: 12, height: 12 }} />{r.offerLetter}
              </span>
            )}
          </span>
        </span>
      ) },
    { key: 'units', label: 'Units', value: r => r.unitsLabel, width: 200 },
    { key: 'fee', label: 'Income model', value: r => feeLabel(r), width: 140, render: r => <span className="text-copy font-medium truncate block" title={feeLabel(r)}>{feeLabel(r)}</span> },
    { key: 'model', label: 'Model', value: r => (r.model === 'grr' ? 'Guaranteed rent' : 'Operator share'), hidden: true, width: 140, filter: { kind: 'select' } },
    { key: 'feePct', label: 'Operator share %', type: 'number', value: r => (r.model === 'management' ? r.managementFeePct : null), hidden: true, width: 120 },
    { key: 'grr', label: 'Guaranteed rent / month', type: 'money', value: r => (r.model === 'grr' ? r.grrAmount : null), hidden: true, width: 150 },
    { key: 'started', label: 'Started', type: 'date', value: r => r.startsOn, width: 110 },
    { key: 'ends', label: 'Ends', type: 'date', value: r => expiryOf(r), width: 140, title: 'The end date, or the renewal date when no end date is recorded.',
      render: r => <EndsCell r={r} /> },
    { key: 'endsOn', label: 'End date', type: 'date', value: r => r.endsOn ?? null, hidden: true },
    { key: 'renewsOn', label: 'Renews on', type: 'date', value: r => r.renewsOn, hidden: true },
    { key: 'offer', label: 'Offer letter', value: r => r.offerLetter, hidden: true, width: 180 },
    { key: 'status', label: 'Status', type: 'status', value: r => stateOf(r), status: r => statusOf('contract', STATE_KEY[stateOf(r)]), width: 120 },
    { key: 'edit', label: '', width: 56, noExport: true, sortable: false, filter: false, align: 'right',
      render: r => (
        <button
          onClick={e => { e.stopPropagation(); setModal({ mode: 'edit', id: r.id }); }}
          aria-label={`Edit contract for ${titleCase(r.ownerName)}`}
          className="grid place-items-center w-9 h-9 rounded-control bg-card border border-solid border-line cursor-pointer text-muted-ink"
        >
          <Icon name="Pencil" size="sm" />
        </button>
      ) },
  ];

  return (
    <>
      <PageHeader
        title="Contracts"
        sub={data ? `${plural(counts.all, 'management agreement')} · ${counts.soon} ending within ${ENDING_WINDOW_DAYS} days · ${counts.ended} ended` : 'Loading contracts…'}
        primary={<Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({ mode: 'add' })}>Add contract</Button>}
      />

      {soonList.length > 0 && filter !== 'soon' && (
        <div role="status" className={cx('flex items-start gap-3 flex-wrap py-[12px] px-[16px] rounded-control [border-left:3px_solid_var(--color-warning-line)]', TONE.warning.bg)}>
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

      <DataTable<Contract>
        id="contracts" phoneSort={false} columns={columns} rows={data ? visible : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload} onRowClick={openOwner}
        rowTone={r => { const st = stateOf(r); return st === 'Ending soon' ? 'warning' : st === 'Ended' ? 'muted' : null; }}
        viewParams={['state', 'model', 'q']} filtered={filtered} onClearFilters={clearFilters}
        noun={['contract', 'contracts']} exportName="contracts"
        empty={{ title: 'No contracts yet.', body: 'Add the first management agreement: owner, unit and how the owner is paid.', icon: 'FileSignature', action: { label: 'Add contract', onClick: () => setModal({ mode: 'add' }) } }}
        header={
          <div className="py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line)]">
            <FilterBar<FilterKey> label="Contract state" value={filter} onChange={k => url.set({ state: k === 'all' ? null : k, page: null })}
              views={FILTERS.map(f => ({ ...f, count: data ? counts[f.key] : undefined }))} />
          </div>
        }
        toolbar={<>
          <SearchBox className="flex-1 min-w-[200px]" label="Search contracts" placeholder="Search owner or unit" value={url.get('q')} onChange={v => url.set({ q: v || null, page: null })} />
          <Select className="flex-[1_1_160px] sm:flex-[0_1_180px]" label="Income model" value={model} onChange={v => url.set({ model: v || null, page: null })}
            options={[{ value: '', label: 'All income models' }, { value: 'management', label: 'Operator share' }, { value: 'grr', label: 'Guaranteed rent' }]} />
          {phone && (
            <Select className="flex-[1_1_160px]" label="Sort by" value={url.get('sort')} onChange={v => url.set({ sort: v || null, page: null })}
              options={[{ value: '', label: 'Sort: ending soonest' }, { value: 'owner:asc', label: 'Sort: owner A-Z' }, { value: 'started:desc', label: 'Sort: newest first' }]} />
          )}
          {filtered && <Button size="sm" variant="tertiary" onClick={clearFilters}>Clear filters</Button>}
        </>}
        footer={<div className="py-[11px] px-[22px] max-md:px-4 [border-top:1px_solid_var(--color-line-soft)] text-meta text-muted-ink">Ends shows the end date, or the renewal date when no end date is recorded.</div>}
        renderCard={r => {
          const state = stateOf(r);
          return (
            <span className="flex flex-col gap-1 min-w-0">
              <span className="flex items-start justify-between gap-2 w-full">
                <span className="text-copy font-medium min-w-0 [overflow-wrap:anywhere]">{titleCase(r.ownerName)}</span>
                <span className="shrink-0"><StatusBadge entity="contract" value={STATE_KEY[state]} size="sm" /></span>
              </span>
              <span className="text-meta text-muted-ink truncate w-full" title={r.unitsLabel}>{r.unitsLabel}</span>
              <span className="flex items-center justify-between gap-2 w-full flex-wrap">
                <span className="text-meta font-medium">{feeLabel(r)}</span>
                <EndsCell r={r} />
              </span>
            </span>
          );
        }}
      />

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
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
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
  return (
    <div className="flex flex-col gap-[7px]">
      <span className="text-meta font-medium text-muted-ink">Offer letter</span>
      {value
        ? <FileRow file={{ id: 'offer-letter', name: value, onRemove: () => onChange(null), removeLabel: 'Remove offer letter' }} />
        : <FileDropRow label="Add offer letter" hint="PDF, JPG or PNG" accept=".pdf,.jpg,.jpeg,.png" onPick={fl => onChange(fl[0]?.name ?? null)} />}
    </div>
  );
}

function ContractModal({ existing, onClose, onSubmit }: { existing?: Contract; onClose: () => void; onSubmit: (c: Omit<Contract, 'id'>) => void }) {
  const [ownerName, setOwnerName] = useState(existing?.ownerName ?? '');
  const [unitsLabel, setUnitsLabel] = useState(existing?.unitsLabel ?? '');
  const [model, setModel] = useState<FeeModel>(existing?.model ?? 'management');
  const [feePct, setFeePct] = useState<number | null>(existing ? existing.managementFeePct : 25);
  const [grrSen, setGrrSen] = useState<number | null>(existing && existing.grrAmount ? existing.grrAmount : null);
  const [startsOn, setStartsOn] = useState(existing?.startsOn ?? '');
  const [renewsOn, setRenewsOn] = useState(existing?.renewsOn ?? '');
  const [endsOn, setEndsOn] = useState(existing?.endsOn ?? '');
  const [offerLetter, setOfferLetter] = useState<string | null>(existing?.offerLetter ?? null);

  const canSubmit =
    ownerName.trim() !== '' && unitsLabel.trim() !== '' && startsOn !== '' &&
    (model === 'management' ? feePct != null : grrSen != null) && (!endsOn || endsOn >= startsOn);

  const submit = () => onSubmit({
    ownerName: ownerName.trim(),
    unitsLabel: unitsLabel.trim(),
    model,
    managementFeePct: model === 'management' ? feePct ?? 0 : 0,
    grrAmount: model === 'grr' ? grrSen ?? 0 : 0,
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
      <Select showLabel size="md" label="Income model" value={model} onChange={v => setModel(v as FeeModel)}
        options={[{ value: 'management', label: 'Operator share (% of income)' }, { value: 'grr', label: 'GRR — guaranteed monthly rent' }]} />
      {model === 'management'
        ? <PercentInput label="Operator share %" value={feePct} onChange={setFeePct} help="The Conts keeps this share; the owner receives the rest." />
        : <MoneyInput label="Guaranteed rent (RM / month)" placeholder="e.g. 3,500.00" valueSen={grrSen} onChangeSen={setGrrSen} help="The owner is paid this fixed amount regardless of occupancy." />}
      <div className="grid grid-cols-2 gap-3">
        <DateField label="Start date" value={startsOn} onChange={setStartsOn} />
        <DateField label="Ends on" value={endsOn} onChange={setEndsOn} min={startsOn || undefined} help={`Highlighted ${ENDING_WINDOW_DAYS} days before.`} />
      </div>
      <DateField label="Renews on" value={renewsOn} onChange={setRenewsOn} min={startsOn || undefined} help="Optional. Used as the end date when no end date is recorded." />
      <OfferLetterField value={offerLetter} onChange={setOfferLetter} />
      {existing && <HistoryDisclosure entity="owner_contracts" id={existing.id} />}
    </Modal>
  );
}
