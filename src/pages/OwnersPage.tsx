import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { Field } from '../components/Field';
import { Drawer, Dialog, type DialogSpec } from '../components/Dialog';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { rm } from '../lib/format';
import { cx } from '../lib/design-tokens';

type FeeModel = 'management' | 'grr';
interface UnitLine {
  unitId: string; unitLabel: string; model: FeeModel; feePct?: number; grrAmount?: number;
  occupancy: number; adr: number; gross: number; net: number;
}
interface Owner {
  id: string; displayName: string; email: string; phone: string | null; ic: string | null;
  bankName: string | null; bankAccount: string | null; accountHolder: string | null;
  portalInvited: boolean; contract: { feePct: number; startedOn: string; renewsOn: string | null } | null;
  units: UnitLine[];
}
interface Payload { data: Owner[]; generatedAt: string }

const line = (unitId: string, unitLabel: string, model: FeeModel, feePct: number | undefined, grrAmount: number | undefined, occupancy: number, adr: number, gross: number, net: number): UnitLine =>
  ({ unitId, unitLabel, model, feePct, grrAmount, occupancy, adr, gross, net });

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'o1', displayName: 'Lim Chee Keong', email: 'limck@example.com', phone: '+60 12-333 0001', ic: '680606-08-5101', bankName: 'PBBB', bankAccount: '4605371109', accountHolder: 'LIANG WOOI KEE', portalInvited: true, contract: { feePct: 25, startedOn: '2025-03-01', renewsOn: '2027-03-01' }, units: [line('u1', 'Vista Jaya One #A-12-03', 'management', 25, undefined, 86, 28400, 812000, 609000)] },
    { id: 'o2', displayName: 'Wong Mei Ling', email: 'wongml@example.com', phone: '+60 12-333 0002', ic: '710214-14-5220', bankName: 'MBBE', bankAccount: '1512988771', accountHolder: 'Wong Mei Ling', portalInvited: true, contract: { feePct: 25, startedOn: '2025-06-01', renewsOn: '2027-06-01' }, units: [line('u2', 'Arcoris #B-08-11', 'management', 25, undefined, 79, 23100, 634000, 475500)] },
    { id: 'o3', displayName: 'Rajesh Kumar', email: 'rajesh@example.com', phone: '+60 12-333 0003', ic: '650930-10-5333', bankName: 'CIBB', bankAccount: '7024551200', accountHolder: 'Rajesh A/L Kumar', portalInvited: false, contract: { feePct: 0, startedOn: '2025-11-01', renewsOn: '2026-11-01' }, units: [line('u3', 'Tribeca #2207', 'grr', undefined, 350000, 88, 31800, 901000, 350000)] },
    { id: 'o4', displayName: 'Chong Wei Han', email: 'chongwh@example.com', phone: '+60 12-333 0004', ic: '730118-08-5019', bankName: 'PBBB', bankAccount: '3388120945', accountHolder: 'Chong Wei Han', portalInvited: false, contract: { feePct: 25, startedOn: '2025-08-01', renewsOn: '2027-08-01' }, units: [line('u4', 'Scarletz #15-06', 'management', 25, undefined, 74, 26500, 588000, 441000)] },
  ],
};

const COLS = 'grid-cols-[minmax(170px,1.5fr)_minmax(190px,1.7fr)_minmax(120px,0.9fr)_minmax(120px,1fr)_minmax(120px,1fr)]';
const netOf = (o: Owner) => o.units.reduce((s, u) => s + u.net, 0);
const grossOf = (o: Owner) => o.units.reduce((s, u) => s + u.gross, 0);
const terms = (u: UnitLine) => u.model === 'grr' ? `GRR ${rm(u.grrAmount ?? 0, { cents: false })}/mo` : `${u.feePct ?? 0}% fee`;

