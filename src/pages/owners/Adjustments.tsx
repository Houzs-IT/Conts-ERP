import { useState } from 'react';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { Field } from '../../components/Field';
import { Select, type MenuItem } from '../../components/Select';
import { ConfirmDialog, type ConfirmSpec } from '../../components/ConfirmDialog';
import { moneyString } from '../../components/MoneyText';
import { useToast } from '../../components/Toast';
import { api, errorMessage } from '../../lib/api';
import { monthLabel, todayMyt } from '../../lib/format';
import { isStaged, stagedToast, useApprovalsOn, type Staged } from '../../lib/approvals';
import { refreshNavCounts } from '../../lib/navBadges';
import { Modal } from './shared';

/** Owner credits and charges (owner_adjustments: the workbook's O2 lines such as "MAINTENANCE FEE SEPT 26", debts
 *  carried over, credits). Owner, 11 Oct 2026: they are listed with the bills paid on the owner's behalf on the unit
 *  they sit on (owners/Costs.tsx) and new ones are entered as bills; these are the actions on the ones on file.
 *  A held one waits until someone releases it into a statement month; nothing is released automatically. Their
 *  statement maths is unchanged: they come off after the split. */

export interface AdjustmentLike {
  id: string; kind: string; amount: number; description: string; state: string;
  statement: { id: string; period: string; state: string } | null;
}

export const ADJUSTMENT_KIND: Record<string, string> = { credit: 'Credit to owner', charge: 'Charge to owner', opening_debt: 'Debt carried over' };
export const ADJUSTMENT_STATE: Record<string, { label: string; tone: 'warning' | 'info' | 'neutral' }> = {
  held: { label: 'Held', tone: 'warning' }, open: { label: 'Open', tone: 'info' }, settled: { label: 'Settled', tone: 'neutral' },
};
const FINAL = ['finalised', 'sent', 'paid'];

const addMonths = (ym: string, by: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Release / Hold / Settle outside for one credit or charge, as inline buttons with their dialogs. */
export function AdjustmentActions({ ownerId, a, onChanged }: { ownerId: string; a: AdjustmentLike; onChanged: () => void }) {
  const toast = useToast();
  const approvalsOn = useApprovalsOn();
  const [modal, setModal] = useState<null | 'release' | 'settle'>(null);
  const [dialog, setDialog] = useState<ConfirmSpec | null>(null);
  const [busy, setBusy] = useState(false);

  async function change(body: Record<string, unknown>, done: string, after?: string) {
    setBusy(true);
    try {
      const r = await api.patch<{ regenerate?: string | null } | Staged>(`/owners/${encodeURIComponent(ownerId)}/adjustments/${encodeURIComponent(a.id)}`, body);
      if (isStaged(r)) { toast(stagedToast(r)); setModal(null); setDialog(null); void refreshNavCounts(); onChanged(); return; }
      toast({ tone: 'success', title: done, body: r?.regenerate ? `Regenerate the ${monthLabel(r.regenerate)} owner statements to take it off that statement.` : after });
      setModal(null); setDialog(null); onChanged();
    } catch (e) {
      toast({ tone: 'critical', title: 'Nothing was changed.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  const onFinal = a.statement && FINAL.includes(a.statement.state) ? `The ${monthLabel(a.statement.period)} owner statement carries it and is final.` : undefined;
  const items: MenuItem[] = [];
  if (a.state === 'held') items.push({ key: 'release', label: 'Release', icon: 'Play', hint: 'The owner statement for the month you pick deducts it.', onSelect: () => setModal('release') });
  if (a.state === 'open') items.push({
    key: 'hold', label: 'Hold', icon: 'Pause', hint: 'Keep it off owner statements until released.', disabledReason: onFinal,
    onSelect: () => setDialog({
      title: 'Hold this amount?', body: 'It stays off every owner statement generated from now on, until someone releases it.',
      meta: `${ADJUSTMENT_KIND[a.kind] ?? a.kind} · ${moneyString(a.amount, 'exact')} · ${a.description}`, danger: true, confirmLabel: 'Hold', busyLabel: 'Holding...',
      onConfirm: () => change({ action: 'hold' }, 'Held.'),
    }),
  });
  if (a.state !== 'settled') items.push({ key: 'settle', label: 'Settle outside', icon: 'CheckCircle2',
    hint: a.state === 'held' ? `Never deducted from an owner statement.${approvalsOn ? ' Needs a second person to approve.' : ''}` : 'Paid outside Property OS; it never reaches an owner statement.',
    disabledReason: onFinal, onSelect: () => setModal('settle') });
  if (!items.length) return null;

  return (
    <span className="inline-flex items-center gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
      {items.map(it => (
        <Button key={it.key} size="sm" variant="tertiary" icon={it.icon ? <Icon name={it.icon} size="sm" /> : undefined} title={it.hint}
          disabled={!!it.disabledReason} disabledReason={it.disabledReason} onClick={it.onSelect}>{it.label}</Button>
      ))}
      {modal === 'release' && <ReleaseModal a={a} busy={busy} onClose={() => setModal(null)}
        onSubmit={month => change({ action: 'release', month }, 'Released.', `Generate or regenerate the ${monthLabel(month)} owner statements to deduct it.`)} />}
      {modal === 'settle' && <SettleModal a={a} busy={busy} onClose={() => setModal(null)} onSubmit={note => change({ action: 'settle', note }, 'Marked settled outside.')} />}
      <ConfirmDialog spec={dialog} busy={busy} onClose={() => { if (!busy) setDialog(null); }} />
    </span>
  );
}

function ReleaseModal({ a, busy, onClose, onSubmit }: { a: AdjustmentLike; busy: boolean; onClose: () => void; onSubmit: (month: string) => void }) {
  const thisMonth = todayMyt().slice(0, 7);
  const options = [-3, -2, -1, 0, 1, 2].map(n => addMonths(thisMonth, n)).map(m => ({ value: m, label: `${monthLabel(m, { long: true })} owner statement` }));
  const [month, setMonth] = useState(addMonths(thisMonth, -1));
  return (
    <Modal title="Release this amount?" sub={`${moneyString(a.amount, 'exact')} · ${a.description}`} onClose={onClose}
      submitLabel={busy ? 'Releasing...' : 'Release'} canSubmit={!busy} onSubmit={() => onSubmit(month)}>
      <Select label="Deduct on" showLabel size="md" value={month} onChange={setMonth} options={options} />
      <p className="m-0 text-meta text-muted-ink text-pretty">
        It goes on this owner's {monthLabel(month, { long: true })} owner statement when that month is generated, or regenerated while still a draft.
        If that statement is already final, pick a later month.
      </p>
    </Modal>
  );
}

function SettleModal({ a, busy, onClose, onSubmit }: { a: AdjustmentLike; busy: boolean; onClose: () => void; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <Modal title="Mark settled outside?" sub={`${moneyString(a.amount, 'exact')} · ${a.description}. It will never go on an owner statement.`} onClose={onClose}
      submitLabel={busy ? 'Saving...' : 'Mark settled'} canSubmit={!busy && note.trim().length > 0}
      onSubmit={() => onSubmit(note.trim())}>
      <Field label="Where was it settled?" placeholder="e.g. Owner paid by bank transfer on 3 Oct" maxLength={300} value={note} onChange={e => setNote(e.target.value)} />
    </Modal>
  );
}
