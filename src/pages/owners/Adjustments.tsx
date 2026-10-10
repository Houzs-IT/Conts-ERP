import { useMemo, useState } from 'react';
import { Card, CardHeader } from '../../components/Card';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { Field } from '../../components/Field';
import { Select, Menu, type MenuItem } from '../../components/Select';
import { ConfirmDialog, type ConfirmSpec } from '../../components/ConfirmDialog';
import { MoneyText, moneyString } from '../../components/MoneyText';
import { DataTable, type Column } from '../../components/DataTable';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, errorMessage } from '../../lib/api';
import { date, monthLabel, todayMyt, plural } from '../../lib/format';
import type { Tone } from '../../lib/types';
import type { Owner } from './shared';
import { Modal } from './shared';
import ApprovalBanner from '../../components/ApprovalBanner';
import { isStaged, stagedToast, type Approval, type Staged } from '../../lib/approvals';
import { refreshNavCounts } from '../../lib/navBadges';

/** Money for or against the owner outside bookings and expenses (GET /api/owners/:id/adjustments): workbook
 *  credits, debts carried over, manual credits and charges. A held one waits until someone releases it;
 *  nothing is released automatically. */

type State = 'open' | 'held' | 'settled';
interface Adjustment {
  id: string; kind: 'credit' | 'charge' | 'opening_debt'; amount: number; description: string; occurredOn: string; reference: string | null;
  state: State; settledNote: string | null; source: 'manual' | 'owner_workbook'; createdAt: string;
  unit: { id: string; label: string } | null;
  statement: { id: string; period: string; state: string } | null;
}
interface Payload { generatedAt: string; canChange: boolean; totals: { held: number; open: number }; data: Adjustment[] }

const KIND: Record<Adjustment['kind'], string> = { credit: 'Credit', charge: 'Charge', opening_debt: 'Debt carried over' };
const STATE: Record<State, { label: string; tone: Tone }> = {
  held: { label: 'Held', tone: 'warning' }, open: { label: 'Open', tone: 'info' }, settled: { label: 'Settled', tone: 'neutral' },
};
const FINAL = ['finalised', 'sent', 'paid'];
const FILTERS = [
  { value: 'all', label: 'All credits and charges' }, { value: 'held', label: 'Held' }, { value: 'open', label: 'Open' }, { value: 'settled', label: 'Settled' },
];

