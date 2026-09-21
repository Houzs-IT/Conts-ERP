import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { color } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { Field } from '../components/Field';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { rm } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';
import type { Tone } from '../lib/types';

type FeeModel = 'management' | 'grr';
type ContractState = 'Active' | 'Renewing soon' | 'Ended';

interface Contract {
  id: string;
  ownerName: string;
  unitsLabel: string;
  model: FeeModel;
  managementFeePct: number;
  grrAmount: number; // integer sen, per month
  startsOn: string;
  renewsOn: string | null;
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
    { id: 'c5', ownerName: 'Nur Aisyah', unitsLabel: 'The Establishment #A-21-02', model: 'management', managementFeePct: 25, grrAmount: 0, startsOn: '2026-09-04', renewsOn: '2028-09-04', offerLetter: null },
    { id: 'c6', ownerName: 'Tan Boon Huat', unitsLabel: 'Sentral Suites #C-31-14', model: 'management', managementFeePct: 25, grrAmount: 0, startsOn: '2025-01-15', renewsOn: '2027-01-15', offerLetter: null },
  ],
};

const RENEWAL_WINDOW_DAYS = 180; // "within ~6 months"
const STATE_TONE: Record<ContractState, Tone> = { Active: 'success', 'Renewing soon': 'warning', Ended: 'neutral' };
// Shared grid template for the table header and every row. Mirrors the former
// COLS inline value as a Tailwind arbitrary grid-template-columns (spaces -> _).
const COLS_CLASS = 'grid-cols-[minmax(150px,1.3fr)_minmax(180px,1.6fr)_minmax(130px,1fr)_minmax(110px,0.9fr)_minmax(150px,1.2fr)_minmax(96px,0.8fr)_72px]';

const DAY = 86_400_000;
const daysUntil = (iso: string | null): number | null => {
  if (!iso) return null;
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(iso).getTime();
  return Math.ceil((target - today) / DAY);
};
const stateOf = (renewsOn: string | null): ContractState => {
  const d = daysUntil(renewsOn);
  if (d === null) return 'Active';
  if (d < 0) return 'Ended';
  if (d <= RENEWAL_WINDOW_DAYS) return 'Renewing soon';
  return 'Active';
};
const feeLabel = (c: Contract) =>
  c.model === 'grr' ? `GRR ${rm(c.grrAmount, { cents: false })}/mo` : `${c.managementFeePct}% fee`;

type FilterKey = 'all' | 'soon' | 'active' | 'ended';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All contracts' },
  { key: 'soon', label: 'Renewing soon' },
  { key: 'active', label: 'Active' },
  { key: 'ended', label: 'Ended' },
];

