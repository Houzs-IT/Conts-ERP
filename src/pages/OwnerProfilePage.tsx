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
import { api, ApiFailure, errorMessage } from '../lib/api';
import { rm, monthLabel, todayMyt, titleCase, plural } from '../lib/format';
import { MODEL, type RevenueModel } from '../lib/revenueModel';
import { PayoutDetails } from './owners/PayoutDetails';
import { OwnerCostsCard } from './owners/Costs';
import { ModelChip } from './units/ContractTab';
import { RecordHistory } from '../components/RecordHistory';
import { MonthStepper, shiftMonth } from './finance/listKit';
import { cx } from '../lib/design-tokens';
import { Segmented, StatTile, StatRow } from '../components/Metric';
import {
  type Owner, type UnitLine, type Payload,
  FALLBACK, terms, Section, StatementHistory, LinkUnitModal,
} from './owners/shared';
import { statusLabel } from '../lib/status';
import { PhoneText } from '../components/PhoneText';

/**
 * The OWNER PROFILE (`#/owners/:id`): one card per unit with its revenue model and the month's Unit P&L (Gross Income,
 * each deduction, To Operator, what comes off after the split, Net Payout to Owner), worked out by the statement
 * engine (GET /api/owners?id=&month=), the month's totals, and the Owner Income Report by owner (all units combined)
 * or by unit, generated here when the month has no owner statement yet. Below: expenses by unit (Cleaning,
 * Maintenance, each bill paid on behalf), payout details (edited here; they are the owner's, not a unit's) and the
 * statement history, each statement's make-up opening in place.
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
        {loading ? <ProfileSkeleton /> : (
          <EmptyState icon="UserX" title="Owner not found" body={error ?? 'This owner is no longer on file.'}
            action={{ label: 'Back to owners', onClick: () => navigate('/owners') }} />
        )}
      </div>
    );
  }

  const patch = (p: Partial<Owner>) => setEdits(e => ({ ...e, ...p }));
  const canDelete = o.units.length === 0 && !o.contract;
  // The month's totals as the owner statement adds them: a fixed-rent or master-lease unit brings its rent, not the
  // unit's trading (its income, costs and the rest are The Conts').
  const figures = o.units.filter(u => u.figures).map(u => ({ fixed: u.revenueModel === 'grr' || u.revenueModel === 'master_lease', f: u.figures! }));
  const sum = (k: 'income' | 'costs' | 'operatorShare' | 'adjustments') => figures.reduce((n, { fixed, f }) => n + (k === 'adjustments' ? f[k] : fixed ? (k === 'income' ? f.fixedRent : 0) : f[k]), 0);
  const total = o.units.reduce((n, u) => n + (u.figures?.netPayout ?? u.net), 0);
  const st = o.statement ?? null;
  const reportHref = st?.hasUnits ? `#/finance/statements/${encodeURIComponent(st.id)}/report${view === 'owner' ? '?view=owner' : ''}` : null;
  const unitChoices = o.units.map(u => ({ id: u.unitId, label: u.unitLabel }));
  // What the report button does for the month: open the report; for a month paid before Property OS (no unit figures),
  // the statement as it was paid; otherwise build this owner's statement first (a draft, or a draft rebuilt).
  const reportAction: 'open' | 'legacy' | 'generate' = reportHref ? 'open' : st && st.state !== 'provisional' ? 'legacy' : 'generate';

  async function ownerReport() {
    if (!o) return;
    if (reportAction === 'open' && reportHref) { window.location.hash = reportHref.slice(1); return; }
    if (reportAction === 'legacy' && st) { window.open(`/api/statements/${encodeURIComponent(st.id)}/pdf?format=legacy`, '_blank', 'noopener'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ count: number; skipped: number; statements?: { ownerId: string; id: string }[] }>('/statements/generate', { period: month, ownerIds: [o.id] });
      const made = r.statements?.find(x => x.ownerId === o.id);
      if (!made) {
        toast({ tone: 'info', title: `Nothing to report for ${monthLabel(month)}.`, body: r.skipped ? 'This owner statement is already final; open it from the statement history.' : 'No bookings, costs or charges on this owner\'s units that month.' });
        return;
      }
      toast({ tone: 'success', title: `Owner statement for ${monthLabel(month)} generated as a draft.`, body: 'Opening the Owner Income Report. Review it on Owner statements before sending.' });
      window.location.hash = `#/finance/statements/${encodeURIComponent(made.id)}/report${view === 'owner' ? '?view=owner' : ''}`;
    } catch (e) {
      const locked = e instanceof ApiFailure && e.status === 409;
      toast({ tone: locked ? 'warning' : 'critical', title: locked ? 'That month is already sent.' : 'The owner report was not generated.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

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
          <span className="text-meta text-muted-ink">Owner statement: {st ? statusLabel('statement', st.state) : 'not generated yet'}
            {st && <> · <a href={`#/finance/statements/${encodeURIComponent(st.id)}`} className="text-gold-ink no-underline font-medium">Open</a></>}
          </span>
          <span className="flex-1" />
          <Segmented<ReportView> label="Report by" value={view} onChange={v => setParam('report', v === 'owner' ? null : 'unit')}
            options={[{ key: 'owner', label: 'By owner' }, { key: 'unit', label: 'By unit' }]} />
          <Button size="sm" variant="primary" icon={<Icon name="FileText" size="sm" />} loading={busy && reportAction === 'generate'} disabled={o.units.length === 0}
            disabledReason="Link a unit to this owner first." onClick={() => void ownerReport()}>
            {reportAction === 'generate' ? 'Generate owner report' : reportAction === 'legacy' ? 'Owner statement PDF' : 'Owner report PDF'}
          </Button>
        </div>
        <div className="px-4 pb-3 -mt-1 text-meta text-muted-ink">
          {reportAction === 'generate'
            ? `No ${monthLabel(month)} owner statement with unit figures yet: the button builds this owner's as a draft, then opens the report.`
            : reportAction === 'legacy' ? `${monthLabel(month)} was paid from the owner workbook before Property OS, so it has the statement as paid, not an Owner Income Report.`
            : view === 'owner' ? 'By owner: one report with every unit combined, then each unit.' : 'By unit: each unit on its own report, as the owner has always received it.'}
        </div>
      </Card>

      {o.units.length > 0 && (
        <StatRow cols={5}>
          <StatTile className="col-span-2 xl:col-span-1" hero label={`Net Payout to Owner · ${monthLabel(month)}`} value={rm(total)} hint={plural(o.units.length, 'unit')} />
          <StatTile label="Gross Income" value={figures.length ? rm(sum('income')) : undefined} />
          <StatTile label="Deductions" value={figures.length ? rm(sum('costs')) : undefined} hint="Before the split" />
          <StatTile label="To Operator" value={figures.length ? rm(sum('operatorShare')) : undefined} />
          <StatTile label="Paid on behalf, after the split" value={figures.length ? rm(-sum('adjustments')) : undefined} />
        </StatRow>
      )}

      {o.units.length === 0 ? (
        <Card><EmptyState bare title="No units linked yet." body="Link a unit to assign it to this owner and set how they are paid." action={{ label: 'Link unit', onClick: () => setModal('link') }} /></Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4">
          {o.units.map(u => <UnitCard key={u.unitId} u={u} reportHref={st?.hasUnits ? `#/finance/statements/${encodeURIComponent(st.id)}/report?unit=${encodeURIComponent(u.unitId)}` : null} />)}
        </div>
      )}

      {o.units.length > 0 && <OwnerCostsCard ownerId={o.id} ownerName={o.displayName} month={month} units={unitChoices} canEdit onChanged={reload} />}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-5 [align-items:start]">
        <Card>
          <div className="p-5 flex flex-col gap-5">
            <PayoutDetails owner={o} canEdit onSaved={reload} />
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
                    ? <>Recorded for {titleCase(o.displayName)}: <strong className="font-semibold text-ink">{o.defaultManagementFeePct}%</strong>, for reference. Each unit's own contract decides its owner statement.</>
                    : <>No owner default set. Each unit's contract decides its owner statement.</>}
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

/** One unit's month, the way its revenue model pays the owner: its Unit P&L, which rolls up to the owner. */
function UnitCard({ u, reportHref }: { u: UnitLine; reportHref: string | null }) {
  const f = u.figures;
  const model: RevenueModel = u.revenueModel ?? (u.model === 'grr' ? 'grr' : 'management');
  const Row = ({ label, sen, muted, sign, indent }: { label: string; sen: number; muted?: boolean; sign?: boolean; indent?: boolean }) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cx('text-meta min-w-0', muted ? 'text-faint' : 'text-muted-ink', indent && 'pl-3')}>{label}</span>
      <MoneyText sen={sen} mode="exact" tone={muted ? 'muted' : undefined} className={cx('text-copy text-right whitespace-nowrap', sign && sen > 0 ? 'before:content-["+_"]' : '')} />
    </div>
  );
  const after = (sen: number) => sen !== 0 && <Row label={sen < 0 ? 'Paid on behalf, after the split' : 'Credit to owner, after the split'} sen={sen} sign />;
  const operatorPct = u.feePct;
  return (
    <section className="bg-card border border-solid border-line rounded-card p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <a href={`#/properties/units/${encodeURIComponent(u.unitId)}?tab=contract`} className="text-[16px] font-semibold tracking-[-0.01em] text-ink! no-underline min-w-0 [overflow-wrap:anywhere]">{titleCase(u.unitLabel)}</a>
        <ModelChip model={model} label={terms(u)} />
      </div>
      {!f ? <div className="text-meta text-muted-ink">Figures are visible to finance and management.</div> : model === 'master_lease' ? <>
        <div className="text-meta text-muted-ink">{MODEL.master_lease.statement}</div>
        {after(f.adjustments)}
      </> : model === 'grr' ? <>
        <Row label="Fixed rent" sen={f.fixedRent} />
        {after(f.adjustments)}
        <Row label="Unit income (The Conts')" sen={f.income} muted />
      </> : <>
        <Row label={model === 'long_term' ? 'Gross Income (rent from tenant)' : `Gross Income (${f.nights} ${f.nights === 1 ? 'night' : 'nights'})`} sen={f.income} />
        {f.costLines.length === 0
          ? <Row label="Deductions" sen={0} muted />
          : f.costLines.map(c => <Row key={c.label} label={c.label} sen={-c.amount} indent />)}
        <Row label={model === 'long_term' ? `Management fee ${operatorPct ?? 0}%` : `${operatorPct != null ? `${Number(operatorPct.toFixed(2))}% ` : ''}To Operator`} sen={-f.operatorShare} />
        {f.guarantee > 0 && (f.topUp > 0
          ? <Row label={`Below the ${rm(f.guarantee)} minimum: top-up`} sen={f.topUp} sign />
          : <div className="text-meta text-muted-ink">Above the {rm(f.guarantee)} minimum</div>)}
        {after(f.adjustments)}
      </>}
      <div className="flex items-baseline justify-between gap-3 mt-auto pt-2 [border-top:1px_solid_var(--color-line-soft)]">
        <span className="text-copy font-semibold">Net Payout to Owner</span>
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

/** The profile before it arrives: the month bar, then a unit card per column with its statement lines. */
function ProfileSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-5">
      <Card>
        <div className="flex items-center gap-3 py-3 px-4">
          <div className="skeleton h-9 w-[150px] rounded-control!" />
          <div className="skeleton h-[11px] w-[180px] max-sm:hidden" />
          <span className="flex-1" />
          <div className="skeleton h-9 w-[130px] rounded-control!" />
        </div>
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1].map(i => (
          <div key={i} className={cx('bg-card border border-solid border-line rounded-card p-4 flex flex-col gap-3', i > 0 && 'max-lg:hidden')}>
            <div className="flex justify-between"><div className="skeleton h-[16px] w-[45%]" /><div className="skeleton h-[20px] w-[90px] rounded-pill!" /></div>
            {[70, 52, 60, 44, 58].map((w, r) => (
              <div key={r} className="flex justify-between gap-4"><div className="skeleton h-[11px]" style={{ width: `${w}%` }} /><div className="skeleton h-[11px] w-[64px]" /></div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
