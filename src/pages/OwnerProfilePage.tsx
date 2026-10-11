import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { EmptyState } from '../components/States';
import { MoneyText } from '../components/MoneyText';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { PercentInput } from '../components/inputs';
import { ConfirmDialog, type ConfirmSpec } from '../components/ConfirmDialog';
import { StaleBanner } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useUnitRoster } from '../lib/useUnitRoster';
import { useToast } from '../components/Toast';
import { api, errorMessage } from '../lib/api';
import { rm, monthLabel, todayMyt, titleCase, plural } from '../lib/format';
import { MODEL, type RevenueModel } from '../lib/revenueModel';
import { PayoutDetails } from './owners/PayoutDetails';
import { OwnerAdjustments } from './owners/Adjustments';
import { ExpensesCard } from './owners/ExpenseEntry';
import { ModelChip } from './units/ContractTab';
import { RecordHistory } from '../components/RecordHistory';
import { MonthStepper, shiftMonth } from './finance/listKit';
import { cx } from '../lib/design-tokens';
import { Eyebrow, Segmented } from '../components/Metric';
import {
  type Owner, type UnitLine, type Payload,
  FALLBACK, terms, Section, StatementHistory, LinkUnitModal,
} from './owners/shared';
import { statusLabel } from '../lib/status';
import { PhoneText } from '../components/PhoneText';

/**
 * The OWNER PROFILE (`#/owners/:id`): one card per unit with its revenue model and the month's figures (income,
 * the costs the owner pays, the operator's share, owner credits and charges, the owner's net), worked out by the
 * statement engine (GET /api/owners?id=&month=), a totals bar with the statement's state, and the Owner Income
 * Report by owner (all units combined) or by unit. Below: expenses recorded to the units (with who pays), owner
 * credits and charges, payout details and statement history.
 */

type ReportView = 'owner' | 'unit';

