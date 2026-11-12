import { useMemo, useState, type ReactNode } from 'react';
import { FormModal } from '../components/Modal';
import { useNavigate } from 'react-router-dom';
import { color } from '../theme';
import PageHeader from '../components/PageHeader';
import { StatRow, StatTile } from '../components/Metric';
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
import { rm, date, todayMyt, plural, personName } from '../lib/format';
import { Select } from '../components/Select';
import { useUrlState, usePhone, SearchBox } from './finance/listKit';
import { FilterBar } from '../components/FilterBar';
import { statusOf } from '../lib/status';
import { typeOptions, codeName, codeLabel, PURPOSES, PURPOSE_LABEL, type ContractCode, type UnitPurpose } from '../lib/revenueModel';
import { useContractTypes } from '../lib/useContractTypes';
import { CodeBadge } from './units/UnitExtras';
import { ExtendContractModal } from './units/ContractExtras';
import { CentreModal, Labeled, Select as FormSelect, mayEditUnits } from './units/shared';
import { useSession } from '../lib/session';
import { Drawer } from '../components/Dialog';
import { CloseButton } from '../components/CloseButton';
import ContractTab from './units/ContractTab';

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
  /** The staff's short code (PS, PS GRR, ...) and the units this record is in force on (0125). */
  contractCode?: ContractCode; units?: { id: string; label: string; purpose?: UnitPurpose }[]; termsLabel?: string;
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

/** A contract within this many days of its end date is flagged for a renewal conversation (staff, 17 Oct 2026: 90). */
const ENDING_WINDOW_DAYS = 90;
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
const feeLabel = (c: Contract) => c.termsLabel ?? (
  c.model === 'grr' ? `GRR ${rm(c.grrAmount)}/mo` : `${c.managementFeePct}% operator share`);
