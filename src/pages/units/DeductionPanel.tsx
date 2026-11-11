import { useState } from 'react';
import { Drawer } from '../../components/Dialog';
import { CloseButton } from '../../components/CloseButton';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { FileRow, FileDropRow } from '../../components/Attachments';
import { MoneyInput, DateField } from '../../components/inputs';
import { Segmented } from '../../components/Metric';
import { UnitPicker } from '../../components/UnitPicker';
import { useToast } from '../../components/Toast';
import { useUnitRoster } from '../../lib/useUnitRoster';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { isStaged, stagedToast } from '../../lib/approvals';
import { refreshNavCounts } from '../../lib/navBadges';
import { monthLabel, rm, todayMyt } from '../../lib/format';

/** "Add deduction" (PLAN-deduction-panel.md): one line of the owner workbook's misc deductions sheet typed in by hand.
 *    Additional deduction  an owner-paid cost taken off before the operator's share: POST /api/expenses, category
 *                          'other'; the receipt is optional (owner, 4 Nov 2026; src/lib/receipts.ts)
 *    Owner adjustment (O2) money off or back to the owner after the operator's share: POST /api/owners/:id/adjustments
 *  Both keep their own approval and locked-month rules; the panel shows what the server says. */

export type DeductionType = 'additional' | 'o2';
type Direction = 'charge' | 'credit';

export interface DeductionPanelProps {
  month: string;
  /** May add owner adjustments (management, finance edit). Without it only Additional deduction is offered. */
  canAddO2: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const lastDayOf = (ym: string): string => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const TYPE_LABEL: Record<DeductionType, string> = { additional: 'Additional deduction', o2: 'Owner adjustment (O2)' };

export function DeductionPanel({ month, canAddO2, onClose, onSaved }: DeductionPanelProps): JSX.Element {
  const toast = useToast();
  const roster = useUnitRoster();
  const today = todayMyt();
  const [type, setType] = useState<DeductionType>('additional');
  const [direction, setDirection] = useState<Direction>('charge');
  const [unitId, setUnitId] = useState('');
  const [day, setDay] = useState(today.startsWith(month) ? today : lastDayOf(month));
  const [remarks, setRemarks] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});

  const unit = roster.find(u => u.id === unitId);
  const o2 = type === 'o2';
  const validDay = ISO_DAY.test(day);
  const noOwner = o2 && !!unit && !unit.ownerId;
  const ok = !!unit && !noOwner && validDay && !!remarks.trim() && amount != null && amount > 0;
  const why = !unit ? 'Pick the unit' : noOwner ? 'This unit has no owner on file' : !remarks.trim() ? 'Write the remarks'
    : amount == null || amount <= 0 ? 'Enter the total' : 'Enter the date';

  async function save(): Promise<void> {
    if (!ok || busy || !unit) return;
    setBusy(true); setFields({});
    try {
      let res: unknown;
      if (o2) {
        res = await api.post<unknown>(`/owners/${encodeURIComponent(unit.ownerId ?? '')}/adjustments`, {
          kind: direction, amount, occurredOn: day, unitId: unit.id, description: remarks.trim(),
        });
      } else {
        let receiptDocumentId: string | null = null;
        if (receipt) {
          const fd = new FormData();
          fd.append('file', receipt); fd.append('unitId', unit.id); fd.append('kind', 'receipt');
          ({ id: receiptDocumentId } = await api.post<{ id: string }>('/documents', fd));
        }
        res = await api.post<unknown>('/expenses', {
          unitId: unit.id, category: 'other', amount, incurredOn: day, chargeTo: 'owner', description: remarks.trim(), receiptDocumentId,
        });
      }
      if (isStaged(res)) { toast(stagedToast(res)); void refreshNavCounts(); }
      else {
        // Dated in a month whose deductions or O2 are locked, it goes to the next open month: the notice says where.
        const notice = (res as { notice?: string | null } | null)?.notice;
        if (notice) toast({ tone: 'info', title: `${TYPE_LABEL[type]} added.`, body: notice });
        else toast({ tone: 'success', title: `${TYPE_LABEL[type]} added.`, body: o2
          ? `${rm(amount ?? 0)} ${direction === 'charge' ? 'off' : 'back to'} the owner, after the operator's share, on the next statement from ${monthLabel(day.slice(0, 7))}.`
          : `${rm(amount ?? 0)} off ${monthLabel(day.slice(0, 7))}, before the operator's share.` });
      }
      onSaved(); onClose();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFields(e.fields);
      toast({ tone: 'critical', title: `${TYPE_LABEL[type]} was not added.`, body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  return (
    <Drawer open onClose={onClose} width={480} labelledBy="deduction-title">
      <div className="flex items-center justify-between px-6 max-sm:px-4 pt-[22px] pb-3.5">
        <h2 id="deduction-title" className="m-0 text-title font-semibold">Add deduction</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="px-6 max-sm:px-4 pb-5 grow flex flex-col gap-4">
        {canAddO2 && (
          <Segmented<DeductionType> label="Type" value={type} onChange={setType}
            options={[{ key: 'additional', label: TYPE_LABEL.additional }, { key: 'o2', label: TYPE_LABEL.o2 }]} />
        )}
        <p className="m-0 -mt-1 text-meta text-muted-ink">{o2
          ? 'Comes off, or goes back to, the owner after the operator\'s share. Listed under Owner Adjustments on the statement.'
          : 'An owner-paid cost taken off the unit\'s income before the operator\'s share. Listed under Additional Deduction.'}</p>
        <UnitPicker units={roster} value={unitId} onChange={setUnitId} error={fields.unitId ?? (noOwner ? 'This unit has no owner on file, so no owner adjustment can go on it.' : undefined)} />
        {o2 && (
          <Segmented<Direction> label="Direction" value={direction} onChange={setDirection}
            options={[{ key: 'charge', label: 'Deduct from owner' }, { key: 'credit', label: 'Give back to owner' }]} />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <DateField label="Date" value={day} onChange={setDay}
            error={fields.incurredOn ?? fields.occurredOn ?? (validDay ? undefined : 'Enter the date.')}
            help={validDay ? (o2 ? `Dated ${monthLabel(day.slice(0, 7), { long: true })}, or the next open month if its O2 is locked.`
              : `Goes on the ${monthLabel(day.slice(0, 7), { long: true })} statement, or on the next open one if its deductions are locked.`) : undefined} />
          <MoneyInput label="Total (RM)" placeholder="e.g. 120.50" minSen={1} valueSen={amount} onChangeSen={setAmount} error={fields.amount} />
        </div>
        <Field label="Remarks" placeholder={o2 ? 'e.g. Maintenance fee Oct 26' : 'e.g. Replaced aircon remote'} maxLength={o2 ? 200 : 300}
          value={remarks} onChange={e => setRemarks(e.target.value)} error={fields.description} />
        {!o2 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-meta font-medium text-muted-ink">Receipt (optional)</span>
            {receipt
              ? <FileRow file={{ id: 'receipt', name: receipt.name, size: receipt.size, onRemove: () => setReceipt(null), removeLabel: 'Remove receipt' }} />
              : <FileDropRow label="Add receipt" hint="Photo or PDF" accept="image/*,application/pdf" onPick={fl => setReceipt(fl.item(0))} />}
            {fields.receipt && <span className="text-meta text-critical">{fields.receipt}</span>}
          </div>
        )}
      </div>
      <div className="sticky bottom-0 flex justify-end items-center gap-2.5 px-6 max-sm:px-4 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" loading={busy} disabled={!ok} disabledReason={why} onClick={() => void save()}>Add deduction</Button>
      </div>
    </Drawer>
  );
}
