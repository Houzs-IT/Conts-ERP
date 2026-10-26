import { useMemo, useState } from 'react';
import { Card } from '../../components/Card';
import { FileRow, FileDropRow } from '../../components/Attachments';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { MoneyInput, DateField } from '../../components/inputs';
import { MoneyText } from '../../components/MoneyText';
import { StatusBadge } from '../../components/StatusBadge';
import Icon from '../../components/Icon';
import { DataTable, type Column } from '../../components/DataTable';
import { StatTile, StatRow, Segmented, Eyebrow } from '../../components/Metric';
import { ConfirmButton } from '../../components/ConfirmDialog';
import { MonthStepper, shiftMonth } from '../finance/listKit';
import ApprovalBanner from '../../components/ApprovalBanner';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, notifyFailure, errorMessage } from '../../lib/api';
import { isStaged, stagedToast, type Approval } from '../../lib/approvals';
import { refreshNavCounts } from '../../lib/navBadges';
import { rm, monthLabel, date as fmtDate, todayMyt, titleCase, plural } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import { PAYER_LABEL, PAYERS } from '../../lib/revenueModel';
import { UtilitiesModal, type UnitChoice } from './ExpenseEntry';
import { AdjustmentActions, ADJUSTMENT_KIND, ADJUSTMENT_STATE } from './Adjustments';
import { ReceiptCell } from '../../components/ReceiptCell';
import { receiptRequired, missingReceipt } from '../../lib/receipts';
import { Link } from 'react-router-dom';

/** A month's costs the way the owner reads them (GET /api/expenses/breakdown, functions/_lib/unitCosts.ts):
 *  Cleaning fees, Maintenance repair, Utilities (water, electricity, Wi-Fi, IndahWater), Maintenance fee (condo) and
 *  Other fees (owner's names, 11 Oct 2026), each totalled from the
 *  expenses recorded to the unit. What the owner pays is deducted before the operator's share; what The Conts, a tenant
 *  or a guest paid is shown apart and never deducted. The owner's credits and charges on file (the workbook's O2 lines,
 *  and the Maintenance fee (condo) added here) are listed with the bills and come off after the split. */

type Group = 'cleaning' | 'maintenance' | 'utilities' | 'maintenance_fee' | 'other';
/** The bills listed one by one: everything but cleaning and repairs. */
const isBill = (g: Group) => g === 'utilities' || g === 'maintenance_fee' || g === 'other';
interface Kind { key: string; label: string; group: Group; amount: number; others: number; afterSplit: number }
interface Totals { cleaning: number; maintenance: number; utilities: number; maintenanceFee: number; other: number; deducted: number; notCharged: number; credits: number; charges: number }
interface Breakdown { totals: Totals; kinds: Kind[] }
interface UnitCosts extends Breakdown { unitId: string; unitLabel: string; revenueModel: string; deductsFromOwner: boolean }
export interface CostItem {
  id: string; unitId: string; unitLabel: string; kind: string; kindLabel: string; group: Group; category: string; description: string;
  amount: number; chargeTo: string; incurredOn: string; reference: string | null; receiptDocumentId: string | null; locked: boolean;
  source: string; taskId: string | null; maintenanceId: string | null;
}
export interface AdjustmentItem {
  id: string; unitId: string; unitLabel: string; placedOnFirstUnit: boolean; kind: string; amount: number; description: string; isMaintenanceFee: boolean;
  occurredOn: string; reference: string | null; state: string; source: string; inMonth: boolean;
  statement: { id: string; period: string; state: string } | null;
}
interface UnchargedClean { taskId: string; unitId: string; unitLabel: string; kind: string; title: string; doneOn: string; sameDayCost: boolean }
interface Payload { month: string; canChangeAdjustments: boolean; units: UnitCosts[]; total: Breakdown; items: CostItem[]; adjustments: AdjustmentItem[]; unchargedCleans: UnchargedClean[] }

/** The kinds of cost "Add a bill" records. Value = expenses.category, except building_fee: the condo's maintenance
 *  fee, an owner charge after the split (not an expense). Cleaning and repairs normally arrive from their jobs; they are
 *  here for one that has no job (an extra clean, a repair paid directly). */
export const BILL_KINDS = [
  { value: 'water', label: 'Water' }, { value: 'electricity', label: 'Electricity' }, { value: 'internet', label: 'Wi-Fi' },
  { value: 'sewerage', label: 'IndahWater' }, { value: 'building_fee', label: 'Maintenance fee (condo)' },
  { value: 'cleaning', label: 'Cleaning fee (no cleaning job)' }, { value: 'maintenance', label: 'Maintenance repair (no maintenance job)' },
  { value: 'other', label: 'Other fees' },
];
const UTILITY = new Set(['water', 'electricity', 'internet', 'sewerage']);
const shortKind = (label: string) => label.replace(/ \(no .*\)$/, '');

/** The owner workbook's month words on its O2 lines ("MAINTENANCE FEE SEPT 26"). */
const FEE_MONTH = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEPT', 'OCT', 'NOV', 'DEC'];
/** 2026-09-30 -> "MAINTENANCE FEE SEPT 26"; typed text is kept, in capitals, led by MAINTENANCE FEE. */
export const maintenanceFeeText = (typed: string, isoDate: string) => {
  const t = typed.trim().toUpperCase();
  if (t) return /^MAINTENANCE FEE\b/.test(t) ? t : `MAINTENANCE FEE ${t}`;
  return `MAINTENANCE FEE ${FEE_MONTH[Number(isoDate.slice(5, 7)) - 1]} ${isoDate.slice(2, 4)}`;
};

const lastDayOf = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

interface UtilityAccount { accountId: string; unitId: string; kind: string; accountNo: string; provider: string | null; expenseId: string | null; amount: number | null; recordedElsewhere: boolean }