const addMonths = (ym: string, by: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export function OwnerAdjustments({ owner }: { owner: Owner }) {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<Payload>(`/owners/${encodeURIComponent(owner.id)}/adjustments`);
  const pending = useApi<{ data: Approval[] }>(`/approvals?entity=owners&entityId=${encodeURIComponent(owner.id)}`);
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState<null | { kind: 'release' | 'settle'; a: Adjustment } | { kind: 'add' }>(null);
  const [dialog, setDialog] = useState<ConfirmSpec | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = data?.data ?? [];
  const list = filter === 'all' ? rows : rows.filter(a => a.state === filter);
  const canChange = !!data?.canChange;
  const held = rows.filter(a => a.state === 'held');

  async function change(a: Adjustment, body: Record<string, unknown>, done: string, after?: string) {
    setBusy(true);
    try {
      const r = await api.patch<{ regenerate?: string | null } | Staged>(`/owners/${encodeURIComponent(owner.id)}/adjustments/${encodeURIComponent(a.id)}`, body);
      if (isStaged(r)) { toast(stagedToast(r)); setModal(null); setDialog(null); pending.reload(); void refreshNavCounts(); return; }
      toast({ tone: 'success', title: done, body: r?.regenerate ? `Regenerate the ${monthLabel(r.regenerate)} statements to take it off that statement.` : after });
      setModal(null); setDialog(null); reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'Nothing was changed.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  function actions(a: Adjustment): MenuItem[] {
    const onFinal = a.statement && FINAL.includes(a.statement.state)
      ? `The ${monthLabel(a.statement.period)} statement carries it and is final.` : undefined;
    const items: MenuItem[] = [];
    if (a.state === 'held') items.push({ key: 'release', label: 'Release', icon: 'Play', hint: 'The statement for the month you pick deducts it.', onSelect: () => setModal({ kind: 'release', a }) });
    if (a.state === 'open') items.push({
      key: 'hold', label: 'Hold', icon: 'Pause', hint: 'Keep it off statements until released.', disabledReason: onFinal,
      onSelect: () => setDialog({
        title: 'Hold this credit or charge?', body: 'It stays off every statement generated from now on, until someone releases it.',
        meta: `${KIND[a.kind]} · ${moneyString(a.amount, 'exact')} · ${a.description}`, danger: true, confirmLabel: 'Hold', busyLabel: 'Holding...',
        onConfirm: () => change(a, { action: 'hold' }, 'Held.'),
      }),
    });
    if (a.state !== 'settled') items.push({ key: 'settle', label: a.state === 'held' ? 'Write off or settle outside' : 'Mark settled outside', icon: 'CheckCircle2',
      hint: a.state === 'held' ? 'Never deducted from a statement. Needs a second person to approve.' : 'Paid outside Property OS; it never reaches a statement.', disabledReason: onFinal, onSelect: () => setModal({ kind: 'settle', a }) });
    return items;
  }

  const columns = useMemo<Column<Adjustment>[]>(() => [
    { key: 'description', label: 'Description', value: a => a.description, hideable: false, width: 260,
      render: a => (
        <span className="flex flex-col gap-0.5 min-w-0 py-1">
          <span className="text-copy font-medium [overflow-wrap:anywhere] whitespace-normal">{a.description}</span>
          {a.statement && (
            <a href={`#/finance/statements/${encodeURIComponent(a.statement.id)}`} onClick={e => e.stopPropagation()} className="text-meta text-ink underline underline-offset-2 self-start">
              {a.state === 'settled' ? 'Settled on' : 'On'} the {monthLabel(a.statement.period)} statement
            </a>
          )}
          {a.state === 'settled' && a.settledNote && <span className="text-meta text-muted-ink [overflow-wrap:anywhere] whitespace-normal">Settled outside: {a.settledNote}</span>}
        </span>
      ) },
    { key: 'kind', label: 'Kind', value: a => KIND[a.kind], width: 120, filter: { kind: 'select' },
      sub: a => (a.source === 'owner_workbook' ? 'from the owner workbook' : null) },
    { key: 'date', label: 'Date', type: 'date', value: a => a.occurredOn, width: 110 },
    { key: 'unit', label: 'Unit', value: a => a.unit?.label ?? null, hidden: true, width: 160 },
    { key: 'statement', label: 'Statement', value: a => (a.statement ? a.statement.period : null), text: a => (a.statement ? monthLabel(a.statement.period) : ''), hidden: true, width: 110 },
    { key: 'reference', label: 'Reference', value: a => a.reference, hidden: true, width: 130 },
    { key: 'note', label: 'Settled note', value: a => a.settledNote, hidden: true, width: 200 },
    { key: 'amount', label: 'Amount', type: 'money', value: a => a.amount, width: 120,
      render: a => <MoneyText sen={a.amount} mode="exact" strong className="text-copy" /> },
    { key: 'state', label: 'Status', type: 'status', value: a => STATE[a.state].label, status: a => STATE[a.state], width: 100 },
    // Inline buttons, not the row menu: a table cell clips a drop-down.
    ...(canChange ? [{ key: 'actions', label: 'Actions', width: 200, noExport: true, sortable: false, filter: false as const,
      render: (a: Adjustment) => (
        <span className="flex items-center gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
          {actions(a).map(it => (
            <Button key={it.key} size="sm" variant="tertiary" icon={it.icon ? <Icon name={it.icon} size="sm" /> : undefined} title={it.hint}
              disabled={!!it.disabledReason} disabledReason={it.disabledReason} onClick={it.onSelect}>{it.key === 'settle' ? 'Settle outside' : it.label}</Button>
          ))}
        </span>
      ) }] : []),
  ], [canChange]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card>
      <CardHeader title="Owner credits & charges" right={canChange ? <Button size="sm" variant="secondary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({ kind: 'add' })}>Add credit or charge</Button> : undefined} />
      {(pending.data?.data.length ?? 0) > 0 && <div className="px-5 pb-3"><ApprovalBanner items={pending.data!.data} onChanged={() => { pending.reload(); reload(); void refreshNavCounts(); }} /></div>}
      <div className="px-5 pb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-meta text-muted-ink text-pretty max-w-[640px]">
          {held.length
            ? <>{plural(held.length, 'held credit or charge', 'held credits and charges')} worth <MoneyText sen={data!.totals.held} mode="exact" strong className="text-ink" /> {held.length === 1 ? 'is' : 'are'} waiting to be released. Held amounts never reach a statement by themselves.</>
            : 'Money for or against the owner that is not a booking or a unit expense (a refund of overpaid water, an old debt, a maintenance fee charged to the owner). Each one sits on a unit; open ones go on the next statement generated.'}
        </span>
      </div>

      <div className="[border-top:1px_solid_var(--color-line-soft)]">
        <DataTable<Adjustment> id="owner.adjustments" urlPrefix="adj." bare noViews pageSize={10} maxHeight="520px"
          columns={columns} rows={data ? list : null} rowKey={a => a.id} loading={loading} error={error} onRetry={reload}
          noun={['credit or charge', 'credits and charges']} exportName={`${owner.displayName} credits and charges`}
          filtered={filter !== 'all'} onClearFilters={() => setFilter('all')}
          toolbar={rows.length > 0 ? <div className="w-[200px] max-w-full"><Select label="Show" value={filter} onChange={setFilter} options={FILTERS} /></div> : undefined}
          empty={{ title: 'No credits or charges for this owner.', icon: 'Scale' }}
          renderCard={a => {
            const items = canChange ? actions(a) : [];
            return (
              <span className="flex items-start justify-between gap-3 min-w-0">
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-copy font-medium [overflow-wrap:anywhere]">{a.description}</span>
                  <span className="text-meta text-muted-ink">{[KIND[a.kind], date(a.occurredOn), a.unit?.label, a.source === 'owner_workbook' ? 'from the owner workbook' : null].filter(Boolean).join(' · ')}</span>
                  {a.statement && <span className="text-meta text-muted-ink">{a.state === 'settled' ? 'Settled on' : 'On'} the {monthLabel(a.statement.period)} statement</span>}
                  {a.state === 'settled' && a.settledNote && <span className="text-meta text-muted-ink [overflow-wrap:anywhere]">Settled outside: {a.settledNote}</span>}
                </span>
                <span className="flex flex-col items-end gap-1 shrink-0">
                  <MoneyText sen={a.amount} mode="exact" strong className="text-copy" />
                  <StatusBadge tone={STATE[a.state].tone} label={STATE[a.state].label} size="sm" />
                  {items.length > 0 && <span onClick={e => e.stopPropagation()}><Menu label={`Actions for ${a.description}`} items={items} trigger={<span className="grid place-items-center w-8 h-8 rounded-control border border-solid border-line bg-card text-ink"><Icon name="MoreHorizontal" size="sm" /></span>} /></span>}
                </span>
              </span>
            );
          }} />
      </div>

      {modal?.kind === 'release' && <ReleaseModal a={modal.a} busy={busy} onClose={() => setModal(null)} onSubmit={month => change(modal.a, { action: 'release', month }, 'Released.', `Generate or regenerate the ${monthLabel(month)} statements to deduct it.`)} />}
      {modal?.kind === 'settle' && <SettleModal a={modal.a} busy={busy} onClose={() => setModal(null)} onSubmit={note => change(modal.a, { action: 'settle', note }, 'Marked settled outside.')} />}
      {modal?.kind === 'add' && <AddModal owner={owner} busy={busy} onClose={() => setModal(null)} onSubmit={async body => {
        setBusy(true);
        try {
          // Credits and charges change what the owner is paid: they wait for a second person's approval.
          const r = await api.post<unknown>(`/owners/${encodeURIComponent(owner.id)}/adjustments`, body);
          if (isStaged(r)) toast(stagedToast(r));
          else toast({ tone: 'success', title: body.kind === 'credit' ? 'Credit added.' : 'Charge added.', body: 'The next statement generated for that month carries it.' });
          setModal(null); reload(); pending.reload(); void refreshNavCounts();
        } catch (e) {
          toast({ tone: 'critical', title: 'Nothing was added.', body: errorMessage(e, 'Try again in a moment.') });
        } finally { setBusy(false); }
      }} />}
      <ConfirmDialog spec={dialog} busy={busy} onClose={() => { if (!busy) setDialog(null); }} />
    </Card>
  );
}

function ReleaseModal({ a, busy, onClose, onSubmit }: { a: Adjustment; busy: boolean; onClose: () => void; onSubmit: (month: string) => void }) {
  const thisMonth = todayMyt().slice(0, 7);
  const options = [-3, -2, -1, 0, 1, 2].map(n => addMonths(thisMonth, n)).map(m => ({ value: m, label: `${monthLabel(m, { long: true })} statement` }));
  const [month, setMonth] = useState(addMonths(thisMonth, -1));
  return (
    <Modal title="Release this credit or charge?" sub={`${moneyString(a.amount, 'exact')} · ${a.description}`} onClose={onClose}
      submitLabel={busy ? 'Releasing...' : 'Release'} canSubmit={!busy} onSubmit={() => onSubmit(month)}>
      <Select label="Deduct on" showLabel size="md" value={month} onChange={setMonth} options={options} />
      <p className="m-0 text-meta text-muted-ink text-pretty">
        It goes on this owner's {monthLabel(month, { long: true })} statement when that month is generated, or regenerated while still provisional.
        If that statement is already final, pick a later month.
      </p>
    </Modal>
  );
}

function SettleModal({ a, busy, onClose, onSubmit }: { a: Adjustment; busy: boolean; onClose: () => void; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <Modal title="Mark settled outside?" sub={`${moneyString(a.amount, 'exact')} · ${a.description}. It will never go on a statement.`} onClose={onClose}
      submitLabel={busy ? 'Saving...' : 'Mark settled'} canSubmit={!busy && note.trim().length > 0}
      onSubmit={() => onSubmit(note.trim())}>
      <Field label="Where was it settled?" placeholder="e.g. Owner paid by bank transfer on 3 Oct" maxLength={300} value={note} onChange={e => setNote(e.target.value)} />
    </Modal>
  );
}

function AddModal({ owner, busy, onClose, onSubmit }: { owner: Owner; busy: boolean; onClose: () => void; onSubmit: (b: { kind: 'credit' | 'charge'; amount: number; description: string; occurredOn: string; unitId: string | null }) => void }) {
  const [kind, setKind] = useState<'credit' | 'charge'>('charge');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [occurredOn, setOccurredOn] = useState(todayMyt());
  const [unitId, setUnitId] = useState('');
  const sen = Math.round(Number(amount) * 100);
  const valid = Number.isFinite(sen) && sen > 0 && description.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(occurredOn);
  return (
    <Modal title="Add credit or charge" sub={`For ${owner.displayName}. It goes on the next statement generated for a month ending on or after the date.`} onClose={onClose}
      submitLabel={busy ? 'Adding...' : 'Add'} canSubmit={valid && !busy}
      onSubmit={() => onSubmit({ kind, amount: sen, description: description.trim(), occurredOn, unitId: unitId || null })}>
      <Select label="Kind" showLabel size="md" value={kind} onChange={v => setKind(v as 'credit' | 'charge')}
        options={[{ value: 'charge', label: 'Charge: deducted from the payout' }, { value: 'credit', label: 'Credit: added to the payout' }]} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (RM)" type="number" min={0} step="0.01" numeric placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
        <Field label="Date" type="date" value={occurredOn} onChange={e => setOccurredOn(e.target.value)} />
      </div>
      <Field label="Description" placeholder="e.g. Replacement kettle" maxLength={200} value={description} onChange={e => setDescription(e.target.value)} />
      {owner.units.length > 1 && (
        <Select label="Unit" showLabel size="md" value={unitId} onChange={setUnitId} placeholder="First unit on the statement"
          options={owner.units.map(u => ({ value: u.unitId, label: u.unitLabel }))} />
      )}
    </Modal>
  );
}