export default function OwnersPage() {
  const { data, loading, error, reload } = useApi<Payload>('/owners', FALLBACK);
  const toast = useToast();
  const [added, setAdded] = useState<Owner[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Owner>>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'owner' | 'link' | 'contract'>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);

  const rows = useMemo(() => [...added, ...(data?.data ?? [])].map(o => ({ ...o, ...edits[o.id] })), [added, data, edits]);
  const open = rows.find(o => o.id === openId) ?? null;
  const unitCount = rows.reduce((s, o) => s + o.units.length, 0);

  const patch = (id: string, p: Partial<Owner>) => setEdits(e => ({ ...e, [id]: { ...e[id], ...p } }));

  function addOwner(o: Omit<Owner, 'id' | 'units' | 'portalInvited' | 'contract'>) {
    const owner: Owner = { id: crypto.randomUUID(), units: [], portalInvited: false, contract: null, ...o };
    setAdded(a => [owner, ...a]);
    toast({ tone: 'success', title: 'Owner added.', body: `${o.displayName} — link a unit next.` });
    api.post('/owners', o).catch(() => {});
    setModal(null); setOpenId(owner.id);
  }
  function linkUnit(u: UnitLine) {
    if (!open) return;
    patch(open.id, { units: [...open.units, u] });
    toast({ tone: 'success', title: 'Unit linked.', body: `${u.unitLabel} assigned to ${open.displayName}.` });
    api.patch(`/units/${u.unitId}`, { ownerId: open.id }).catch(() => {});
    setModal(null);
  }
  function addContract(c: { feePct: number; startedOn: string; renewsOn: string | null }) {
    if (!open) return;
    patch(open.id, { contract: c });
    toast({ tone: 'success', title: 'Contract saved.', body: `Management agreement recorded for ${open.displayName}.` });
    api.post('/contracts', { ownerId: open.id, ...c }).catch(() => {});
    setModal(null);
  }
  function invite(o: Owner) {
    setDialog({
      title: `Invite ${o.displayName} to the owner portal?`,
      body: 'Creates an owner account with a temporary password. They can view their statements, revenue and property health, and approve quotes.',
      meta: o.email,
      confirmLabel: 'Send invite',
      onConfirm: async () => {
        patch(o.id, { portalInvited: true });
        try { await api.post(`/owners/${o.id}/invite`); } catch { /* dev */ }
        setDialog(null);
        toast({ tone: 'success', title: 'Invite sent.', body: `${o.displayName} can now sign in to the owner portal.` });
      },
    });
  }

  return (
    <>
      <PageHeader title="Owners" sub={`${rows.length} owners · ${unitCount} units under management`}
        right={<Button variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal('owner')}>Add owner</Button>} />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <Card>
        <div className="overflow-x-auto">
          <div className="min-w-[860px]">
            <div className={cx(COLS, 'grid gap-[14px] py-[9px] px-[22px] bg-muted [border-bottom:1px_solid_var(--color-line)] text-[12px] font-semibold text-muted-ink')}>
              <div>Owner</div><div>Units</div><div className="text-right">Terms</div><div className="text-right">Net this month</div><div>Portal</div>
            </div>
            {loading && rows.length === 0 ? <TableSkeleton rows={6} cols={5} /> : rows.map(o => (
              <div key={o.id} role="button" tabIndex={0} onClick={() => setOpenId(o.id)} onKeyDown={e => { if (e.key === 'Enter') setOpenId(o.id); }}
                className={cx(COLS, 'grid gap-[14px] items-center min-h-[54px] py-[9px] px-[22px] [border-bottom:1px_solid_var(--color-line-soft)] cursor-pointer')}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-[30px] h-[30px] flex-none rounded-[999px] bg-black text-gold grid place-items-center text-[11px] font-semibold">
                    {o.displayName.split(' ').map(n => n[0]).slice(0, 2).join('')}
                  </span>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-[13.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{o.displayName}</span>
                    <span className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{o.email}</span>
                  </div>
                </div>
                <span className="text-[12.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">
                  {o.units.length === 0 ? 'No units yet' : o.units.length === 1 ? o.units[0].unitLabel : `${o.units.length} units`}
                </span>
                <span className="text-[12.5px] text-right text-muted-ink">{o.units[0] ? terms(o.units[0]) : '—'}</span>
                <span className="text-[13px] text-right font-medium">{rm(netOf(o), { cents: false })}</span>
                <div>{o.portalInvited ? <Badge tone="success" label="Active" /> : <Badge tone="neutral" label="Not invited" />}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Drawer open={!!open} onClose={() => setOpenId(null)} width={520}>
        {open && <OwnerPanel o={open} onClose={() => setOpenId(null)}
          onLink={() => setModal('link')} onContract={() => setModal('contract')} onInvite={() => invite(open)} />}
      </Drawer>

      {modal === 'owner' && <AddOwnerModal onClose={() => setModal(null)} onSubmit={addOwner} />}
      {modal === 'link' && open && <LinkUnitModal owner={open.displayName} onClose={() => setModal(null)} onSubmit={linkUnit} />}
      {modal === 'contract' && open && <ContractModal owner={open.displayName} onClose={() => setModal(null)} onSubmit={addContract} />}
      <Dialog spec={dialog} busy={false} onClose={() => setDialog(null)} />
    </>
  );
}

function OwnerPanel({ o, onClose, onLink, onContract, onInvite }: {
  o: Owner; onClose: () => void; onLink: () => void; onContract: () => void; onInvite: () => void;
}) {
  const net = netOf(o), gross = grossOf(o);
  return (
    <>
      <div className="pt-5 px-5 pb-4 [border-bottom:1px_solid_var(--color-line)] flex flex-col gap-[14px] flex-none">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 flex-none rounded-[999px] bg-black text-gold grid place-items-center text-[14px] font-semibold">
              {o.displayName.split(' ').map(n => n[0]).slice(0, 2).join('')}
            </span>
            <div className="min-w-0">
              <div className="text-[16px] font-semibold">{o.displayName}</div>
              <div className="text-[12px] text-muted-ink">{o.email}{o.phone ? ` · ${o.phone}` : ''}</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-[30px] h-[30px] flex-none grid place-items-center rounded-[999px] bg-page border border-solid border-line cursor-pointer text-muted-ink"><Icon name="X" size="sm" /></button>
        </div>
        <div className="flex gap-[22px] flex-wrap">
          <Roll label="Net payout, this month" value={rm(net)} strong />
          <Roll label="Gross" value={rm(gross)} />
          <Roll label="Units" value={String(o.units.length)} />
          <div className="flex items-end">{o.portalInvited ? <Badge tone="success" label="Portal active" /> : <Badge tone="neutral" label="Not invited" />}</div>
        </div>
      </div>

      <div className="p-5 flex flex-col gap-5 flex-1">
        <Section title="Units" action={<button onClick={onLink} className={linkBtn}><Icon name="Plus" size="sm" /> Link unit</button>}>
          {o.units.length === 0 ? (
            <div className="text-[12.5px] text-muted-ink">No units linked yet. Use <strong className="font-semibold">Link unit</strong> to assign one and preset the fee or GRR.</div>
          ) : (
            <div className="border border-solid border-line rounded-card overflow-hidden">
              {o.units.map(u => (
                <a key={u.unitId} href={`#/properties/units/${encodeURIComponent(u.unitId)}`}
                  className="grid grid-cols-[1.4fr_1fr_0.9fr_0.9fr] gap-2.5 items-center py-[11px] px-[13px] [border-bottom:1px_solid_var(--color-line-soft)] no-underline text-inherit!">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{u.unitLabel}</div>
                    <div className="text-[11px] text-muted-ink">{terms(u)} · {u.occupancy}% occ · ADR {rm(u.adr, { cents: false })}</div>
                  </div>
                  <span className="text-[12px] text-right text-muted-ink">{rm(u.gross, { cents: false })}</span>
                  <span className="text-[12.5px] text-right font-semibold">{rm(u.net, { cents: false })}</span>
                  <span className="flex justify-end text-muted-ink"><Icon name="ChevronRight" size="sm" /></span>
                </a>
              ))}
            </div>
          )}
        </Section>

        <Section title="Contract" action={<button onClick={onContract} className={linkBtn}><Icon name="Plus" size="sm" /> {o.contract ? 'Update' : 'Add contract'}</button>}>
          {o.contract ? (
            <div className="text-[12.5px] text-muted-ink">
              {o.contract.feePct > 0 ? `${o.contract.feePct}% management fee` : 'GRR agreement'} · started {o.contract.startedOn}{o.contract.renewsOn ? ` · renews ${o.contract.renewsOn}` : ''}
            </div>
          ) : <div className="text-[12.5px] text-muted-ink">No contract on file.</div>}
        </Section>

        <Section title="Payout details">
          <div className="text-[12.5px] text-muted-ink leading-[1.7]">
            <div>IC / passport: {o.ic ?? '—'}</div>
            <div>Bank: {o.bankName ?? '—'} · {o.bankAccount ?? '—'}</div>
            <div>Account holder: {o.accountHolder ?? '—'}</div>
          </div>
        </Section>
      </div>

      <div className="p-4 [border-top:1px_solid_var(--color-line)] bg-page flex gap-[9px] flex-none">
        <Button variant="primary" style={{ flex: 1 }} icon={<Icon name="Mail" size="sm" />} onClick={onInvite} disabled={o.portalInvited} disabledReason="This owner already has portal access">
          {o.portalInvited ? 'Portal active' : 'Invite to portal'}
        </Button>
        <Button variant="secondary" onClick={onLink}>Link unit</Button>
      </div>
    </>
  );
}

const linkBtn = 'inline-flex items-center gap-[5px] bg-transparent [border:none] cursor-pointer font-sans text-[12.5px] font-medium text-gold-ink';
function Roll({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-[3px]">
      <span className={cx('font-semibold tabular-nums', strong ? 'text-[19px]' : 'text-[15px]')}>{value}</span>
      <span className="text-[11px] text-muted-ink">{label}</span>
    </div>
  );
}
function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-muted-ink">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

/* ---------- form modals ---------- */
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
          <div className="pt-[22px] px-[22px] pb-1 flex flex-col gap-[5px]">
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
const selectStyle = 'h-[var(--control-height)] w-full box-border py-0 px-3 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none';
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex flex-col gap-[7px]">
      <label className="text-[12px] font-medium text-muted-ink">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className={selectStyle}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </div>
  );
}

function AddOwnerModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (o: Omit<Owner, 'id' | 'units' | 'portalInvited' | 'contract'>) => void }) {
  const [f, setF] = useState({ displayName: '', email: '', phone: '', ic: '', bankName: '', bankAccount: '', accountHolder: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value }));
  const canSubmit = f.displayName.trim() !== '' && /.+@.+\..+/.test(f.email);
  return (
    <Modal title="Add owner" sub="Create the owner, then link units and preset the fee or GRR." onClose={onClose} submitLabel="Add owner" canSubmit={canSubmit}
      onSubmit={() => onSubmit({ displayName: f.displayName.trim(), email: f.email.trim(), phone: f.phone.trim() || null, ic: f.ic.trim() || null, bankName: f.bankName.trim() || null, bankAccount: f.bankAccount.trim() || null, accountHolder: f.accountHolder.trim() || f.displayName.trim() })}>
      <Field label="Owner name" placeholder="e.g. Lim Chee Keong" value={f.displayName} onChange={set('displayName')} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email" type="email" placeholder="owner@email.com" value={f.email} onChange={set('email')} />
        <Field label="Phone" placeholder="+60 12-345 6789" value={f.phone} onChange={set('phone')} />
      </div>
      <Field label="IC / passport" placeholder="Accepts both formats" value={f.ic} onChange={set('ic')} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bank" placeholder="e.g. PBBB" value={f.bankName} onChange={set('bankName')} />
        <Field label="Bank account" placeholder="Account number" value={f.bankAccount} onChange={set('bankAccount')} />
      </div>
      <Field label="Account holder" placeholder="If different from owner name" value={f.accountHolder} onChange={set('accountHolder')} />
    </Modal>
  );
}

