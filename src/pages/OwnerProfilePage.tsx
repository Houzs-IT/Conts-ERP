import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { Field } from '../components/Field';
import { Dialog, type DialogSpec } from '../components/Dialog';
import { StaleBanner } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useUnitRoster } from '../lib/useUnitRoster';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { rm, monthLabel, todayMyt } from '../lib/format';
import { cx } from '../lib/design-tokens';
import {
  type Owner, type UnitLine, type Payload, type FeeSource,
  FALLBACK, netOf, grossOf, terms, linkBtn,
  Roll, Section, StatementHistory, LinkUnitModal, ContractModal,
} from './owners/shared';

/**
 * The management-facing OWNER PROFILE (`#/owners/:id`). This is the real profile
 * the operator opens after adding an owner: the owner header, their payout and
 * bank details, contract, statement history (all reused from the drawer), PLUS a
 * proper Units list where every unit expands to its own P&L (gross → management
 * fee → expenses → net, with a month switcher) and expense breakdown, and an
 * owner-level default management fee that a unit's own contract can override.
 *
 * Reads reuse GET /api/owners (the same list payload) and a new owner-scoped
 * aggregation GET /api/owners/:id/pnl?month=YYYY-MM. No backend in dev → the
 * fallbacks render the page; server writes are attempted and reported.
 */

interface PnlLine { label: string; amount: number; type: 'gross' | 'fee' | 'expense' | 'net' }
interface UnitPnl {
  unitId: string; unitLabel: string; model: 'management' | 'grr';
  feePct: number | null; grrAmount: number | null; feeSource: FeeSource;
  occupancy: number; adr: number; gross: number; revenue: number;
  expensesTotal: number; net: number;
  pnl: PnlLine[];
  expenses: { label: string; amount: number; category: string }[];
}
interface PnlPayload { month: string; defaultManagementFeePct: number | null; units: UnitPnl[]; generatedAt: string }

const cap = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