export default function OwnerProfilePage({ ownerId }: { ownerId: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const rosterUnits = useUnitRoster();
  const [params, setParams] = useSearchParams();
  const thisMonth = todayMyt().slice(0, 7);
  // Opens on last month: the month whose statement is being prepared or was just sent.
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month')! : shiftMonth(thisMonth, -1);
  const view: ReportView = params.get('report') === 'unit' ? 'unit' : 'owner';
  const setParam = (k: string, v: string | null) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });

  const { data, loading, error, reload } = useApi<Payload>(`/owners?id=${encodeURIComponent(ownerId)}&month=${month}`, FALLBACK);
  const [edits, setEdits] = useState<Partial<Owner>>({});
  const [modal, setModal] = useState<null | 'link' | 'defaultFee'>(null);
  const [dialog, setDialog] = useState<ConfirmSpec | null>(null);
  const [busy, setBusy] = useState(false);

  const base = (data?.data ?? []).find(o => o.id === ownerId) ?? null;
  const o: Owner | null = base ? { ...base, ...edits } : null;

  if (!o) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={loading ? 'Owner' : 'Owner not found'} back={{ label: 'All owners', onClick: () => navigate('/owners') }} />
        <EmptyState icon="UserX" title={loading ? 'Loading owner…' : 'Owner not found'}
          body={loading ? undefined : (error ?? 'This owner is no longer on file.')}
          action={loading ? undefined : { label: 'Back to owners', onClick: () => navigate('/owners') }} />
      </div>
    );
  }

  const patch = (p: Partial<Owner>) => setEdits(e => ({ ...e, ...p }));
  const canDelete = o.units.length === 0 && !o.contract;
  const total = o.units.reduce((n, u) => n + (u.figures?.netPayout ?? u.net), 0);
  const st = o.statement ?? null;
  const reportHref = st ? `#/finance/statements/${encodeURIComponent(st.id)}/report${view === 'owner' ? '?view=owner' : ''}` : null;
  const unitChoices = o.units.map(u => ({ id: u.unitId, label: u.unitLabel }));

  async function linkUnit(u: UnitLine) {
    if (!o) return;
    try {
      await api.patch(`/units/${u.unitId}`, { ownerId: o.id });
      // The unit's own contract with this owner, on the terms chosen when linking.
      await api.put(`/units/${u.unitId}/contract`, u.model === 'grr'
        ? { revenueModel: 'grr', monthlyRent: u.grrAmount ?? 0, startsOn: todayMyt() }
        : { revenueModel: 'management', ownerPct: 100 - (u.feePct ?? 25), managementPct: u.feePct ?? 25, agentPct: 0, startsOn: todayMyt() });
      toast({ tone: 'success', title: 'Unit linked.', body: `${titleCase(u.unitLabel)} assigned to ${titleCase(o.displayName)}.` });
      setModal(null); reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'Unit was not linked.', body: errorMessage(e, 'Try again in a moment.') });
    }
  }
  async function saveDefaultFee(pct: number | null) {
    if (!o) return;
    const prev = o.defaultManagementFeePct;
    patch({ defaultManagementFeePct: pct });
    setModal(null);
    try {
      await api.patch(`/owners/${o.id}`, { defaultManagementFeePct: pct });
      toast({ tone: 'success', title: 'Default fee saved.', body: pct == null ? 'Cleared the owner default.' : `Units without their own fee now use ${pct}%.` });
    } catch (e) {
      patch({ defaultManagementFeePct: prev });
      toast({ tone: 'critical', title: 'Default fee was not saved.', body: errorMessage(e, 'Try again in a moment.') });
    }
  }
  function invite() {
    if (!o) return;
    setDialog({
      title: `Invite ${titleCase(o.displayName)} to the owner portal?`,
      body: 'Creates an owner account with a temporary password. They can view their statements, revenue and property health, and approve quotes.',
      meta: o.email, confirmLabel: 'Send invite',
      onConfirm: async () => {
        setBusy(true);
        try {
          await api.post(`/owners/${o.id}/invite`);
          patch({ portalInvited: true });
          toast({ tone: 'success', title: 'Invite sent.', body: `${titleCase(o.displayName)} can now sign in to the owner portal.` });
        } catch (e) {
          toast({ tone: 'critical', title: 'Invite was not sent.', body: errorMessage(e, 'Try again in a moment.') });
        } finally { setBusy(false); setDialog(null); }
      },
    });
  }
  function deleteOwner() {
    if (!o) return;
    setDialog({
      title: `Delete ${titleCase(o.displayName)}?`,
      body: 'This permanently removes the owner record and their portal login, if any. Only possible when they have no units, contract or statement history.',
      meta: o.email, confirmLabel: 'Delete owner', busyLabel: 'Deleting…', danger: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          await api.del(`/owners/${o.id}`);
          toast({ tone: 'success', title: 'Owner deleted.', body: `${titleCase(o.displayName)} was removed.` });
          navigate('/owners');
        } catch (e) {
          toast({ tone: 'critical', title: 'Owner was not deleted.', body: errorMessage(e, 'Try again in a moment.') });
        } finally { setBusy(false); setDialog(null); }
      },
    });
  }

  const identity = [plural(o.units.length, 'unit'), o.icLast4 ? `IC ••••${o.icLast4}` : null, o.bankAccountLast4 ? `${o.bankName ?? 'Bank'} ••••${o.bankAccountLast4}` : null].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={titleCase(o.displayName)}
        back={{ label: 'All owners', onClick: () => navigate('/owners') }}
        badge={o.portalInvited ? <StatusBadge tone="success" label="Portal active" /> : <StatusBadge tone="neutral" label="Not invited" />}
        sub={
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            <span>{identity}</span>
            {o.email ? <a href={`mailto:${o.email}`} className="text-ink underline underline-offset-2">{o.email}</a> : <span>No email on file</span>}
            {o.phone && <PhoneText value={o.phone} className="text-ink" />}
          </span>
        }
        primary={o.portalInvited ? undefined : <Button size="sm" variant="secondary" icon={<Icon name="Mail" size="sm" />} onClick={invite}>Invite to portal</Button>}
      />

      {error && <StaleBanner message={`Showing the last record we have. ${error}`} onRetry={reload} />}

      {/* Month, report view and the report itself. */}
      <Card>
        <div className="flex flex-wrap items-center gap-3 py-3 px-4">
          <MonthStepper label={monthLabel(month)} onStep={by => setParam('month', shiftMonth(month, by) === shiftMonth(thisMonth, -1) ? null : shiftMonth(month, by))} />
          <span className="flex-1" />
          <Segmented<ReportView> label="Report by" value={view} onChange={v => setParam('report', v === 'owner' ? null : 'unit')}
            options={[{ key: 'owner', label: 'By owner' }, { key: 'unit', label: 'By unit' }]} />
          <Button size="sm" variant="primary" icon={<Icon name="FileText" size="sm" />} disabled={!reportHref}
            disabledReason={`No ${monthLabel(month)} statement for this owner yet. Generate it on Finance, Statements.`}
            onClick={() => { if (reportHref) window.location.hash = reportHref.slice(1); }}>Owner report PDF</Button>
        </div>
        <div className="px-4 pb-3 -mt-1 text-meta text-muted-ink">
          {view === 'owner' ? 'By owner: one report with every unit combined, then each unit.' : 'By unit: each unit on its own report, as the owner has always received it.'}
        </div>
      </Card>

      {o.units.length === 0 ? (
        <Card><EmptyState bare title="No units linked yet." body="Link a unit to assign it to this owner and set how they are paid." action={{ label: 'Link unit', onClick: () => setModal('link') }} /></Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4">
          {o.units.map(u => <UnitCard key={u.unitId} u={u} reportHref={st ? `#/finance/statements/${encodeURIComponent(st.id)}/report?unit=${encodeURIComponent(u.unitId)}` : null} />)}
        </div>
      )}

      {o.units.length > 0 && (
        <section aria-label={`${monthLabel(month)} total`} className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-3 py-5 px-5 sm:px-6 rounded-card bg-black text-white overflow-hidden">
          <span aria-hidden className="absolute left-5 sm:left-6 top-0 h-[2px] w-8 bg-gold" />
          <span className="flex flex-col gap-2.5 min-w-0">
            <Eyebrow className="text-gold!">{monthLabel(month, { long: true })} total · {plural(o.units.length, 'unit')}</Eyebrow>
            <MoneyText sen={total} mode="exact" className="text-[26px] sm:text-[30px] leading-none font-medium tracking-[-0.025em] text-white!" />
          </span>
          <span className="text-copy text-[var(--color-text-on-dark)]">
            Statement: {st ? statusLabel('statement', st.state) : 'not generated yet'}
            {st && <> · <a href={`#/finance/statements/${encodeURIComponent(st.id)}`} style={{ color: "var(--color-gold)" }}>Open statement</a></>}
          </span>
        </section>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-5 [align-items:start]">
        <ExpensesCard ownerId={o.id} month={month} units={unitChoices} canEdit onChanged={reload} />
        <OwnerAdjustments key={o.id} owner={o} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-5 [align-items:start]">
        <Card>
          <div className="p-5 flex flex-col gap-5">
            <PayoutDetails owner={o} />
            <StatementHistory key={o.id} o={o} />
          </div>
        </Card>
        <div className="flex flex-col gap-5 min-w-0">
          <Card>
            <div className="p-5 flex flex-col gap-5">
              <Section title="Units" action={<Button size="sm" variant="secondary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal('link')}>Link unit</Button>}>
                <div className="text-copy text-muted-ink">Each unit has its own contract and revenue model, set on the unit's Contract tab.</div>
              </Section>
              <Section title="Owner-level default fee" action={<Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setModal('defaultFee')}>{o.defaultManagementFeePct != null ? 'Change' : 'Set'}</Button>}>
                <div className="text-copy text-muted-ink leading-[1.6]">
                  {o.defaultManagementFeePct != null
                    ? <>Recorded for {titleCase(o.displayName)}: <strong className="font-semibold text-ink">{o.defaultManagementFeePct}%</strong>, for reference. Each unit's own contract decides its statement.</>
                    : <>No owner default set. Each unit's contract decides its statement.</>}
                </div>
              </Section>
            </div>
          </Card>
          <Card>
            <div className="py-4 px-5 flex flex-col gap-1.5">
              <span className="text-meta font-semibold text-danger">Danger zone</span>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-meta text-muted-ink text-pretty max-w-[300px]">{canDelete ? 'Removes this owner and their portal login. Cannot be undone.' : 'An owner with units or a contract cannot be deleted. Reassign or remove those first.'}</span>
                <Button size="sm" variant="tertiary" onClick={deleteOwner} disabled={!canDelete} disabledReason="This owner has units or a contract on file."
                  style={canDelete ? { color: 'var(--color-critical-fg)' } : undefined}>
                  Delete owner
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <RecordHistory entity="owners" id={o.id} refreshKey={data} />

      {modal === 'link' && <LinkUnitModal owner={o.displayName} units={rosterUnits} onClose={() => setModal(null)} onSubmit={linkUnit} />}
      {modal === 'defaultFee' && <DefaultFeeModal current={o.defaultManagementFeePct} owner={o.displayName} onClose={() => setModal(null)} onSubmit={saveDefaultFee} />}
      <ConfirmDialog spec={dialog} busy={busy} onClose={() => { if (!busy) setDialog(null); }} />
    </div>
  );
}

/** One unit's month, the way its revenue model pays the owner. */
function UnitCard({ u, reportHref }: { u: UnitLine; reportHref: string | null }) {
  const f = u.figures;
  const model: RevenueModel = u.revenueModel ?? (u.model === 'grr' ? 'grr' : 'management');
  const Row = ({ label, sen, muted, sign }: { label: string; sen: number; muted?: boolean; sign?: boolean }) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cx('text-meta min-w-0', muted ? 'text-faint' : 'text-muted-ink')}>{label}</span>
      <MoneyText sen={sen} mode="exact" tone={muted ? 'muted' : undefined} className={cx('text-copy text-right whitespace-nowrap', sign && sen > 0 ? 'before:content-["+_"]' : '')} />
    </div>
  );
  const operatorPct = u.feePct;
  return (
    <section className="bg-card border border-solid border-line rounded-card p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <a href={`#/properties/units/${encodeURIComponent(u.unitId)}?tab=contract`} className="text-[16px] font-semibold tracking-[-0.01em] text-ink! no-underline min-w-0 [overflow-wrap:anywhere]">{titleCase(u.unitLabel)}</a>
        <ModelChip model={model} label={terms(u)} />
      </div>
      {!f ? <div className="text-meta text-muted-ink">Figures are visible to finance and management.</div> : model === 'master_lease' ? <>
        <div className="text-meta text-muted-ink">{MODEL.master_lease.statement}</div>
        {f.adjustments !== 0 && <Row label="Owner credits & charges" sen={f.adjustments} sign />}
      </> : model === 'grr' ? <>
        <Row label="Fixed rent" sen={f.fixedRent} />
        {f.adjustments !== 0 && <Row label="Owner credits & charges" sen={f.adjustments} sign />}
        <Row label="Unit income (the company's)" sen={f.income} muted />
      </> : <>
        <Row label={model === 'long_term' ? 'Rent from tenant' : `Income (${f.nights} ${f.nights === 1 ? 'night' : 'nights'})`} sen={f.income} />
        <Row label="Costs the owner pays" sen={-f.costs} />
        <Row label={model === 'long_term' ? `Management fee ${operatorPct ?? 0}%` : `Management and agent ${operatorPct != null ? `${Number(operatorPct.toFixed(2))}%` : ''}`} sen={-f.operatorShare} />
        {f.guarantee > 0 && (f.topUp > 0
          ? <Row label={`Below the ${rm(f.guarantee)} minimum: top-up`} sen={f.topUp} sign />
          : <div className="text-meta text-muted-ink">Above the {rm(f.guarantee)} minimum</div>)}
        {f.adjustments !== 0 && <Row label="Owner credits & charges" sen={f.adjustments} sign />}
      </>}
      <div className="flex items-baseline justify-between gap-3 mt-auto pt-2 [border-top:1px_solid_var(--color-line-soft)]">
        <span className="text-copy font-semibold">Owner net</span>
        <MoneyText sen={f?.netPayout ?? u.net} mode="exact" strong className="text-copy" />
      </div>
      <div className="flex gap-3 text-meta">
        <a href={`#/properties/units/${encodeURIComponent(u.unitId)}?tab=financials`} className="text-gold-ink no-underline">Unit P&amp;L</a>
        {reportHref && <a href={reportHref} className="text-gold-ink no-underline">Unit report</a>}
      </div>
    </section>
  );
}

function DefaultFeeModal({ current, owner, onClose, onSubmit }: { current: number | null; owner: string; onClose: () => void; onSubmit: (pct: number | null) => void }) {
  const [parsed, setParsed] = useState<number | null>(current);
  const [busy, setBusy] = useState(false);
  const valid = parsed == null || (parsed >= 0 && parsed <= 100);
  return (
    <div role="dialog" aria-modal="true" aria-label="Owner default fee" className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div className="relative w-full max-w-[440px] bg-card rounded-card [box-shadow:var(--shadow-overlay)]">
        <form onSubmit={e => { e.preventDefault(); if (valid && !busy) { setBusy(true); onSubmit(parsed); } }}>
          <div className="pt-[22px] px-[22px] pb-1 flex flex-col gap-[5px]">
            <h2 className="m-0 text-title font-semibold">Owner default management fee</h2>
            <p className="m-0 text-copy text-muted-ink">Recorded for {titleCase(owner)} for reference. Leave blank to clear it.</p>
          </div>
          <div className="py-4 px-[22px]">
            <PercentInput label="Default management fee %" value={parsed} placeholder="e.g. 22"
              onChange={setParsed} help="A unit's own contract always decides its statement." />
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