function LinkUnitModal({ owner, onClose, onSubmit }: { owner: string; onClose: () => void; onSubmit: (u: UnitLine) => void }) {
  const [unitLabel, setUnitLabel] = useState('');
  const [model, setModel] = useState<FeeModel>('management');
  const [feePct, setFeePct] = useState('25');
  const [grr, setGrr] = useState('');
  const canSubmit = unitLabel.trim() !== '' && (model === 'management' ? feePct !== '' : grr !== '');
  return (
    <Modal title="Link a unit" sub={`Assign a unit to ${owner} and preset how the owner is paid.`} onClose={onClose} submitLabel="Link unit" canSubmit={canSubmit}
      onSubmit={() => onSubmit(line(crypto.randomUUID(), unitLabel.trim(), model, model === 'management' ? Number(feePct) : undefined, model === 'grr' ? Math.round(Number(grr) * 100) : undefined, 0, 0, 0, 0))}>
      <Field label="Unit" placeholder="e.g. Arte Mont Kiara #MK2-09-16" value={unitLabel} onChange={e => setUnitLabel(e.target.value)} />
      <SelectField label="Payout model" value={model} onChange={v => setModel(v as FeeModel)}
        options={[{ value: 'management', label: 'Management fee (% of revenue)' }, { value: 'grr', label: 'GRR — guaranteed monthly rent' }]} />
      {model === 'management'
        ? <Field label="Management fee %" type="number" min={0} max={100} numeric value={feePct} onChange={e => setFeePct(e.target.value)} help="The Conts keeps this share; the owner receives the rest." />
        : <Field label="Guaranteed rent (RM / month)" type="number" min={0} numeric placeholder="e.g. 3500" value={grr} onChange={e => setGrr(e.target.value)} help="The owner is paid this fixed amount regardless of occupancy." />}
    </Modal>
  );
}

function ContractModal({ owner, onClose, onSubmit }: { owner: string; onClose: () => void; onSubmit: (c: { feePct: number; startedOn: string; renewsOn: string | null }) => void }) {
  const [feePct, setFeePct] = useState('25');
  const [startedOn, setStartedOn] = useState('');
  const [renewsOn, setRenewsOn] = useState('');
  const canSubmit = startedOn !== '';
  return (
    <Modal title="Management agreement" sub={`Record the contract terms for ${owner}.`} onClose={onClose} submitLabel="Save contract" canSubmit={canSubmit}
      onSubmit={() => onSubmit({ feePct: Number(feePct) || 0, startedOn, renewsOn: renewsOn || null })}>
      <Field label="Management fee %" type="number" min={0} max={100} numeric value={feePct} onChange={e => setFeePct(e.target.value)} help="Set 0 for a GRR-only arrangement." />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date" type="date" value={startedOn} onChange={e => setStartedOn(e.target.value)} />
        <Field label="Renews on" type="date" value={renewsOn} onChange={e => setRenewsOn(e.target.value)} />
      </div>
    </Modal>
  );
}