/** The purpose of the units the contract is in force on: one word when they agree, "Mixed" when not, null when none. */
const purposeOf = (c: Contract): UnitPurpose | 'mixed' | null => {
  const set = new Set((c.units ?? []).map(u => u.purpose ?? 'rental'));
  return set.size === 0 ? null : set.size > 1 ? 'mixed' : [...set][0];
};
const purposeLabel = (c: Contract): string | null => {
  const p = purposeOf(c);
  return p === 'mixed' ? 'Mixed' : p ? PURPOSE_LABEL[p] : null;
};
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
  const types = useContractTypes();
  const toast = useToast();
  const navigate = useNavigate();
  const phone = usePhone();
  const url = useUrlState();
  const [edits, setEdits] = useState<Record<string, Partial<Contract>>>({});
  const [modal, setModal] = useState<null | { mode: 'add' } | { mode: 'edit'; id: string } | { mode: 'extend'; contract: Contract | null } | { mode: 'terms'; contract: Contract }>(null);
  const { user } = useSession();
  const canEditUnits = mayEditUnits(user);
  const [savingPurpose, setSavingPurpose] = useState<string | null>(null);

  /** Sets the purpose of every unit the contract is in force on. A unit on the channels is refused by the server. */
  async function setPurpose(c: Contract, purpose: UnitPurpose): Promise<void> {
    const todo = (c.units ?? []).filter(u => (u.purpose ?? 'rental') !== purpose);
    if (!todo.length) return;
    setSavingPurpose(c.id);
    const results = await Promise.allSettled(todo.map(u => api.patch(`/units/${u.id}`, { purpose })));
    setSavingPurpose(null);
    const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [`${todo[i].label}: ${errorMessage(r.reason)}`] : []));
    if (failed.length < todo.length) toast({ tone: 'success', title: `${plural(todo.length - failed.length, 'unit')} now ${PURPOSE_LABEL[purpose].toLowerCase()}.`, body: personName(c.ownerName) });
    if (failed.length) toast({ tone: 'critical', title: 'Purpose not changed.', body: failed.join(' · ') });
    reload();
  }

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
      if (model && (r.contractCode ?? (r.model === 'grr' ? 'GRR' : 'PS')) !== model) return false;
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
      toast({ tone: 'success', title: 'Contract added.', body: `Contract recorded for ${personName(input.ownerName)}.` });
      setModal(null); reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'Contract was not added.', body: errorMessage(e, 'Try again in a moment.') });
    }
  }
  async function saveEdit(id: string, input: Omit<Contract, 'id'>) {
    try {
      await api.patch(`/contracts/${id}`, input);
      setEdits(e => ({ ...e, [id]: { ...e[id], ...input } }));
      toast({ tone: 'success', title: 'Contract updated.', body: `Terms saved for ${personName(input.ownerName)}.` });
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

  // A tap or Enter on a control inside a row must not also open the owner (the row's own click).
  const keepInRow = { onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(), onKeyDown: (e: { stopPropagation: () => void }) => e.stopPropagation() };
  const openTerms = (r: Contract) => setModal((r.units?.length ?? 0) > 0 ? { mode: 'terms', contract: r } : { mode: 'edit', id: r.id });
  /** The purpose dropdown (plain text for those who cannot edit units); `md` on phone cards for a full-size tap target. */
  const purposeControl = (r: Contract, size: 'sm' | 'md' = 'sm') => {
    const p = purposeOf(r);
    if (!p) return <span className="text-copy text-muted-ink">—</span>;
    if (!canEditUnits) return <span className="text-copy">{purposeLabel(r)}</span>;
    return (
      <span {...keepInRow} className="block min-w-0">
        <Select label={`Purpose of ${r.unitsLabel}`} size={size} value={p === 'mixed' ? '' : p} disabled={savingPurpose === r.id}
          onChange={v => { if (v) void setPurpose(r, v as UnitPurpose); }}
          options={[...(p === 'mixed' ? [{ value: '', label: 'Mixed' }] : []), ...PURPOSES.map(x => ({ value: x.value, label: x.label }))]} />
      </span>
    );
  };

  const columns: Column<Contract>[] = [
    { key: 'owner', label: 'Owner', value: r => personName(r.ownerName), hideable: false, width: 210,
      render: r => (
        <span className="flex items-center gap-[10px] min-w-0">
          <Icon name="FileSignature" size="sm" color={color.textMuted} />
          <span className="flex flex-col gap-px min-w-0">
            <span className="text-copy font-medium truncate" title={r.ownerName}>{personName(r.ownerName)}</span>
            {r.offerLetter && (
              <span className="inline-flex items-center gap-1 text-caption text-muted-ink truncate">
                <Icon name="Paperclip" size="sm" color={color.faint} style={{ width: 12, height: 12 }} />{r.offerLetter}
              </span>
            )}
          </span>
        </span>
      ) },
    { key: 'units', label: 'Units', value: r => r.unitsLabel, width: 200 },
    { key: 'code', label: 'Code', value: r => r.contractCode ?? null, width: 96, title: 'The contract type, from Units > Unit settings.',
      render: r => <CodeBadge code={r.contractCode} types={types} size="sm" />, filter: { kind: 'select', options: typeOptions(types) } },
    { key: 'fee', label: 'Income model', value: r => feeLabel(r), width: 140, render: r => <span className="text-copy font-medium truncate block" title={feeLabel(r)}>{feeLabel(r)}</span> },
    { key: 'model', label: 'Model', value: r => (r.model === 'grr' ? 'Guaranteed rent' : 'Operator share'), hidden: true, width: 140, filter: { kind: 'select' } },
    { key: 'feePct', label: 'Operator share %', type: 'number', value: r => (r.model === 'management' ? r.managementFeePct : null), hidden: true, width: 120 },
    { key: 'grr', label: 'Guaranteed rent / month', type: 'money', value: r => (r.model === 'grr' ? r.grrAmount : null), hidden: true, width: 150 },
    { key: 'started', label: 'Started', type: 'date', value: r => r.startsOn, width: 110 },
    { key: 'ends', label: 'Ends', type: 'date', value: r => expiryOf(r), width: 140, title: 'The end date, or the renewal date when no end date is recorded.',
      render: r => <EndsCell r={r} /> },
    // What the contract's units are for (staff, 4 Nov 2026: changed here, next to the package, not on the unit).
    { key: 'purpose', label: 'Purpose', value: r => purposeLabel(r), width: 140, title: 'Rental units are sold on the channels; showroom and warehouse units never are.',
      filter: { kind: 'select', options: [...PURPOSES.map(p => ({ value: p.label, label: p.label })), { value: 'Mixed', label: 'Mixed' }] },
      render: r => purposeControl(r) },
    { key: 'endsOn', label: 'End date', type: 'date', value: r => r.endsOn ?? null, hidden: true },
    { key: 'renewsOn', label: 'Renews on', type: 'date', value: r => r.renewsOn, hidden: true },
    { key: 'offer', label: 'Offer letter', value: r => r.offerLetter, hidden: true, width: 180 },
    { key: 'status', label: 'Status', type: 'status', value: r => stateOf(r), status: r => statusOf('contract', STATE_KEY[stateOf(r)]), width: 120 },
    { key: 'edit', label: '', width: 104, noExport: true, sortable: false, filter: false, align: 'right',
      render: r => (
        <span className="inline-flex items-center gap-1.5">
        {(r.units?.length ?? 0) > 0 && (
          <button onClick={e => { e.stopPropagation(); setModal({ mode: 'extend', contract: r }); }} aria-label={`Extend contract for ${personName(r.ownerName)}`} title="Extend or renew (needs the new agreement or memo)"
            className="grid place-items-center w-9 h-9 rounded-control bg-card border border-solid border-line cursor-pointer text-muted-ink">
            <Icon name="CalendarPlus" size="sm" />
          </button>
        )}
        <button
          // A contract in force on units opens the unit's own contract editor (package, terms, dates); the older form is
          // left for records not on any unit.
          onClick={e => { e.stopPropagation(); openTerms(r); }}
          aria-label={`Edit contract for ${personName(r.ownerName)}`}
          className="grid place-items-center w-9 h-9 rounded-control bg-card border border-solid border-line cursor-pointer text-muted-ink"
        >
          <Icon name="Pencil" size="sm" />
        </button>
        </span>
      ) },
  ];

  return (
    <>
      <PageHeader
        title="Contracts"
        sub={data ? `${plural(counts.all, 'management agreement')} · ${counts.soon} ending within ${ENDING_WINDOW_DAYS} days · ${counts.ended} ended` : 'Loading contracts…'}
        actions={<Button size="sm" variant="secondary" icon={<Icon name="CalendarPlus" size="sm" />} onClick={() => setModal({ mode: 'extend', contract: null })}>Extend a contract</Button>}
        primary={<Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({ mode: 'add' })}>Add contract</Button>}
      />

      {/* Contract states as four tiles: each is the count and the filter. "Ending soon" carries the next names. */}
      <StatRow cols={4}>
        {([
          { key: 'all', label: 'All contracts', hint: 'Management agreements', tone: undefined },
          { key: 'soon', label: `Ending within ${ENDING_WINDOW_DAYS} days`, hint: soonList.length ? soonList.slice(0, 2).map(r => `${personName(r.ownerName)} · ${inDays(daysUntil(expiryOf(r)) ?? 0)}`).join(' / ') : 'Nothing due', tone: 'warning' },
          { key: 'active', label: 'Active', hint: 'Running now', tone: 'success' },
          { key: 'ended', label: 'Ended', hint: 'Kept for history', tone: 'muted' },
        ] as { key: FilterKey; label: string; hint: string; tone?: 'warning' | 'success' | 'muted' }[]).map(f => {
          const on = filter === f.key;
          const n = data ? counts[f.key] : undefined;
          return (
            <StatTile key={f.key} label={f.label} value={n === undefined ? undefined : String(n)} hint={f.hint} active={on}
              tone={f.tone === 'warning' && n ? 'warning' : f.tone === 'success' ? 'success' : undefined}
              onClick={() => url.set({ state: f.key === 'all' ? null : f.key, page: null })} />
          );
        })}
      </StatRow>

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
            options={[{ value: '', label: 'All contract types' }, ...typeOptions(types)]} />
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
                <span className="text-copy font-medium min-w-0 [overflow-wrap:anywhere]">{personName(r.ownerName)}</span>
                <span className="shrink-0"><StatusBadge entity="contract" value={STATE_KEY[state]} size="sm" /></span>
              </span>
              <span className="text-meta text-muted-ink truncate w-full" title={r.unitsLabel}>{r.unitsLabel}</span>
              <span className="flex items-center justify-between gap-2 w-full flex-wrap">
                <span className="text-meta font-medium inline-flex items-center gap-1.5"><CodeBadge code={r.contractCode} types={types} size="sm" />{feeLabel(r)}</span>
                <EndsCell r={r} />
              </span>
              {/* Phones have no Purpose column or pencil: the same two actions, on the card. */}
              {purposeOf(r) && (
                <span className="flex items-center gap-2 w-full pt-2">
                  <span className="flex-1 min-w-0">{purposeControl(r, 'md')}</span>
                  <span {...keepInRow} className="shrink-0">
                    <Button size="md" variant="secondary" icon={<Icon name="Pencil" size="sm" />} onClick={() => openTerms(r)}
                      aria-label={`Edit contract for ${personName(r.ownerName)}`}>Edit contract</Button>
                  </span>
                </span>
              )}
            </span>
          );
        }}
      />

      {modal?.mode === 'add' && <ContractModal onClose={() => setModal(null)} onSubmit={addContract} />}
      {modal?.mode === 'extend' && <ExtendFromList contract={modal.contract} rows={rows} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal?.mode === 'edit' && editing && <ContractModal existing={editing} onClose={() => setModal(null)} onSubmit={input => saveEdit(editing.id, input)} />}
      {modal?.mode === 'terms' && <ContractDrawer contract={modal.contract} canEdit={canEditUnits} onClose={() => setModal(null)} onSaved={reload} />}
    </>
  );
}

