import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { color, radius, text, tone as toneToken } from '../theme';
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
const COLS = 'minmax(150px,1.3fr) minmax(180px,1.6fr) minmax(130px,1fr) minmax(110px,0.9fr) minmax(150px,1.2fr) minmax(96px,0.8fr) 72px';

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
  const [added, setAdded] = useState<Contract[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Contract>>>({});
  const [filter, setFilter] = useState<FilterKey>('all');
  const [modal, setModal] = useState<null | { mode: 'add' } | { mode: 'edit'; id: string }>(null);

  const rows = useMemo(
    () => [...added, ...(data?.data ?? [])].map(c => ({ ...c, ...edits[c.id] })),
    [added, data, edits],
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

  function addContract(input: Omit<Contract, 'id'>) {
    const created: Contract = { id: crypto.randomUUID(), ...input };
    setAdded(a => [created, ...a]);
    toast({ tone: 'success', title: 'Contract added.', body: `Management agreement recorded for ${input.ownerName}.` });
    api.post('/contracts', input).catch(() => { /* dev: no backend, keep optimistic */ });
    setModal(null);
  }
  function saveEdit(id: string, input: Omit<Contract, 'id'>) {
    setEdits(e => ({ ...e, [id]: { ...e[id], ...input } }));
    toast({ tone: 'success', title: 'Contract updated.', body: `Terms saved for ${input.ownerName}.` });
    api.patch(`/contracts/${id}`, input).catch(() => { /* dev: no backend, keep optimistic */ });
    setModal(null);
  }

  return (
    <>
      <PageHeader
        title="Contracts"
        sub={`${counts.all} management agreements · ${counts.soon} renewing within 6 months`}
        right={<Button variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({ mode: 'add' })}>Add contract</Button>}
      />

      {error && <StaleBanner message={`Showing the last agreements we have. ${error}`} onRetry={reload} />}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {FILTERS.map(f => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={active}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 13px',
                borderRadius: radius.pill, cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 500,
                background: active ? color.black : color.card,
                color: active ? '#FFFFFF' : color.textMuted,
                border: `1px solid ${active ? color.black : color.border}`,
                transition: 'background var(--motion-fast) var(--ease-out)',
              }}
            >
              {f.label}
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: radius.pill,
                background: active ? 'rgba(255,255,255,0.18)' : color.muted,
                color: active ? '#FFFFFF' : color.textMuted, fontVariantNumeric: 'tabular-nums',
              }}>{counts[f.key]}</span>
            </button>
          );
        })}
      </div>

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 940 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Owner</div><div>Units</div><div>Fee model</div><div>Started</div><div>Renews</div><div>Status</div><div style={{ textAlign: 'right' }}>Edit</div>
            </div>

            {loading && rows.length === 0 ? (
              <TableSkeleton rows={6} cols={7} />
            ) : visible.length === 0 ? (
              <div style={{ padding: '48px 22px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 13, color: color.textMuted }}>
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
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 54, padding: '9px 22px 9px 19px', borderBottom: `1px solid ${color.borderMuted}`, borderLeft: `3px solid ${soon ? toneToken.warning.line : 'transparent'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <Icon name="FileSignature" size="sm" color={color.textMuted} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.ownerName}</span>
                      {r.offerLetter && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <Icon name="Paperclip" size="sm" color={color.faint} style={{ width: 12, height: 12 }} />{r.offerLetter}
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{ fontSize: 12.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.unitsLabel}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{feeLabel(r)}</span>
                  <span style={{ fontSize: 12.5 }}>{r.startsOn}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 12.5 }}>{r.renewsOn ?? '—'}</span>
                    {days !== null && days >= 0 && days <= RENEWAL_WINDOW_DAYS && (
                      <span style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: radius.pill, background: toneToken.warning.bg, color: toneToken.warning.fg }}>
                        {days === 0 ? 'renews today' : `in ${days} ${days === 1 ? 'day' : 'days'}`}
                      </span>
                    )}
                  </div>
                  <div><Badge tone={STATE_TONE[state]} label={state} /></div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => setModal({ mode: 'edit', id: r.id })}
                      aria-label={`Edit contract for ${r.ownerName}`}
                      style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: radius.control, background: color.card, border: `1px solid ${color.border}`, cursor: 'pointer', color: color.textMuted }}
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
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 24, background: 'var(--color-surface-scrim)', animation: 'fade-in var(--motion-standard) var(--ease-out) both' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0 }} />
      <div ref={ref} style={{ position: 'relative', width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto', background: 'var(--color-surface-card)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-overlay)' }}>
        <form onSubmit={e => { e.preventDefault(); if (canSubmit) onSubmit(); }}>
          <div style={{ padding: '22px 22px 4px', display: 'flex', flexDirection: 'column', gap: 5 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h2>
            {sub && <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{sub}</p>}
          </div>
          <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
          <div style={{ padding: '14px 22px', borderTop: '1px solid var(--color-border-default)', background: 'var(--color-surface-page)', display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
            <Button size="sm" variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button size="sm" variant="primary" type="submit" disabled={!canSubmit} disabledReason="Fill the required fields first">{submitLabel}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const selectStyle: CSSProperties = { height: 'var(--control-height)', width: '100%', boxSizing: 'border-box', padding: '0 12px', fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--color-text-primary)', background: 'var(--color-surface-card)', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-control)', outline: 'none' };
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <label style={{ fontSize: 'var(--text-small)', fontWeight: 500, color: 'var(--color-text-muted)' }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} style={selectStyle}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </div>
  );
}

/** Placeholder upload — records the chosen filename locally; the real upload lands with the backend. */
function OfferLetterField({ value, onChange }: { value: string | null; onChange: (name: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <label style={{ fontSize: 'var(--text-small)', fontWeight: 500, color: 'var(--color-text-muted)' }}>Offer letter</label>
      <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => onChange(e.target.files?.[0]?.name ?? null)} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button size="sm" variant="secondary" type="button" icon={<Icon name="Upload" size="sm" />} onClick={() => inputRef.current?.click()}>
          {value ? 'Replace file' : 'Upload offer letter'}
        </Button>
        <span style={{ fontSize: 12, color: value ? color.ink : color.faint, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {value ?? 'No file selected'}
        </span>
        {value && (
          <button type="button" onClick={() => onChange(null)} aria-label="Remove offer letter" style={{ display: 'grid', placeItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: color.textMuted, padding: 2 }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Start date" type="date" value={startsOn} onChange={e => setStartsOn(e.target.value)} />
        <Field label="Renews on" type="date" value={renewsOn} onChange={e => setRenewsOn(e.target.value)} help="Highlighted when within 6 months." />
      </div>
      <OfferLetterField value={offerLetter} onChange={setOfferLetter} />
    </Modal>
  );
}