export default function ContractsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/contracts', FALLBACK);
  const toast = useToast();
  const [edits, setEdits] = useState<Record<string, Partial<Contract>>>({});
  const [filter, setFilter] = useState<FilterKey>('all');
  const [modal, setModal] = useState<null | { mode: 'add' } | { mode: 'edit'; id: string }>(null);

  const rows = useMemo(
    () => (data?.data ?? []).map(c => ({ ...c, ...edits[c.id] })),
    [data, edits],
  );

  const counts = useMemo(() => {
    const c = { all: rows.length, soon: 0, active: 0, ended: 0 };
    rows.forEach(r => {
      const s = stateOf(r.renewsOn);
      if (s === 'Renewing soon') c.soon++;
      else if (s === 'Ended') c.ended++;
      else c.active++;
    });
    return c;
  }, [rows]);

  const visible = useMemo(() => rows.filter(r => {
    if (filter === 'all') return true;
    const s = stateOf(r.renewsOn);
    if (filter === 'soon') return s === 'Renewing soon';
    if (filter === 'active') return s === 'Active';
    return s === 'Ended';
  }), [rows, filter]);

  const editing = modal?.mode === 'edit' ? rows.find(r => r.id === modal.id) ?? null : null;

  async function addContract(input: Omit<Contract, 'id'>) {
    try {
      await api.post('/contracts', input);
      toast({ tone: 'success', title: 'Contract added.', body: `Management agreement recorded for ${input.ownerName}.` });
      setModal(null); reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'Contract was not added.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    }
  }
  async function saveEdit(id: string, input: Omit<Contract, 'id'>) {
    try {
      await api.patch(`/contracts/${id}`, input);
      setEdits(e => ({ ...e, [id]: { ...e[id], ...input } }));
      toast({ tone: 'success', title: 'Contract updated.', body: `Terms saved for ${input.ownerName}.` });
      setModal(null); reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'Contract was not updated.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    }
  }

  return (
    <>
      <PageHeader
        title="Contracts"
        sub={`${counts.all} management agreements · ${counts.soon} renewing within 6 months`}
        right={<Button variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({ mode: 'add' })}>Add contract</Button>}
      />

      {error && <StaleBanner message={`Showing the last agreements we have. ${error}`} onRetry={reload} />}

      <div className="flex gap-2 flex-wrap mb-[14px]">
        {FILTERS.map(f => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={active}
              className={cx(
                'inline-flex items-center gap-[7px] h-[34px] px-[13px] py-0 rounded-full cursor-pointer font-sans text-[12.5px] font-medium border border-solid [transition:background_var(--motion-fast)_var(--ease-out)]',
                active ? 'bg-black text-white border-black' : 'bg-card text-muted-ink border-line',
              )}
            >
              {f.label}
              <span className={cx(
                'text-[11px] font-semibold py-px px-[6px] rounded-full tabular-nums',
                active ? 'bg-[rgba(255,255,255,0.18)] text-white' : 'bg-muted text-muted-ink',
              )}>{counts[f.key]}</span>
            </button>
          );
        })}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <div className="min-w-[940px]">
            <div className={cx('grid', COLS_CLASS, 'gap-[14px] py-[9px] px-[22px] bg-muted [border-bottom:1px_solid_var(--color-line)] text-[12px] font-semibold text-muted-ink')}>
              <div>Owner</div><div>Units</div><div>Fee model</div><div>Started</div><div>Renews</div><div>Status</div><div className="text-right">Edit</div>
            </div>

            {loading && rows.length === 0 ? (
              <TableSkeleton rows={6} cols={7} />
            ) : visible.length === 0 ? (
              <div className="py-[48px] px-[22px] text-center flex flex-col items-center gap-3">
                <div className="text-[13px] text-muted-ink">
                  {rows.length === 0 ? 'No contracts yet. Add your first management agreement.' : 'No contracts match these filters.'}
                </div>
                {rows.length === 0
                  ? <Button size="sm" variant="secondary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({ mode: 'add' })}>Add contract</Button>
                  : <Button size="sm" variant="secondary" onClick={() => setFilter('all')}>Clear filters</Button>}
              </div>
            ) : visible.map(r => {
              const state = stateOf(r.renewsOn);
              const days = daysUntil(r.renewsOn);
              const soon = state === 'Renewing soon';
              return (
                <div key={r.id} className={cx('grid', COLS_CLASS, 'gap-[14px] items-center min-h-[54px] pt-[9px] pr-[22px] pb-[9px] pl-[19px] [border-bottom:1px_solid_var(--color-line-soft)]', soon ? '[border-left:3px_solid_var(--color-warning-line)]' : '[border-left:3px_solid_transparent]')}>
                  <div className="flex items-center gap-[10px] min-w-0">
                    <Icon name="FileSignature" size="sm" color={color.textMuted} />
                    <div className="flex flex-col gap-px min-w-0">
                      <span className="text-[13.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{r.ownerName}</span>
                      {r.offerLetter && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">
                          <Icon name="Paperclip" size="sm" color={color.faint} style={{ width: 12, height: 12 }} />{r.offerLetter}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-[12.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{r.unitsLabel}</span>
                  <span className="text-[12.5px] font-medium">{feeLabel(r)}</span>
                  <span className="text-[12.5px]">{r.startsOn}</span>
                  <div className="flex flex-col gap-[2px]">
                    <span className="text-[12.5px]">{r.renewsOn ?? '—'}</span>
                    {days !== null && days >= 0 && days <= RENEWAL_WINDOW_DAYS && (
                      <span className={cx('self-start text-[11px] font-semibold py-px px-[7px] rounded-full', TONE.warning.bg, TONE.warning.text)}>
                        {days === 0 ? 'renews today' : `in ${days} ${days === 1 ? 'day' : 'days'}`}
                      </span>
                    )}
                  </div>
                  <div><Badge tone={STATE_TONE[state]} label={state} /></div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => setModal({ mode: 'edit', id: r.id })}
                      aria-label={`Edit contract for ${r.ownerName}`}
                      className="grid place-items-center w-[30px] h-[30px] rounded-control bg-card border border-solid border-line cursor-pointer text-muted-ink"
                    >
                      <Icon name="Pencil" size="sm" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

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
            <h2 className="m-0 text-[18px] font-semibold">{title}</h2>
            {sub && <p className="m-0 text-[13px] text-muted-ink">{sub}</p>}
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

const selectClass = 'h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none';
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex flex-col gap-[7px]">
      <label className="text-[12px] font-medium text-muted-ink">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className={selectClass}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </div>
  );
}

/** Placeholder upload — records the chosen filename locally; the real upload lands with the backend. */
function OfferLetterField({ value, onChange }: { value: string | null; onChange: (name: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-[7px]">
      <label className="text-[12px] font-medium text-muted-ink">Offer letter</label>
      <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => onChange(e.target.files?.[0]?.name ?? null)} />
      <div className="flex items-center gap-[10px]">
        <Button size="sm" variant="secondary" type="button" icon={<Icon name="Upload" size="sm" />} onClick={() => inputRef.current?.click()}>
          {value ? 'Replace file' : 'Upload offer letter'}
        </Button>
        <span className={cx('text-[12px] min-w-0 whitespace-nowrap overflow-hidden text-ellipsis', value ? 'text-ink' : 'text-faint')}>
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
    offerLetter,
  });

  return (
    <Modal
      title={existing ? 'Edit management agreement' : 'Add contract'}
      sub={existing ? `Update the terms for ${existing.ownerName}.` : 'Record a management agreement — owner, unit and how the owner is paid.'}
      onClose={onClose}
      submitLabel={existing ? 'Save changes' : 'Add contract'}
      canSubmit={canSubmit}
      onSubmit={submit}
    >
      <Field label="Owner" placeholder="e.g. Lim Chee Keong" value={ownerName} onChange={e => setOwnerName(e.target.value)} />
      <Field label="Unit" placeholder="e.g. Vista Jaya One #A-12-03" value={unitsLabel} onChange={e => setUnitsLabel(e.target.value)} help="For multiple units, name the primary one; link the rest on the owner." />
      <SelectField label="Fee model" value={model} onChange={v => setModel(v as FeeModel)}
        options={[{ value: 'management', label: 'Management fee (% of revenue)' }, { value: 'grr', label: 'GRR — guaranteed monthly rent' }]} />
      {model === 'management'
        ? <Field label="Management fee %" type="number" min={0} max={100} numeric value={feePct} onChange={e => setFeePct(e.target.value)} help="The Conts keeps this share; the owner receives the rest." />
        : <Field label="Guaranteed rent (RM / month)" type="number" min={0} numeric placeholder="e.g. 3500" value={grr} onChange={e => setGrr(e.target.value)} help="The owner is paid this fixed amount regardless of occupancy." />}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date" type="date" value={startsOn} onChange={e => setStartsOn(e.target.value)} />
        <Field label="Renews on" type="date" value={renewsOn} onChange={e => setRenewsOn(e.target.value)} help="Highlighted when within 6 months." />
      </div>
      <OfferLetterField value={offerLetter} onChange={setOfferLetter} />
    </Modal>
  );
}