/* ---------- form modal ---------- */
function Modal({ title, sub, onClose, onSubmit, submitLabel, canSubmit, children }: {
  title: string; sub?: string; onClose: () => void; onSubmit: () => void; submitLabel: string; canSubmit: boolean; children: ReactNode;
}) {
  return <FormModal title={title} sub={sub} onClose={onClose} onSubmit={onSubmit} submitLabel={submitLabel} canSubmit={canSubmit}>{children}</FormModal>;
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
      sub={existing ? `Update the terms for ${personName(existing.ownerName)}.` : 'Record a management agreement — owner, unit and how the owner is paid.'}
      onClose={onClose}
      submitLabel={existing ? 'Save changes' : 'Add contract'}
      canSubmit={canSubmit}
      onSubmit={submit}
    >
      {existing ? (
        <div className="py-[10px] px-3 rounded-control bg-page border border-solid border-line flex flex-col gap-[2px]">
          <span className="text-copy font-medium">{personName(existing.ownerName)}</span>
          <span className="text-meta text-muted-ink">{existing.unitsLabel}</span>
        </div>
      ) : (<>
        <Field label="Owner" placeholder="e.g. Lim Chee Keong" value={ownerName} onChange={e => setOwnerName(e.target.value)} />
        <Field label="Unit" placeholder="e.g. Vista Jaya One #A-12-03" value={unitsLabel} onChange={e => setUnitsLabel(e.target.value)} help="For multiple units, name the primary one; link the rest on the owner." />
      </>)}
      <Select showLabel size="md" label="Income model" value={model} onChange={v => setModel(v as FeeModel)}
        options={[{ value: 'management', label: 'Operator share (% of income)' }, ...(existing?.model === 'grr' ? [{ value: 'grr', label: 'GRR (no longer offered)' }] : [])]} />
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

/** The unit's Contract tab in a side drawer, so the package and terms are changed from the Contracts list. A contract
 *  in force on several units is changed one unit at a time, as on the unit (the server gives that unit its own copy). */
function ContractDrawer({ contract, canEdit, onClose, onSaved }: { contract: Contract; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const units = contract.units ?? [];
  const [unitId, setUnitId] = useState(units[0]?.id ?? '');
  return (
    <Drawer open onClose={onClose} dirty="typed" width={920} labelledBy="contract-drawer-title">
      <div className="flex items-start justify-between gap-3 px-6 pt-[22px] pb-3.5">
        <div className="flex flex-col gap-1 min-w-0">
          <h2 id="contract-drawer-title" className="m-0 text-[19px] font-semibold">Contract · {personName(contract.ownerName)}</h2>
          {units.length === 1 && <span className="text-meta text-muted-ink">{units[0].label}</span>}
        </div>
        <CloseButton onClick={onClose} />
      </div>
      {units.length > 1 && (
        <div className="px-6 pb-3 max-w-[420px]">
          <Labeled label="Unit"><FormSelect label="Unit" value={unitId} onChange={setUnitId} options={units.map(u => ({ value: u.id, label: u.label }))} /></Labeled>
        </div>
      )}
      <div className="px-6 pb-6 flex flex-col gap-4">
        {unitId && <ContractTab key={unitId} unitId={unitId} canEdit={canEdit} onSaved={onSaved} />}
      </div>
    </Drawer>
  );
}

/** Extend from the Contracts list: the unit is picked first when the contract (or the page) covers several. */
function ExtendFromList({ contract, rows, onClose, onSaved }: { contract: Contract | null; rows: Contract[]; onClose: () => void; onSaved: () => void }) {
  const types = useContractTypes();
  const choices = (contract ? [contract] : rows).flatMap(c => (c.units ?? []).map(u => ({ unit: u, c })));
  const [picked, setPicked] = useState(choices.length === 1 ? choices[0].unit.id : '');
  const [go, setGo] = useState(choices.length === 1);
  const chosen = choices.find(x => x.unit.id === picked);
  if (go && chosen) {
    return <ExtendContractModal unitId={chosen.unit.id} unitLabel={chosen.unit.label}
      current={{ code: chosen.c.contractCode ?? (chosen.c.model === 'grr' ? 'GRR' : 'PS'), termsLabel: feeLabel(chosen.c), startsOn: chosen.c.startsOn, endsOn: chosen.c.endsOn ?? chosen.c.renewsOn ?? null }}
      onClose={onClose} onSaved={onSaved} />;
  }
  return (
    <CentreModal title="Extend a contract" sub="Pick the unit whose contract runs on for a new period. The new agreement or memo is required." onClose={onClose}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" disabled={!chosen} disabledReason="Pick the unit" onClick={() => setGo(true)}>Next</Button></>}>
      <Labeled label="Unit">
        <FormSelect label="Unit" value={picked} onChange={setPicked}
          options={[{ value: '', label: choices.length ? 'Pick a unit' : 'No unit has a contract in force' }, ...choices.map(x => ({ value: x.unit.id, label: `${x.unit.label} · ${x.c.contractCode ? codeName(types, x.c.contractCode) : ''} · ${personName(x.c.ownerName)}` }))]} />
      </Labeled>
      {chosen && <p className="m-0 text-meta text-muted-ink">{codeLabel(types, chosen.c.contractCode ?? 'PS')}: {feeLabel(chosen.c)}{chosen.c.endsOn ? `, ends ${date(chosen.c.endsOn)}` : ''}.</p>}
    </CentreModal>
  );
}