/** Shift a YYYY-MM string by whole months. */
function shiftMonth(period: string, by: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Dev fallback for the per-unit P&L: reconstruct the gross-to-net chain from the
 *  owner's current unit figures so the page renders without a backend. The month
 *  scales the numbers a little so switching months visibly changes the data. */
function pnlFallback(o: Owner | null, month: string): PnlPayload {
  if (!o) return { month, defaultManagementFeePct: null, units: [], generatedAt: '' };
  const now = todayMyt().slice(0, 7);
  const back = (() => { const [ay, am] = now.split('-').map(Number); const [by, bm] = month.split('-').map(Number); return (ay - by) * 12 + (am - bm); })();
  const factor = Math.max(0.6, 1 - back * 0.04);
  return {
    month, generatedAt: '', defaultManagementFeePct: o.defaultManagementFeePct,
    units: o.units.map((u): UnitPnl => {
      const gross = Math.round(u.gross * factor);
      const feePct = u.model === 'grr' ? null : (u.feePct ?? o.defaultManagementFeePct ?? 25);
      const fee = u.model === 'grr' ? 0 : Math.round(gross * ((feePct ?? 0) / 100));
      const hk = Math.round(gross * 0.045);
      const mnt = Math.round(gross * 0.012);
      const expensesTotal = u.model === 'grr' ? 0 : hk + mnt;
      const net = u.model === 'grr' ? (u.grrAmount ?? 0) : gross - fee - expensesTotal;
      const expenses = u.model === 'grr' ? [] : [
        { label: 'Housekeeping · turnovers', amount: -hk, category: 'housekeeping' },
        { label: 'Maintenance · aircon service', amount: -mnt, category: 'maintenance' },
      ];
      const pnl: PnlLine[] = u.model === 'grr'
        ? [
            { label: 'Gross booking value', amount: gross, type: 'gross' },
            { label: 'Guaranteed rent', amount: net, type: 'net' },
          ]
        : [
            { label: 'Gross booking value', amount: gross, type: 'gross' },
            { label: `Management fee · ${feePct}%`, amount: -fee, type: 'fee' },
            ...expenses.map(e => ({ label: e.label, amount: e.amount, type: 'expense' as const })),
            { label: 'Net payout', amount: net, type: 'net' },
          ];
      return {
        unitId: u.unitId, unitLabel: u.unitLabel, model: u.model,
        feePct, grrAmount: u.grrAmount ?? null, feeSource: u.feeSource ?? (u.feePct != null ? 'unit' : o.defaultManagementFeePct != null ? 'owner-default' : 'fallback'),
        occupancy: u.occupancy, adr: u.adr, gross, revenue: gross, expensesTotal, net, pnl, expenses,
      };
    }),
  };
}

const FEE_SOURCE_LABEL: Record<FeeSource, string> = {
  unit: 'Unit override', 'owner-default': 'Owner default', fallback: 'Default 25%',
};

export default function OwnerProfilePage({ ownerId }: { ownerId: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const rosterUnits = useUnitRoster();
  const { data, loading, error, reload } = useApi<Payload>('/owners', FALLBACK);
  const [edits, setEdits] = useState<Partial<Owner>>({});
  const [modal, setModal] = useState<null | 'link' | 'contract' | 'defaultFee'>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [busy, setBusy] = useState(false);

  const base = (data?.data ?? []).find(o => o.id === ownerId) ?? null;
  const o: Owner | null = base ? { ...base, ...edits } : null;

  if (!o) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink onBack={() => navigate('/owners')} />
        <Card>
          <div className="flex flex-col items-center gap-2 text-center py-[52px] px-6">
            <span className="text-muted-ink"><Icon name="UserX" /></span>
            <div className="text-[16px] font-semibold">{loading ? 'Loading owner…' : 'Owner not found'}</div>
            {!loading && <div className="text-[13px] text-muted-ink max-w-[360px]">{error ?? 'This owner is no longer on file.'}</div>}
            {!loading && <button onClick={() => navigate('/owners')} className="mt-1 text-gold-ink bg-transparent [border:none] cursor-pointer [font:inherit]">Back to owners</button>}
          </div>
        </Card>
      </div>
    );
  }

  const patch = (p: Partial<Owner>) => setEdits(e => ({ ...e, ...p }));
  const net = netOf(o), gross = grossOf(o);
  const canDelete = o.units.length === 0 && !o.contract;

  async function linkUnit(u: UnitLine) {
    if (!o) return;
    try {
      await api.patch(`/units/${u.unitId}`, { ownerId: o.id });
      await api.post('/contracts', { ownerId: o.id, model: u.model, managementFeePct: u.feePct ?? 0, grrAmount: u.grrAmount ?? 0, startsOn: todayMyt() });
      toast({ tone: 'success', title: 'Unit linked.', body: `${u.unitLabel} assigned to ${o.displayName}.` });
      setModal(null); reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'Unit was not linked.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    }
  }
  async function addContract(c: { feePct: number; startedOn: string; renewsOn: string | null }) {
    if (!o) return;
    try {
      await api.post('/contracts', { ownerId: o.id, managementFeePct: c.feePct, startsOn: c.startedOn, renewsOn: c.renewsOn });
      toast({ tone: 'success', title: 'Contract saved.', body: `Management agreement recorded for ${o.displayName}.` });
      setModal(null); reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'Contract was not saved.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    }
  }
  async function saveDefaultFee(pct: number | null) {
    if (!o) return;
    const prev = o.defaultManagementFeePct;
    patch({ defaultManagementFeePct: pct }); // optimistic
    setModal(null);
    try {
      await api.patch(`/owners/${o.id}`, { defaultManagementFeePct: pct });
      toast({ tone: 'success', title: 'Default fee saved.', body: pct == null ? 'Cleared the owner default.' : `Units without their own fee now use ${pct}%.` });
    } catch (e) {
      patch({ defaultManagementFeePct: prev }); // roll back
      toast({ tone: 'critical', title: 'Default fee was not saved.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    }
  }
  function invite() {
    if (!o) return;
    setDialog({
      title: `Invite ${o.displayName} to the owner portal?`,
      body: 'Creates an owner account with a temporary password. They can view their statements, revenue and property health, and approve quotes.',
      meta: o.email, confirmLabel: 'Send invite',
      onConfirm: async () => {
        setBusy(true);
        try {
          await api.post(`/owners/${o.id}/invite`);
          patch({ portalInvited: true });
          toast({ tone: 'success', title: 'Invite sent.', body: `${o.displayName} can now sign in to the owner portal.` });
        } catch (e) {
          toast({ tone: 'critical', title: 'Invite was not sent.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
        } finally { setBusy(false); setDialog(null); }
      },
    });
  }
  function deleteOwner() {
    if (!o) return;
    setDialog({
      title: `Delete ${o.displayName}?`,
      body: 'This permanently removes the owner record and their portal login, if any. Only possible when they have no units, contract or statement history.',
      meta: o.email, confirmLabel: 'Delete owner', busyLabel: 'Deleting…', danger: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          await api.del(`/owners/${o.id}`);
          toast({ tone: 'success', title: 'Owner deleted.', body: `${o.displayName} was removed.` });
          navigate('/owners');
        } catch (e) {
          toast({ tone: 'critical', title: 'Owner was not deleted.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
        } finally { setBusy(false); setDialog(null); }
      },
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <BackLink onBack={() => navigate('/owners')} />

      {error && <StaleBanner message={`Showing the last record we have. ${error}`} onRetry={reload} />}

      {/* Header */}
      <Card>
        <div className="pt-6 px-6 pb-5 flex items-start justify-between gap-5 flex-wrap">
          <div className="flex items-center gap-4 min-w-0">
            <span className="w-14 h-14 flex-none rounded-[999px] bg-black text-gold grid place-items-center text-[18px] font-semibold">
              {o.displayName.split(' ').map(n => n[0]).slice(0, 2).join('')}
            </span>
            <div className="min-w-0">
              <h1 className="m-0 text-[24px] leading-[1.2] font-semibold tracking-[-0.01em]">{o.displayName}</h1>
              <div className="text-[13px] text-muted-ink mt-1">{o.email}{o.phone ? ` · ${o.phone}` : ''}</div>
            </div>
          </div>
          <div className="flex items-end">{o.portalInvited ? <Badge tone="success" label="Portal active" /> : <Badge tone="neutral" label="Not invited" />}</div>
        </div>
        <div className="flex gap-[30px] flex-wrap pt-[18px] px-6 pb-5 [border-top:1px_solid_var(--color-line-soft)]">
          <Roll label="Net payout, this month" value={rm(net)} strong />
          <Roll label="Gross, this month" value={rm(gross)} />
          <Roll label="Units" value={String(o.units.length)} />
          <Roll label="Default fee" value={o.defaultManagementFeePct != null ? `${o.defaultManagementFeePct}%` : 'Not set'} />
        </div>
      </Card>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-5 [align-items:start]">
        {/* Left column: units + per-unit P&L */}
        <div className="flex flex-col gap-5 min-w-0">
          <Card>
            <div className="pt-[18px] px-[22px] pb-[14px] flex items-center justify-between gap-3">
              <span className="text-[18px] font-semibold">Units and P&amp;L</span>
              <button onClick={() => setModal('link')} className={linkBtn}><Icon name="Plus" size="sm" /> Link unit</button>
            </div>
            {o.units.length === 0 ? (
              <div className="px-[22px] pb-5 text-[12.5px] text-muted-ink">No units linked yet. Use <strong className="font-semibold">Link unit</strong> to assign one and preset the fee or GRR.</div>
            ) : (
              <div className="[border-top:1px_solid_var(--color-line-soft)]">
                {o.units.map(u => <UnitPanel key={u.unitId} ownerId={o.id} unit={u} owner={o} />)}
              </div>
            )}
          </Card>
        </div>

        {/* Right column: fee default, contract, payout, statements */}
        <div className="flex flex-col gap-5 min-w-0">
          <Card>
            <div className="p-[22px] flex flex-col gap-5">
              <Section title="Owner-level default fee" action={<button onClick={() => setModal('defaultFee')} className={linkBtn}><Icon name="Pencil" size="sm" /> {o.defaultManagementFeePct != null ? 'Change' : 'Set'}</button>}>
                <div className="text-[12.5px] text-muted-ink leading-[1.6]">
                  {o.defaultManagementFeePct != null
                    ? <>Units under {o.displayName} use <strong className="font-semibold text-ink">{o.defaultManagementFeePct}%</strong> unless a unit sets its own fee on <strong className="font-semibold">Link unit</strong>.</>
                    : <>No owner default set. Units fall back to their own contract fee, or 25%. Set a default to apply one fee across this owner's units.</>}
                </div>
              </Section>

              <Section title="Contract" action={<button onClick={() => setModal('contract')} className={linkBtn}><Icon name="Plus" size="sm" /> {o.contract ? 'Update' : 'Add contract'}</button>}>
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

              <StatementHistory key={o.id} o={o} />
            </div>
          </Card>

          <Card>
            <div className="p-4 flex flex-col gap-[9px]">
              <div className="flex gap-[9px]">
                <Button variant="primary" style={{ flex: 1 }} icon={<Icon name="Mail" size="sm" />} onClick={invite} disabled={o.portalInvited} disabledReason="This owner already has portal access">
                  {o.portalInvited ? 'Portal active' : 'Invite to portal'}
                </Button>
                <Button variant="secondary" onClick={() => setModal('link')}>Link unit</Button>
              </div>
              <Button variant="danger" icon={<Icon name="Trash2" size="sm" />} onClick={deleteOwner} disabled={!canDelete}
                disabledReason="This owner has units or a contract on file — reassign or remove those first.">
                Delete owner
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {modal === 'link' && <LinkUnitModal owner={o.displayName} units={rosterUnits} onClose={() => setModal(null)} onSubmit={linkUnit} />}
      {modal === 'contract' && <ContractModal owner={o.displayName} onClose={() => setModal(null)} onSubmit={addContract} />}
      {modal === 'defaultFee' && <DefaultFeeModal current={o.defaultManagementFeePct} owner={o.displayName} onClose={() => setModal(null)} onSubmit={saveDefaultFee} />}
      <Dialog spec={dialog} busy={busy} onClose={() => { if (!busy) setDialog(null); }} />
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} className="self-start inline-flex items-center gap-[6px] bg-transparent [border:none] cursor-pointer [font:inherit] text-[13px] text-muted-ink">
      <Icon name="ChevronLeft" size="sm" /> All owners
    </button>
  );
}

/** One unit row that expands to its P&L (gross → fee → expenses → net) with a
 *  month switcher, plus a dedicated expenses breakdown. The P&L is fetched
 *  per-unit only when the row is open, from the owner-scoped aggregation. */
function UnitPanel({ ownerId, unit, owner }: { ownerId: string; unit: UnitLine; owner: Owner }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => todayMyt().slice(0, 7));
  const pnlData = useApi<PnlPayload>(`/owners/${ownerId}/pnl?month=${month}`, pnlFallback(owner, month));
  const up = useMemo(() => pnlData.data?.units.find(x => x.unitId === unit.unitId) ?? null, [pnlData.data, unit.unitId]);
  const feeSource = up?.feeSource ?? unit.feeSource;

  return (
    <div className="[border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
      <button onClick={() => setOpen(v => !v)} aria-expanded={open}
        className="w-full flex items-center gap-[13px] py-[13px] px-[22px] bg-transparent [border:none] cursor-pointer text-left">
        <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size="sm" color="var(--color-muted-ink)" />
        <div className="flex flex-col gap-px flex-1 min-w-0">
          <span className="text-[13.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{unit.unitLabel}</span>
          <span className="text-[11.5px] text-muted-ink">{terms(unit)} · {unit.occupancy}% occ · ADR {rm(unit.adr, { cents: false })}</span>
        </div>
        <div className="flex flex-col items-end gap-0.5 flex-none">
          <span className="text-[13px] font-semibold tabular-nums">{rm(unit.net, { cents: false })}</span>
          {feeSource && <span className="text-[10.5px] text-muted-ink">{FEE_SOURCE_LABEL[feeSource]}</span>}
        </div>
      </button>

      {open && (
        <div className="px-[22px] pb-[18px] flex flex-col gap-4">
          {/* Month switcher */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] font-semibold text-muted-ink">Profit and loss</span>
            <div className="inline-flex items-center gap-1">
              <button aria-label="Previous month" onClick={() => setMonth(m => shiftMonth(m, -1))}
                className="w-[26px] h-[26px] grid place-items-center rounded-control bg-page border border-solid border-line cursor-pointer text-muted-ink"><Icon name="ChevronLeft" size="sm" /></button>
              <span className="text-[12.5px] font-medium min-w-[86px] text-center tabular-nums">{monthLabel(month)}</span>
              <button aria-label="Next month" onClick={() => setMonth(m => shiftMonth(m, 1))} disabled={month >= todayMyt().slice(0, 7)}
                className={cx('w-[26px] h-[26px] grid place-items-center rounded-control bg-page border border-solid border-line', month >= todayMyt().slice(0, 7) ? 'opacity-40 cursor-default' : 'cursor-pointer text-muted-ink')}><Icon name="ChevronRight" size="sm" /></button>
            </div>
          </div>

          {up ? (
            <>
              {/* Unit detail chips */}
              <div className="grid grid-cols-[repeat(auto-fit,minmax(84px,1fr))] gap-3 py-3 px-4 bg-page rounded-card">
                {[
                  ['Occupancy', `${up.occupancy}%`],
                  ['ADR', rm(up.adr, { cents: false })],
                  ['Gross', rm(up.gross, { cents: false })],
                  ['Net', rm(up.net, { cents: false })],
                ].map(([label, value]) => (
                  <div key={label} className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[11px] text-muted-ink">{label}</span>
                    <span className="text-[14px] font-semibold tabular-nums">{value}</span>
                  </div>
                ))}
              </div>

              {/* Gross to net */}
              <div className="border border-solid border-line rounded-card overflow-hidden">
                {up.pnl.map((l, i) => {
                  const isNet = l.type === 'net';
                  return (
                    <div key={i} className={cx('flex items-center justify-between gap-4 py-[10px] px-[13px] [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0', isNet && 'bg-page')}>
                      <span className={cx('text-[12.5px]', isNet ? 'font-semibold text-ink' : 'font-normal text-muted-ink')}>{l.label}</span>
                      <span className={cx('tabular-nums', isNet ? 'text-[14px] font-bold text-ink' : 'text-[12.5px] font-medium text-ink')}>
                        {l.amount < 0 ? `− ${rm(Math.abs(l.amount), { cents: false })}` : rm(l.amount, { cents: false })}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Expenses breakdown */}
              <div className="flex flex-col gap-2">
                <span className="text-[12px] font-semibold text-muted-ink">Expenses · {monthLabel(month)}</span>
                {up.expenses.length === 0 ? (
                  <div className="text-[12px] text-muted-ink">{up.model === 'grr' ? 'GRR unit — expenses are borne by The Conts, not the owner.' : 'No owner-charged expenses this month.'}</div>
                ) : (
                  <div className="border border-solid border-line rounded-card overflow-hidden">
                    {up.expenses.map((e, i) => (
                      <div key={i} className="flex items-center justify-between gap-4 py-[9px] px-[13px] [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
                        <span className="text-[12px] text-muted-ink flex items-center gap-2 min-w-0">
                          <Badge tone="neutral" label={cap(e.category)} size="sm" />
                          <span className="whitespace-nowrap overflow-hidden text-ellipsis">{e.label}</span>
                        </span>
                        <span className="text-[12px] font-medium tabular-nums">{rm(Math.abs(e.amount), { cents: false })}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-4 py-[9px] px-[13px] bg-page">
                      <span className="text-[12px] font-semibold">Total expenses</span>
                      <span className="text-[12.5px] font-semibold tabular-nums">{rm(up.expensesTotal, { cents: false })}</span>
                    </div>
                  </div>
                )}
              </div>

              <a href={`#/properties/units/${encodeURIComponent(unit.unitId)}`} className="self-start text-[12px] text-gold-ink no-underline inline-flex items-center gap-1">
                Open unit record <Icon name="ChevronRight" size="sm" />
              </a>
            </>
          ) : (
            <div className="text-[12.5px] text-muted-ink">{pnlData.error ? pnlData.error : `No P&L for ${monthLabel(month)}.`}</div>
          )}
        </div>
      )}
    </div>
  );
}

function DefaultFeeModal({ current, owner, onClose, onSubmit }: { current: number | null; owner: string; onClose: () => void; onSubmit: (pct: number | null) => void }) {
  const [pct, setPct] = useState(current != null ? String(current) : '');
  const [busy, setBusy] = useState(false);
  const parsed = pct.trim() === '' ? null : Number(pct);
  const valid = parsed == null || (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100);
  return (
    <div role="dialog" aria-modal="true" aria-label="Owner default fee" className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div className="relative w-full max-w-[440px] bg-card rounded-card [box-shadow:var(--shadow-overlay)]">
        <form onSubmit={e => { e.preventDefault(); if (valid && !busy) { setBusy(true); onSubmit(parsed); } }}>
          <div className="pt-[22px] px-[22px] pb-1 flex flex-col gap-[5px]">
            <h2 className="m-0 text-[18px] font-semibold">Owner default management fee</h2>
            <p className="m-0 text-[13px] text-muted-ink">Applied to every unit of {owner} that has no fee of its own. Leave blank to clear it.</p>
          </div>
          <div className="py-4 px-[22px]">
            <Field label="Default management fee %" type="number" min={0} max={100} numeric value={pct} placeholder="e.g. 22"
              onChange={e => setPct(e.target.value)} help="A unit's own fee set on Link unit always overrides this." />
          </div>
          <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex justify-end gap-[9px]">
            <Button size="sm" variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button size="sm" variant="primary" type="submit" disabled={!valid || busy} disabledReason="Enter a percentage between 0 and 100, or leave blank to clear.">
              {current != null && parsed == null ? 'Clear default' : 'Save default'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