/** "Add a bill": one form for every bill and cost entered by hand (water, electricity, Wi-Fi, IndahWater, the condo's
 *  maintenance fee, a clean or repair with no job, other fees), the same flow whoever paid it. The bill date is
 *  required: it decides the month and the owner statement the cost lands on. A utility bill takes the unit's account
 *  number (Details tab) as its reference, as the monthly utility bills screen does, so both read as the same bill.
 *  Recorded to the unit (POST /api/expenses); only what the owner pays is deducted. The condo's maintenance fee comes
 *  off after the operator's share (the owner's report lists it below "Payout Before O2 Adjustment"), so it is an owner
 *  charge (POST /api/owners/:id/adjustments, with the approval and audit of any owner charge), offered only to those
 *  who may add owner charges. */
export function BillModal({ units, defaultUnitId, ownerId, canAdjust, month, onClose, onSaved }: {
  units: UnitChoice[]; defaultUnitId?: string; ownerId: string; canAdjust: boolean; month: string; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const today = todayMyt();
  const [unitId, setUnitId] = useState(defaultUnitId ?? units[0]?.id ?? '');
  const [category, setCategory] = useState('water');
  const [amount, setAmount] = useState<number | null>(null);
  const [incurredOn, setIncurredOn] = useState(today.startsWith(month) ? today : lastDayOf(month));
  const [chargeTo, setChargeTo] = useState('owner');
  const [account, setAccount] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const validDay = ISO_DAY.test(incurredOn);
  const billMonth = validDay ? incurredOn.slice(0, 7) : month;
  const accountsApi = useApi<{ data: UtilityAccount[] }>(`/expenses/utilities?month=${billMonth}&unitId=${encodeURIComponent(unitId)}`);
  const accounts = (accountsApi.data?.data ?? []).filter(a => a.kind === category);
  // The first account is picked until someone chooses; '' means "another account", typed by hand.
  const picked = UTILITY.has(category) && account !== '' ? accounts.find(a => a.accountId === account) ?? accounts[0] : undefined;
  const fee = category === 'building_fee';
  const needsReceipt = !fee && receiptRequired(category, chargeTo);
  const ok = !!unitId && amount != null && amount > 0 && validDay && (!needsReceipt || !!receipt);
  const kinds = canAdjust ? BILL_KINDS : BILL_KINDS.filter(k => k.value !== 'building_fee');
  const kind = shortKind(BILL_KINDS.find(k => k.value === category)?.label ?? category);
  const payer = PAYERS.find(p => p.value === chargeTo);

  async function save() {
    if (!ok || busy) return;
    setBusy(true); setFields({});
    try {
      if (fee) {
        const res = await api.post<unknown>(`/owners/${encodeURIComponent(ownerId)}/adjustments`, {
          kind: 'charge', amount, occurredOn: incurredOn, unitId, reference: reference.trim() || null, description: maintenanceFeeText(description, incurredOn),
        });
        if (isStaged(res)) { toast(stagedToast(res)); void refreshNavCounts(); onSaved(); onClose(); return; }
        toast({ tone: 'success', title: 'Maintenance fee recorded.', body: `On the ${monthLabel(billMonth)} costs. The owner statement deducts it after the operator's share.` });
        onSaved(); onClose(); return;
      }
      let receiptDocumentId: string | null = null;
      if (receipt) {
        const fd = new FormData();
        fd.append('file', receipt); fd.append('unitId', unitId); fd.append('kind', 'receipt');
        receiptDocumentId = (await api.post<{ id: string }>('/documents', fd)).id;
      }
      const text = description.trim() || `${kind} ${monthLabel(billMonth)}${picked?.provider ? ` (${picked.provider})` : ''}`;
      const res = await api.post<unknown>('/expenses', {
        unitId, category, amount, incurredOn, chargeTo, reference: picked?.accountNo || reference.trim() || null, description: text, receiptDocumentId,
      });
      if (isStaged(res)) { toast(stagedToast(res)); void refreshNavCounts(); onSaved(); onClose(); return; }
      toast({ tone: 'success', title: 'Bill recorded.', body: `${kind}, ${monthLabel(billMonth)}. ${chargeTo === 'owner' ? 'The owner statement deducts it before the operator\'s share.' : `${PAYER_LABEL[chargeTo] ?? chargeTo} pays: not on the owner statement.`}` });
      onSaved(); onClose();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFields(e.fields);
      toast({ tone: 'critical', title: 'Bill was not recorded.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  const already = picked?.expenseId && picked.amount != null ? picked : null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Add a bill" className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)]">
      <div onClick={onClose} className="absolute inset-0" />
      <div className="relative w-full max-w-[520px] max-h-[calc(100vh-32px)] flex flex-col bg-card rounded-card shadow-[var(--shadow-overlay)]">
        <div className="pt-[22px] px-[22px] pb-1 flex-none">
          <h2 className="m-0 text-title font-semibold">Add a bill</h2>
          <p className="mt-[5px] mb-0 text-copy text-muted-ink">{fee
            ? 'The condo\'s maintenance fee, paid for the owner. The owner statement deducts it after the operator\'s share.'
            : 'A bill or cost on the unit. The bill date decides the month and the owner statement it goes on.'}</p>
        </div>
        <div className="py-4 px-[22px] flex flex-col gap-[14px] overflow-y-auto min-h-0">
          {units.length > 1 && <Select showLabel size="md" label="Unit" value={unitId} onChange={v => { setUnitId(v); setAccount(null); }} options={units.map(u => ({ value: u.id, label: titleCase(u.label) }))} />}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select showLabel size="md" label="Bill" value={category} onChange={v => { setCategory(v); setAccount(null); }} options={kinds} />
            <MoneyInput label="Amount (RM)" placeholder="e.g. 120.50" minSen={1} valueSen={amount} onChangeSen={setAmount} error={fields.amount} />
            <DateField label="Bill date" value={incurredOn} onChange={setIncurredOn}
              error={fields.incurredOn ?? (validDay ? undefined : 'A bill date is required.')}
              help={validDay ? `Goes on ${monthLabel(billMonth, { long: true })}.` : undefined} />
            {fee
              ? <Field label="Reference (optional)" placeholder="Bill number" maxLength={80} value={reference} onChange={e => setReference(e.target.value)} />
              : <Select showLabel size="md" label="Paid by" value={chargeTo} onChange={setChargeTo} options={PAYERS.map(p => ({ value: p.value, label: p.label }))} />}
          </div>
          {!fee && payer && <p className="m-0 -mt-1 text-meta text-muted-ink">{payer.help}</p>}
          {UTILITY.has(category) && accounts.length > 0 && (
            <Select showLabel size="md" label="Account" value={picked?.accountId ?? ''} onChange={v => setAccount(v)}
              options={[...accounts.map(a => ({ value: a.accountId, label: `${a.accountNo}${a.provider ? ` · ${a.provider}` : ''}` })), { value: '', label: 'Another account (type the reference)' }]} />
          )}
          {!fee && !picked && <Field label="Reference (optional)" placeholder="Bill or account number" maxLength={80} value={reference} onChange={e => setReference(e.target.value)} />}
          {already && (
            <p className="m-0 text-meta text-warning">Already recorded for {monthLabel(billMonth)} on this account: {rm(already.amount ?? 0)}. Adding this records a second bill.</p>
          )}
          <Field label="Description (optional)" placeholder={fee ? `e.g. ${maintenanceFeeText('', validDay ? incurredOn : lastDayOf(month))}` : `e.g. ${kind} ${monthLabel(billMonth)}`} maxLength={fee ? 200 : 300}
            value={description} onChange={e => setDescription(e.target.value)} error={fields.description} />
          {!fee && <div className="flex flex-col gap-1.5">
            <span className="text-meta font-medium text-muted-ink">{needsReceipt ? 'Receipt' : 'Receipt (optional)'}</span>
            {receipt
              ? <FileRow file={{ id: 'receipt', name: receipt.name, size: receipt.size, onRemove: () => setReceipt(null), removeLabel: 'Remove receipt' }} />
              : <FileDropRow label="Add receipt" hint="Photo or PDF" accept="image/*,application/pdf" onPick={fl => setReceipt(fl.item(0))} />}
            {fields.receipt ? <span className="text-meta text-critical">{fields.receipt}</span>
              : needsReceipt && !receipt && <span className="text-meta text-muted-ink">The owner pays this bill, so its receipt goes with it.</span>}
          </div>}
        </div>
        <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex justify-end flex-wrap gap-[9px] flex-none">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!ok} disabledReason={needsReceipt && !receipt && amount && validDay ? 'Attach the receipt: the owner pays this bill' : 'Pick the bill and enter the amount and bill date'} onClick={() => void save()}>Add bill</Button>
        </div>
      </div>
    </div>
  );
}

/** One line of a breakdown: label, amount; zero amounts stay listed, greyed, so every kind is accounted for. */
function Line({ label, sen, sub, strong, indent }: { label: string; sen: number; sub?: string; strong?: boolean; indent?: boolean }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-3 py-[7px]', strong && 'pt-[10px] [border-top:1px_solid_var(--color-line-soft)]')}>
      <span className={cx('min-w-0 flex flex-col', indent && 'pl-3')}>
        <span className={cx('text-copy', strong ? 'font-semibold text-ink' : sen ? 'text-ink' : 'text-faint')}>{label}</span>
        {sub && <span className="text-caption text-muted-ink">{sub}</span>}
      </span>
      <MoneyText sen={sen} mode="exact" tone={!strong && !sen ? 'muted' : undefined} strong={strong} className="text-copy text-right whitespace-nowrap" />
    </div>
  );
}

/** Maintenance fee (condo): what comes off after the split, and any saved as an expense before the split (to check). */
const feeNote = (k: Kind) => [
  k.afterSplit ? `${rm(k.afterSplit)} after the operator's share` : null,
  k.amount ? 'Entered before the split: check' : null,
  k.others ? `Also ${rm(k.others)} paid by others, not deducted` : null,
].filter(Boolean).join(' · ') || undefined;

/** Cleaning fees, Maintenance repair, Utilities (each kind), Maintenance fee (condo), Other fees when not zero, and the
 *  total the owner pays before the split. */
function KindBreakdown({ b, deducts = true }: { b: Breakdown; deducts?: boolean }) {
  const by = (g: Group) => b.kinds.filter(k => k.group === g);
  const others = (k: Kind) => (k.others ? `Also ${rm(k.others)} paid by others, not deducted` : undefined);
  return (
    <div className="flex flex-col">
      {by('cleaning').map(k => <Line key={k.key} label="Cleaning fees" sen={k.amount} sub={others(k)} />)}
      {by('maintenance').map(k => <Line key={k.key} label="Maintenance repair" sen={k.amount} sub={others(k)} />)}
      <span className="pt-2 pb-0.5"><Eyebrow>Utilities</Eyebrow></span>
      {by('utilities').map(k => <Line key={k.key} label={k.label} sen={k.amount} sub={others(k)} indent />)}
      {by('maintenance_fee').map(k => <Line key={k.key} label="Maintenance fee (condo)" sen={k.amount + k.afterSplit} sub={feeNote(k)} />)}
      {by('other').filter(k => k.amount || k.others).map(k => <Line key={k.key} label="Other fees" sen={k.amount} sub={others(k)} />)}
      <Line label={deducts ? 'Deducted before the split' : 'Owner-paid costs (the company bears them on this contract)'} sen={b.totals.deducted} strong />
      {(b.totals.charges > 0 || b.totals.credits > 0) && (
        <span className="text-meta text-muted-ink pt-1">
          After the split: {b.totals.charges > 0 && <>maintenance fee and other charges <MoneyText sen={b.totals.charges} mode="exact" className="text-ink" /></>}
          {b.totals.charges > 0 && b.totals.credits > 0 && ', '}
          {b.totals.credits > 0 && <>credit to owner <MoneyText sen={b.totals.credits} mode="exact" className="text-ink" /></>}
        </span>
      )}
    </div>
  );
}

/** The bills (utilities, maintenance fee, other fees) and the owner's credits and charges, one list. */
function PaidOnBehalfList({ items, adjustments, ownerId, showUnit, canChange, canAddReceipt = false, onChanged }: {
  items: CostItem[]; adjustments: AdjustmentItem[]; ownerId: string; showUnit: boolean; canChange: boolean; canAddReceipt?: boolean; onChanged: () => void;
}) {
  if (!items.length && !adjustments.length) return <div className="py-3 text-copy text-muted-ink">No bills or maintenance fee this month.</div>;
  return (
    <div className="flex flex-col">
      {items.map(it => (
        <div key={it.id} className="flex items-start justify-between gap-3 py-[9px] [border-top:1px_solid_var(--color-line-soft)] first:border-t-0">
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className="text-copy text-ink [overflow-wrap:anywhere]">{it.description || it.kindLabel}</span>
            <span className="text-meta text-muted-ink">
              {[it.kindLabel, fmtDate(it.incurredOn), showUnit ? titleCase(it.unitLabel) : null, it.reference].filter(Boolean).join(' · ')}
              {(it.receiptDocumentId || missingReceipt(it)) && <> · <ReceiptCell expenseId={it.id} unitId={it.unitId} receiptDocumentId={it.receiptDocumentId} missing={missingReceipt(it)} canAdd={canAddReceipt} onAdded={onChanged} /></>}
            </span>
          </span>
          <span className="flex flex-col items-end shrink-0">
            <MoneyText sen={it.amount} mode="exact" className="text-copy font-medium" />
            <span className={cx('text-caption', it.chargeTo === 'owner' && it.kind === 'building_fee' ? 'text-warning' : 'text-muted-ink')}>
              {it.chargeTo !== 'owner' ? `${PAYER_LABEL[it.chargeTo] ?? it.chargeTo} pays, not deducted` : it.kind === 'building_fee' ? 'Entered before the split: check' : 'Before the split'}
            </span>
          </span>
        </div>
      ))}
      {adjustments.map(a => (
        <div key={a.id} className="flex items-start justify-between gap-3 py-[9px] [border-top:1px_solid_var(--color-line-soft)] first:border-t-0">
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className="text-copy text-ink [overflow-wrap:anywhere]">{a.description}</span>
            <span className="text-meta text-muted-ink">
              {[ADJUSTMENT_KIND[a.kind] ?? a.kind, fmtDate(a.occurredOn), showUnit ? titleCase(a.unitLabel) : null, a.source === 'owner_workbook' ? 'from the owner workbook' : null].filter(Boolean).join(' · ')}
            </span>
            {a.placedOnFirstUnit && <span className="text-caption text-muted-ink">Recorded for the owner, not a unit: the statement puts it on this unit.</span>}
            {a.statement && <Link to={`/owners/statements/${encodeURIComponent(a.statement.id)}`} className="text-meta text-ink underline underline-offset-2 self-start">On the {monthLabel(a.statement.period)} owner statement</Link>}
            {canChange && <span className="pt-0.5"><AdjustmentActions ownerId={ownerId} a={a} onChanged={onChanged} /></span>}
          </span>
          <span className="flex flex-col items-end gap-1 shrink-0">
            <MoneyText sen={Math.abs(a.amount)} mode="exact" className={cx('text-copy font-medium', a.amount > 0 && 'before:content-["+_"]')} />
            <span className="text-caption text-muted-ink">{a.amount > 0 ? 'Credit to owner, after the split' : 'Deducted after the split'}</span>
            <StatusBadge tone={ADJUSTMENT_STATE[a.state]?.tone ?? 'neutral'} label={ADJUSTMENT_STATE[a.state]?.label ?? a.state} size="sm" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** How a cost reached the unit, in the owner's words. */
export const HOW: Record<string, string> = {
  cleaning_job: 'Cleaning job', maintenance_job: 'Maintenance job', bill: 'Bill', manual: 'Manual', import: 'Imported',
};

/** One line of the unit's cost table: an expense, or an owner credit or charge dated in the month. */
export interface CostLine {
  id: string; unitLabel: string; date: string; description: string; kindLabel: string; how: string; amount: number;
  /** before: the owner pays, deducted before the operator's share; after: an owner charge after it; credit: money to the
   *  owner; others: The Conts, a tenant or a guest paid, not deducted. */
  effect: 'before' | 'after' | 'credit' | 'others'; payer: string; receiptDocumentId: string | null;
  /** The expense behind the line (null for an owner credit or charge), and whether it is an owner-paid bill with no receipt. */
  expenseId: string | null; unitId: string; missingReceipt: boolean;
}
const EFFECT: Record<CostLine['effect'], string> = { before: 'Owner, before the split', after: 'Owner, after the split', credit: 'Credit to owner', others: 'not deducted' };
const effectText = (l: CostLine) => (l.effect === 'others' ? `${l.payer}, not deducted` : EFFECT[l.effect]);

/** The month's expenses and its own owner credits and charges, as one dated list (oldest first). Held ones, and open
 *  ones from earlier months still waiting for a statement, are not costs of this month: they are listed apart. */
export function costLines(items: CostItem[], adjustments: AdjustmentItem[]): CostLine[] {
  const lines: CostLine[] = items.map(i => ({
    id: i.id, unitLabel: i.unitLabel, date: i.incurredOn, description: i.description || i.kindLabel, kindLabel: i.kindLabel, how: HOW[i.source] ?? 'Manual',
    amount: i.amount, effect: i.chargeTo === 'owner' ? 'before' : 'others', payer: PAYER_LABEL[i.chargeTo] ?? i.chargeTo, receiptDocumentId: i.receiptDocumentId,
    expenseId: i.id, unitId: i.unitId, missingReceipt: missingReceipt(i),
  }));
  for (const a of adjustments) {
    if (!a.inMonth || a.state === 'held') continue;
    lines.push({
      id: a.id, unitLabel: a.unitLabel, date: a.occurredOn, description: a.description,
      kindLabel: a.isMaintenanceFee ? 'Maintenance fee (condo)' : ADJUSTMENT_KIND[a.kind] ?? a.kind,
      how: a.source === 'owner_workbook' ? 'Imported' : a.isMaintenanceFee ? 'Bill' : 'Manual',
      amount: Math.abs(a.amount), effect: a.amount < 0 ? 'after' : 'credit', payer: 'Owner', receiptDocumentId: null,
      expenseId: null, unitId: a.unitId, missingReceipt: false,
    });
  }
  return lines.sort((x, y) => x.date.localeCompare(y.date));
}

/** The receipt of a line, or "No receipt" with "Add receipt" on an owner-paid bill that has none. */
function LineReceipt({ r, canAdd, onAdded }: { r: CostLine; canAdd: boolean; onAdded: () => void }) {
  if (!r.expenseId) return <span className="text-meta text-muted-ink">—</span>;
  return <ReceiptCell expenseId={r.expenseId} unitId={r.unitId} receiptDocumentId={r.receiptDocumentId} missing={r.missingReceipt} canAdd={canAdd} onAdded={onAdded} />;
}

/** The columns of a cost table; `unit` adds the unit when it lists several. With `canAdd`, a bill without its receipt
 *  offers "Add receipt". */
export function costColumns(unit: boolean, canAdd = false, onAdded: () => void = () => {}): Column<CostLine>[] {
  return [
    { key: 'date', label: 'Date', type: 'date', value: r => r.date, width: 110 },
    ...(unit ? [{ key: 'unit', label: 'Unit', value: (r: CostLine) => r.unitLabel, width: 170, filter: { kind: 'select' as const } }] : []),
    { key: 'description', label: 'Cost', value: r => r.description, hideable: false, width: 220, sub: r => r.kindLabel },
    { key: 'kind', label: 'Kind', value: r => r.kindLabel, hidden: true, width: 150, filter: { kind: 'select' } },
    { key: 'how', label: 'How it arrived', value: r => r.how, width: 130, filter: { kind: 'select' } },
    { key: 'payer', label: 'Paid by', value: effectText, width: 170, filter: { kind: 'select' },
      render: r => <span className={cx('text-meta', r.effect === 'others' ? 'text-muted-ink' : 'text-ink font-medium')}>{effectText(r)}</span> },
    { key: 'amount', label: 'Amount', type: 'money', value: r => (r.effect === 'credit' ? -r.amount : r.amount), width: 110,
      render: r => <MoneyText sen={r.amount} mode="exact" className={cx('text-copy font-medium', r.effect === 'credit' && 'before:content-["+_"]')} /> },
    { key: 'receipt', label: 'Receipt', width: 120, noExport: true, sortable: false, filter: false, render: r => <LineReceipt r={r} canAdd={canAdd} onAdded={onAdded} /> },
  ];
}

export function CostCard({ r, unit, canAdd = false, onAdded = () => {} }: { r: CostLine; unit: boolean; canAdd?: boolean; onAdded?: () => void }) {
  return (
    <span className="flex items-start justify-between gap-3 min-w-0">
      <span className="flex flex-col min-w-0">
        {unit && <span className="text-meta text-muted-ink truncate">{titleCase(r.unitLabel)}</span>}
        <span className="text-copy truncate" title={r.description}>{r.description}</span>
        <span className="text-meta text-muted-ink">{fmtDate(r.date)} · {r.kindLabel} · {r.how}</span>
        {(r.receiptDocumentId || r.missingReceipt) && <span className="pt-0.5"><LineReceipt r={r} canAdd={canAdd} onAdded={onAdded} /></span>}
      </span>
      <span className="flex flex-col items-end shrink-0">
        <MoneyText sen={r.amount} mode="exact" className={cx('text-copy font-medium', r.effect === 'credit' && 'before:content-["+_"]')} />
        <span className="text-caption text-muted-ink">{effectText(r)}</span>
      </span>
    </span>
  );
}

/** What the table adds up to, in the cards' terms: before the split (the "Deducted before the split" card), after
 *  it, credits, and what others paid. */
export function CostTotals({ lines }: { lines: CostLine[] }) {
  const sum = (e: CostLine['effect']) => lines.filter(l => l.effect === e).reduce((n, l) => n + l.amount, 0);
  const parts: [string, number][] = [['owner pays before the split', sum('before')], ['after the split', sum('after')], ['credit to owner', sum('credit')], ['others paid, not deducted', sum('others')]];
  return (
    <div className="px-5 py-3 [border-top:1px_solid_var(--color-line-soft)] text-meta text-muted-ink flex flex-wrap gap-x-4 gap-y-1">
      <span className="text-ink font-medium">{plural(lines.length, 'cost')}</span>
      {parts.filter(([, n], i) => n || i === 0).map(([label, n]) => (
        <span key={label}>{label} <MoneyText sen={n} mode="exact" className="text-ink font-medium" /></span>
      ))}
    </div>
  );
}

/** Unit Financials, "Costs": every cost on the unit in a month, from one source (GET /api/expenses/breakdown,
 *  functions/_lib/unitCosts.ts, the rows and month rule the owner statement uses). Costs arrive three ways: a finished
 *  cleaning job, a maintenance job on its billing date, and Add a bill (utilities, the condo fee, anything else). The
 *  cards total the table. Finished cleans that carry no cost are offered to charge. */
export function UnitCostsCard({ unitId, ownerId, unitLabel, canEdit, cleaningPrice, deepCleaningPrice, legacyCosts, onChanged, month: shownMonth }: {
  unitId: string; ownerId: string; unitLabel: string; canEdit: boolean; cleaningPrice: number | null | undefined; deepCleaningPrice?: number | null;
  legacyCosts: { category: string; amount: number }[]; onChanged: () => void;
  /** The month to show, when the page around the card picks it (unit Financials); without it the card steps its own. */
  month?: string;
}) {
  const toast = useToast();
  const thisMonth = todayMyt().slice(0, 7);
  const [ownMonth, setMonth] = useState(thisMonth);
  const month = shownMonth ?? ownMonth;
  const { data, loading, error, reload } = useApi<Payload>(`/expenses/breakdown?month=${month}&unitId=${encodeURIComponent(unitId)}`);
  const [modal, setModal] = useState<null | 'bill'>(null);
  const [charging, setCharging] = useState(false);
  const u = data?.units[0];
  const t = u?.totals;
  const value = (sen: number | undefined) => (sen === undefined ? undefined : rm(sen));
  const changed = () => { reload(); onChanged(); };
  const lines = useMemo(() => (data ? costLines(data.items, data.adjustments) : null), [data]);
  const waiting = (data?.adjustments ?? []).filter(a => !a.inMonth || a.state === 'held');
  const uncharged = data?.unchargedCleans ?? [];
  const columns = useMemo(() => costColumns(false, canEdit, changed), [canEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  async function chargeCleans() {
    setCharging(true);
    try {
      const r = await api.post<{ charged: { amount: number }[]; skipped: { reason: string }[] }>('/expenses/clean-charges', { unitId, month });
      const sum = r.charged.reduce((n, c) => n + c.amount, 0);
      toast({ tone: r.skipped.length ? 'warning' : 'success', title: `${plural(r.charged.length, 'cleaning job')} charged, ${rm(sum)}.`,
        body: r.skipped.length ? `${plural(r.skipped.length, 'cleaning job')} not charged: ${[...new Set(r.skipped.map(s => s.reason))].join('; ')}.` : `On the ${monthLabel(month)} costs, dated the day each was finished.` });
      changed();
    } catch (e) { notifyFailure(e); } finally { setCharging(false); }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
        <div className="flex flex-col gap-1 min-w-0 flex-[1_1_260px]">
          <span className="text-[16px] font-semibold tracking-[-0.01em]">Costs</span>
          <span className="text-meta text-muted-ink [text-wrap:pretty]">Every cost recorded to {unitLabel}, by its date: cleaning jobs when finished, maintenance jobs on their billing date, and bills. The date decides the month and the owner statement. The cards total the table.</span>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {shownMonth
            ? <span className="text-meta text-muted-ink">{monthLabel(month)}{month === thisMonth ? ' so far' : ''}</span>
            : <MonthStepper label={monthLabel(month)} note={month === thisMonth ? 'so far' : undefined} onStep={by => setMonth(m => shiftMonth(m, by))} />}
          {canEdit && <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal('bill')}>Add a bill</Button>}
        </div>
      </div>
      {error && !data ? <div className="p-5 text-copy text-critical">{error}</div> : (
        <div className="p-5 flex flex-col gap-4">
          {uncharged.length > 0 && (
            <div className="rounded-control border border-solid border-warning-line bg-warning-bg px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-copy text-ink min-w-0 flex-[1_1_260px] [text-wrap:pretty]">
                {plural(uncharged.length, 'finished cleaning job')} in {monthLabel(month)} {uncharged.length === 1 ? 'has' : 'have'} no cost yet
                ({uncharged.map(c => fmtDate(c.doneOn)).join(', ')}). Imported as done without a price, or finished on a day that already had a cleaning cost.
              </span>
              {canEdit && (
                <ConfirmButton variant="secondary" size="sm" onConfirm={chargeCleans} disabled={charging}
                  confirm={{ title: `Charge ${plural(uncharged.length, 'cleaning job')} to ${unitLabel}?`, danger: false, confirmLabel: 'Charge cleaning jobs',
                    body: `Each is charged at the unit's cleaning price${cleaningPrice ? ` (${rm(cleaningPrice)} for a standard clean)` : ''}, owner pays, dated the day it was finished. A day that already has a cleaning cost is skipped.` }}>
                  Charge {plural(uncharged.length, 'cleaning job')}
                </ConfirmButton>
              )}
            </div>
          )}
          <StatRow cols={5}>
            <StatTile label="Cleaning fees" value={value(t?.cleaning)} loading={loading && !data} />
            <StatTile label="Maintenance repair" value={value(t?.maintenance)} loading={loading && !data} />
            <StatTile label="Utilities" value={value(t?.utilities)} loading={loading && !data} />
            <StatTile label="Maintenance fee (condo)" value={value(t?.maintenanceFee)} loading={loading && !data} hint="After the operator's share" />
            <StatTile label={u && !u.deductsFromOwner ? 'Owner-paid costs' : 'Deducted before the split'} value={value(t?.deducted)} loading={loading && !data}
              hint={t && t.notCharged ? `${rm(t.notCharged)} more paid by The Conts, a tenant or a guest, not deducted` : undefined} />
          </StatRow>
          {u && !u.deductsFromOwner && <p className="m-0 text-meta text-muted-ink">On this unit's contract the owner gets a fixed rent, so these costs do not change what the owner is paid.</p>}
        </div>
      )}
      <div className="[border-top:1px_solid_var(--color-line-soft)]">
        <DataTable<CostLine> id="unit.costs" urlPrefix="cost." bare noViews pageSize={0} maxHeight="520px"
          columns={columns} rows={lines} rowKey={r => r.id} loading={loading} error={error} onRetry={reload}
          noun={['cost', 'costs']} exportName={`${unitLabel} costs ${month}`}
          empty={{ title: `No costs recorded for ${monthLabel(month)}.`, icon: 'Receipt' }}
          renderCard={r => <CostCard r={r} unit={false} canAdd={canEdit} onAdded={changed} />}
          footer={lines && lines.length > 0 ? <CostTotals lines={lines} /> : undefined} />
      </div>
      {data && waiting.length > 0 && (
        <div className="px-5 py-4 [border-top:1px_solid_var(--color-line-soft)] flex flex-col gap-2">
          <Eyebrow>Owner adjustments waiting for a statement</Eyebrow>
          <PaidOnBehalfList items={[]} adjustments={waiting} ownerId={ownerId} showUnit={false} canChange={canEdit && data.canChangeAdjustments} onChanged={changed} />
        </div>
      )}
      <div className="px-5 pb-5">
        <CleaningPrice unitId={unitId} price={cleaningPrice} deepPrice={deepCleaningPrice} legacy={legacyCosts} canEdit={canEdit} onSaved={onChanged} />
      </div>
      {modal === 'bill' && <BillModal units={[{ id: unitId, label: unitLabel }]} defaultUnitId={unitId} ownerId={ownerId} canAdjust={!!data?.canChangeAdjustments}
        month={month} onClose={() => setModal(null)} onSaved={changed} />}
    </Card>
  );
}

/** The unit's standard cleaning price: what a finished standard clean charges the unit (functions/_lib/cleaning.ts). */
function CleaningPrice({ unitId, price, deepPrice, legacy, canEdit, onSaved }: {
  unitId: string; price: number | null | undefined; deepPrice: number | null | undefined; legacy: { category: string; amount: number }[]; canEdit: boolean; onSaved: () => void;
}) {
  const toast = useToast();
  const current = price && price > 0 ? price : null;
  const currentDeep = deepPrice && deepPrice > 0 ? deepPrice : null;
  const [draft, setDraft] = useState<number | null | undefined>(undefined);
  const [draftDeep, setDraftDeep] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const shown = draft === undefined ? current : draft;
  const shownDeep = draftDeep === undefined ? currentDeep : draftDeep;
  const dirty = (draft !== undefined && draft !== current) || (draftDeep !== undefined && draftDeep !== currentDeep);
  // The old "Recurring monthly costs" rows other than the two cleaning prices: kept, never deducted from any statement.
  const notDeducted = legacy.filter(e => !['cleaning', 'cleaning_deep'].includes(e.category.toLowerCase()) && e.amount > 0);
  async function save() {
    setBusy(true);
    try {
      const body: Record<string, number | null> = {};
      if (draft !== undefined) body.cleaningPrice = draft ?? null;
      if (draftDeep !== undefined) body.deepCleaningPrice = draftDeep ?? null;
      await api.patch(`/units/${encodeURIComponent(unitId)}`, body);
      toast({ tone: 'success', title: 'Cleaning prices saved.', body: 'A finished clean charges the unit at its own price, owner pays.' });
      setDraft(undefined); setDraftDeep(undefined); onSaved();
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-3 pt-4 [border-top:1px_solid_var(--color-line-soft)]">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-[200px] max-w-full">
          <MoneyInput label="Basic clean (RM)" placeholder="Not set" valueSen={shown ?? null} onChangeSen={v => setDraft(v)} disabled={!canEdit} />
        </div>
        <div className="w-[200px] max-w-full">
          <MoneyInput label="Deep clean (RM)" placeholder="Not set" valueSen={shownDeep ?? null} onChangeSen={v => setDraftDeep(v)} disabled={!canEdit} />
        </div>
        {canEdit && <Button size="sm" variant="secondary" loading={busy} disabled={!dirty} disabledReason="Nothing has changed" onClick={() => void save()}>Save prices</Button>}
      </div>
      <span className="text-meta text-muted-ink">Charged to the unit, owner pays, when a clean of that type is finished.{!current || !currentDeep ? ' A price not set falls back to the last price used on this unit, or the default in Settings.' : ''}</span>
      {notDeducted.length > 0 && (
        <div className="rounded-control bg-muted px-3 py-2.5 text-meta text-muted-ink text-pretty">
          From the old monthly costs list, never deducted from a statement: {notDeducted.map(e => `${e.category} ${rm(e.amount)}`).join(', ')}.
          If the owner should pay one, add it as a bill.
        </div>
      )}
    </div>
  );
}

type View = 'unit' | 'owner';

/** Owner page: "Expenses by unit", every expense across the owner's units by kind, by unit or totalled for the owner. */
export function OwnerCostsCard({ ownerId, ownerName, month, units, canEdit, onChanged }: {
  ownerId: string; ownerName: string; month: string; units: UnitChoice[]; canEdit: boolean; onChanged: () => void;
}) {
  const { data, loading, error, reload } = useApi<Payload>(`/expenses/breakdown?month=${month}&ownerId=${encodeURIComponent(ownerId)}`);
  const pending = useApi<{ data: Approval[] }>(`/approvals?entity=owners&entityId=${encodeURIComponent(ownerId)}`);
  const [view, setView] = useState<View>('unit');
  const [modal, setModal] = useState<null | 'bill' | 'utilities'>(null);
  const changed = () => { reload(); pending.reload(); onChanged(); };
  const many = units.length > 1;
  const items = data?.items ?? [];
  const columns = useMemo(() => costColumns(many, canEdit, changed), [many, canEdit]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = useMemo(() => (data ? costLines(items, data.adjustments) : null), [data, items]);
  const t = data?.total.totals;
  const value = (sen: number | undefined) => (sen === undefined ? undefined : rm(sen));

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[16px] font-semibold tracking-[-0.01em]">Expenses by unit</span>
          <span className="text-meta text-muted-ink">{monthLabel(month, { long: true })} · {plural(units.length, 'unit')}. What the owner pays is deducted before the operator's share.</span>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Segmented<View> label="Show expenses" value={view} onChange={setView} options={[{ key: 'unit', label: 'By unit' }, { key: 'owner', label: 'By owner' }]} />
          {canEdit && units.length > 0 && <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal('bill')}>Add a bill</Button>}
        </div>
      </div>
      {(pending.data?.data.length ?? 0) > 0 && <div className="px-5 pt-4"><ApprovalBanner items={pending.data!.data} onChanged={changed} /></div>}
      {error && !data ? <div className="p-5 text-copy text-critical">{error}</div> : (
        <div className="p-5 flex flex-col gap-5">
          <StatRow cols={5}>
            <StatTile label="Cleaning fees" value={value(t?.cleaning)} loading={loading && !data} />
            <StatTile label="Maintenance repair" value={value(t?.maintenance)} loading={loading && !data} />
            <StatTile label="Utilities" value={value(t?.utilities)} loading={loading && !data} />
            <StatTile label="Maintenance fee (condo)" value={value(t?.maintenanceFee)} loading={loading && !data} hint="After the operator's share" />
            <StatTile label="Deducted before the split" value={value(t?.deducted)} loading={loading && !data}
              hint={t && t.notCharged ? `${rm(t.notCharged)} more paid by others, not deducted` : undefined} />
          </StatRow>
          {!data ? <div className="skeleton h-40" /> : view === 'owner' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">
              <div className="flex flex-col gap-2 min-w-0"><Eyebrow>{titleCase(ownerName)} · all units</Eyebrow><KindBreakdown b={data.total} /></div>
              <div className="flex flex-col gap-2 min-w-0">
                <Eyebrow>Bills and after-split charges</Eyebrow>
                <PaidOnBehalfList items={items.filter(i => isBill(i.group))} adjustments={data.adjustments} ownerId={ownerId} showUnit={many}
                  canChange={canEdit && data.canChangeAdjustments} canAddReceipt={canEdit} onChanged={changed} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-4">
              {data.units.map(u => (
                <section key={u.unitId} className="border border-solid border-line rounded-card p-4 flex flex-col gap-2 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link to={`/properties/units/${encodeURIComponent(u.unitId)}?tab=financials`} className="text-[15px] font-semibold text-ink! no-underline min-w-0 [overflow-wrap:anywhere]">{titleCase(u.unitLabel)}</Link>
                    <MoneyText sen={u.totals.deducted} mode="exact" strong className="text-copy whitespace-nowrap" />
                  </div>
                  <KindBreakdown b={u} deducts={u.deductsFromOwner} />
                  <details className="group">
                    <summary className="cursor-pointer text-meta font-medium text-gold-ink list-none [&::-webkit-details-marker]:hidden">
                      Bills and charges on this unit ({items.filter(i => i.unitId === u.unitId && isBill(i.group)).length + data.adjustments.filter(a => a.unitId === u.unitId).length})
                    </summary>
                    <PaidOnBehalfList items={items.filter(i => i.unitId === u.unitId && isBill(i.group))} adjustments={data.adjustments.filter(a => a.unitId === u.unitId)}
                      ownerId={ownerId} showUnit={false} canChange={canEdit && data.canChangeAdjustments} canAddReceipt={canEdit} onChanged={changed} />
                  </details>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="[border-top:1px_solid_var(--color-line-soft)]">
        <div className="flex items-center justify-between gap-3 flex-wrap px-5 pt-4 pb-2">
          <span className="text-copy font-semibold">Every cost, {monthLabel(month)}</span>
          {canEdit && units.length > 0 && (
            <span className="flex gap-2 flex-wrap">
              <Button size="sm" variant="secondary" icon={<Icon name="Zap" size="sm" />} onClick={() => setModal('utilities')}>Utility bills, all units</Button>
            </span>
          )}
        </div>
        <DataTable<CostLine> id="owner.costs" urlPrefix="cost." bare noViews pageSize={0} maxHeight="480px"
          columns={columns} rows={lines} rowKey={r => r.id} loading={loading} error={error} onRetry={reload}
          noun={['cost', 'costs']} exportName={`${ownerName} costs ${month}`}
          empty={{ title: `No costs recorded for ${monthLabel(month)}.`, icon: 'Receipt' }}
          renderCard={r => <CostCard r={r} unit={many} canAdd={canEdit} onAdded={changed} />}
          footer={lines && lines.length > 0 ? <CostTotals lines={lines} /> : undefined} />
      </div>
      {modal === 'bill' && <BillModal units={units} ownerId={ownerId} canAdjust={!!data?.canChangeAdjustments} month={month} onClose={() => setModal(null)} onSaved={changed} />}
      {modal === 'utilities' && <UtilitiesModal ownerId={ownerId} month={month} onClose={() => setModal(null)} onSaved={changed} />}
    </Card>
  );
}
