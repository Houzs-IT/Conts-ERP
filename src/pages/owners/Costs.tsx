import { useMemo, useRef, useState } from 'react';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { MoneyInput, DateField } from '../../components/inputs';
import { MoneyText } from '../../components/MoneyText';
import { StatusBadge } from '../../components/StatusBadge';
import Icon from '../../components/Icon';
import { DataTable, type Column } from '../../components/DataTable';
import { StatTile, StatRow, Segmented, Eyebrow } from '../../components/Metric';
import ApprovalBanner from '../../components/ApprovalBanner';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, downloadFile, notifyFailure, errorMessage } from '../../lib/api';
import { isStaged, stagedToast, type Approval } from '../../lib/approvals';
import { refreshNavCounts } from '../../lib/navBadges';
import { rm, monthLabel, date as fmtDate, todayMyt, titleCase, plural } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import { PAYER_LABEL } from '../../lib/revenueModel';
import { ExpenseEntryModal, UtilitiesModal, type UnitChoice } from './ExpenseEntry';
import { AdjustmentActions, ADJUSTMENT_KIND, ADJUSTMENT_STATE } from './Adjustments';

/** A month's costs the way the owner reads them (GET /api/expenses/breakdown, functions/_lib/unitCosts.ts):
 *  Cleaning, Maintenance, and Paid on behalf (water, electricity, Wi-Fi, IndahWater, other fees), each totalled from the
 *  expenses recorded to the unit. What the owner pays is deducted before the operator's share; what The Conts, a tenant
 *  or a guest paid is shown apart and never deducted. The owner's credits and charges on file (the workbook's O2 lines,
 *  and the Maintenance fee (condo) added here) are listed with the paid-on-behalf bills and come off after the split. */

type Group = 'cleaning' | 'maintenance' | 'paid_on_behalf';
interface Kind { key: string; label: string; group: Group; amount: number; others: number; afterSplit: number }
interface Totals { cleaning: number; maintenance: number; paidOnBehalf: number; deducted: number; notCharged: number; credits: number; charges: number }
interface Breakdown { totals: Totals; kinds: Kind[] }
interface UnitCosts extends Breakdown { unitId: string; unitLabel: string; revenueModel: string; deductsFromOwner: boolean }
export interface CostItem {
  id: string; unitId: string; unitLabel: string; kind: string; kindLabel: string; group: Group; category: string; description: string;
  amount: number; chargeTo: string; incurredOn: string; reference: string | null; receiptDocumentId: string | null; locked: boolean;
}
export interface AdjustmentItem {
  id: string; unitId: string; unitLabel: string; placedOnFirstUnit: boolean; kind: string; amount: number; description: string;
  occurredOn: string; reference: string | null; state: string; source: string; inMonth: boolean;
  statement: { id: string; period: string; state: string } | null;
}
interface Payload { month: string; canChangeAdjustments: boolean; units: UnitCosts[]; total: Breakdown; items: CostItem[]; adjustments: AdjustmentItem[] }

/** The kinds of bill The Conts pays for the owner. Value = expenses.category, except building_fee: the condo's
 *  maintenance fee, an owner charge after the split (not an expense). */
export const BILL_KINDS = [
  { value: 'water', label: 'Water' }, { value: 'electricity', label: 'Electricity' }, { value: 'internet', label: 'Wi-Fi' },
  { value: 'sewerage', label: 'IndahWater' }, { value: 'building_fee', label: 'Maintenance fee (condo)' }, { value: 'other', label: 'Other fees' },
];

/** The owner workbook's month words on its O2 lines ("MAINTENANCE FEE SEPT 26"). */
const FEE_MONTH = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEPT', 'OCT', 'NOV', 'DEC'];
/** 2026-09-30 -> "MAINTENANCE FEE SEPT 26"; typed text is kept, in capitals, led by MAINTENANCE FEE. */
export const maintenanceFeeText = (typed: string, isoDate: string) => {
  const t = typed.trim().toUpperCase();
  if (t) return /^MAINTENANCE FEE\b/.test(t) ? t : `MAINTENANCE FEE ${t}`;
  return `MAINTENANCE FEE ${FEE_MONTH[Number(isoDate.slice(5, 7)) - 1]} ${isoDate.slice(2, 4)}`;
};

const lastDayOf = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

/** "Add a bill paid on behalf": a bill The Conts paid for the owner, recorded to the unit with the owner paying, so the
 *  statement deducts it before the operator's share. The condo's maintenance fee is the exception: it comes off after
 *  the operator's share (the owner's report lists it below "Payout Before O2 Adjustment"), so it is recorded as an
 *  owner charge on the unit (POST /api/owners/:id/adjustments, the same rules, approval and audit as any owner charge),
 *  offered only to those who may add owner charges. */
export function BillModal({ units, defaultUnitId, ownerId, canAdjust, month, onClose, onSaved }: {
  units: UnitChoice[]; defaultUnitId?: string; ownerId: string; canAdjust: boolean; month: string; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const today = todayMyt();
  const [unitId, setUnitId] = useState(defaultUnitId ?? units[0]?.id ?? '');
  const [category, setCategory] = useState('water');
  const [amount, setAmount] = useState<number | null>(null);
  const [incurredOn, setIncurredOn] = useState(today.startsWith(month) ? today : lastDayOf(month));
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const ok = !!unitId && amount != null && amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(incurredOn);
  const kinds = canAdjust ? BILL_KINDS : BILL_KINDS.filter(k => k.value !== 'building_fee');
  const kind = BILL_KINDS.find(k => k.value === category)?.label ?? category;
  const fee = category === 'building_fee';

  async function save() {
    if (!ok || busy) return;
    setBusy(true); setFields({});
    try {
      if (fee) {
        const res = await api.post<unknown>(`/owners/${encodeURIComponent(ownerId)}/adjustments`, {
          kind: 'charge', amount, occurredOn: incurredOn, unitId, reference: reference.trim() || null, description: maintenanceFeeText(description, incurredOn),
        });
        if (isStaged(res)) { toast(stagedToast(res)); void refreshNavCounts(); onSaved(); onClose(); return; }
        toast({ tone: 'success', title: 'Maintenance fee recorded.', body: 'The owner statement deducts it after the operator\'s share.' });
        onSaved(); onClose(); return;
      }
      let receiptDocumentId: string | null = null;
      if (receipt) {
        const fd = new FormData();
        fd.append('file', receipt); fd.append('unitId', unitId); fd.append('kind', 'receipt');
        receiptDocumentId = (await api.post<{ id: string }>('/documents', fd)).id;
      }
      const text = description.trim() || `${kind} ${monthLabel(incurredOn.slice(0, 7))}`;
      const res = await api.post<unknown>('/expenses', {
        unitId, category, amount, incurredOn, chargeTo: 'owner', reference: reference.trim() || null, description: text, receiptDocumentId,
      });
      if (isStaged(res)) { toast(stagedToast(res)); void refreshNavCounts(); onSaved(); onClose(); return; }
      toast({ tone: 'success', title: 'Bill recorded.', body: `${kind}, paid on behalf. The owner statement deducts it before the operator's share.` });
      onSaved(); onClose();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFields(e.fields);
      toast({ tone: 'critical', title: 'Bill was not recorded.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Add a bill paid on behalf" className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)]">
      <div onClick={onClose} className="absolute inset-0" />
      <div className="relative w-full max-w-[500px] max-h-[calc(100vh-32px)] flex flex-col bg-card rounded-card shadow-[var(--shadow-overlay)]">
        <div className="pt-[22px] px-[22px] pb-1 flex-none">
          <h2 className="m-0 text-title font-semibold">Add a bill paid on behalf</h2>
          <p className="mt-[5px] mb-0 text-copy text-muted-ink">{fee
            ? 'The condo\'s maintenance fee, paid for the owner. The owner statement deducts it after the operator\'s share.'
            : 'A bill The Conts paid for the owner. The owner statement deducts it before the operator\'s share.'}</p>
        </div>
        <div className="py-4 px-[22px] flex flex-col gap-[14px] overflow-y-auto min-h-0">
          {units.length > 1 && <Select showLabel size="md" label="Unit" value={unitId} onChange={setUnitId} options={units.map(u => ({ value: u.id, label: titleCase(u.label) }))} />}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select showLabel size="md" label="Bill" value={category} onChange={setCategory} options={kinds} />
            <MoneyInput label="Amount (RM)" placeholder="e.g. 120.50" minSen={1} valueSen={amount} onChangeSen={setAmount} error={fields.amount} />
            <DateField label="Date" value={incurredOn} onChange={setIncurredOn} error={fields.incurredOn} />
            <Field label="Reference (optional)" placeholder="Bill or account number" maxLength={80} value={reference} onChange={e => setReference(e.target.value)} />
          </div>
          <Field label="Description (optional)" placeholder={fee ? `e.g. ${maintenanceFeeText('', incurredOn)}` : `e.g. ${kind} ${monthLabel(month)}`} maxLength={fee ? 200 : 300}
            value={description} onChange={e => setDescription(e.target.value)} error={fields.description} />
          {!fee && <div className="flex flex-col gap-1.5">
            <span className="text-meta font-medium text-muted-ink">Receipt (optional)</span>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="secondary" icon={<Icon name="Upload" size="sm" />} onClick={() => fileRef.current?.click()}>{receipt ? 'Change file' : 'Attach photo or PDF'}</Button>
              {receipt && <span className="text-meta text-ink [overflow-wrap:anywhere]">{receipt.name}</span>}
              {fields.receipt && <span className="text-meta text-critical">{fields.receipt}</span>}
            </div>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { setReceipt(e.currentTarget.files?.item(0) ?? null); e.currentTarget.value = ''; }} />
          </div>}
        </div>
        <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex justify-end flex-wrap gap-[9px] flex-none">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!ok} disabledReason="Pick the bill and enter the amount and date" onClick={() => void save()}>Add bill</Button>
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

/** Cleaning, Maintenance, then each paid-on-behalf kind, and the total the owner pays. */
function KindBreakdown({ b, deducts = true }: { b: Breakdown; deducts?: boolean }) {
  const by = (g: Group) => b.kinds.filter(k => k.group === g);
  const others = (k: Kind) => (k.others ? `Also ${rm(k.others)} paid by others, not deducted` : undefined);
  return (
    <div className="flex flex-col">
      {by('cleaning').map(k => <Line key={k.key} label="Cleaning" sen={k.amount} sub={others(k)} />)}
      {by('maintenance').map(k => <Line key={k.key} label="Maintenance" sen={k.amount} sub={others(k)} />)}
      <span className="pt-2 pb-0.5"><Eyebrow>Paid on behalf</Eyebrow></span>
      {by('paid_on_behalf').map(k => <Line key={k.key} label={k.label} sen={k.amount} sub={k.key === 'building_fee' ? feeNote(k) : others(k)} indent />)}
      <Line label={deducts ? 'Deducted before the split' : 'Owner-paid costs (the company bears them on this contract)'} sen={b.totals.deducted} strong />
      {(b.totals.charges > 0 || b.totals.credits > 0) && (
        <span className="text-meta text-muted-ink pt-1">
          After the split: {b.totals.charges > 0 && <>paid on behalf <MoneyText sen={b.totals.charges} mode="exact" className="text-ink" /></>}
          {b.totals.charges > 0 && b.totals.credits > 0 && ', '}
          {b.totals.credits > 0 && <>credit to owner <MoneyText sen={b.totals.credits} mode="exact" className="text-ink" /></>}
        </span>
      )}
    </div>
  );
}

/** The paid-on-behalf bills and the owner's credits and charges, one list. */
function PaidOnBehalfList({ items, adjustments, ownerId, showUnit, canChange, onChanged }: {
  items: CostItem[]; adjustments: AdjustmentItem[]; ownerId: string; showUnit: boolean; canChange: boolean; onChanged: () => void;
}) {
  if (!items.length && !adjustments.length) return <div className="py-3 text-copy text-muted-ink">No bills paid on behalf this month.</div>;
  return (
    <div className="flex flex-col">
      {items.map(it => (
        <div key={it.id} className="flex items-start justify-between gap-3 py-[9px] [border-top:1px_solid_var(--color-line-soft)] first:border-t-0">
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className="text-copy text-ink [overflow-wrap:anywhere]">{it.description || it.kindLabel}</span>
            <span className="text-meta text-muted-ink">
              {[it.kindLabel, fmtDate(it.incurredOn), showUnit ? titleCase(it.unitLabel) : null, it.reference].filter(Boolean).join(' · ')}
              {it.receiptDocumentId && <> · <button type="button" onClick={() => downloadFile(`/documents/${it.receiptDocumentId}/download`).catch(notifyFailure)} className="p-0 bg-transparent border-none cursor-pointer text-meta text-gold-ink underline [font-family:inherit]">Receipt</button></>}
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
            {a.statement && <a href={`#/finance/statements/${encodeURIComponent(a.statement.id)}`} className="text-meta text-ink underline underline-offset-2 self-start">On the {monthLabel(a.statement.period)} owner statement</a>}
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

/** Unit Financials: "Costs this month", the add-a-bill form, and the unit's standard cleaning price. */
export function UnitCostsCard({ unitId, ownerId, unitLabel, canEdit, cleaningPrice, legacyCosts, onChanged }: {
  unitId: string; ownerId: string; unitLabel: string; canEdit: boolean; cleaningPrice: number | null | undefined;
  legacyCosts: { category: string; amount: number }[]; onChanged: () => void;
}) {
  const month = todayMyt().slice(0, 7);
  const { data, loading, error, reload } = useApi<Payload>(`/expenses/breakdown?month=${month}&unitId=${encodeURIComponent(unitId)}`);
  const [modal, setModal] = useState<null | 'bill'>(null);
  const u = data?.units[0];
  const t = u?.totals;
  const value = (sen: number | undefined) => (sen === undefined ? undefined : rm(sen));
  const changed = () => { reload(); onChanged(); };
  const pob = (data?.items ?? []).filter(i => i.group === 'paid_on_behalf');
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[16px] font-semibold tracking-[-0.01em]">Costs this month</span>
          <span className="text-meta text-muted-ink">{monthLabel(month, { long: true })} so far, totalled from what is recorded to {unitLabel}. The owner's share is deducted before the operator's.</span>
        </div>
        {canEdit && <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal('bill')}>Add a bill paid on behalf</Button>}
      </div>
      {error && !data ? <div className="p-5 text-copy text-critical">{error}</div> : (
        <div className="p-5 flex flex-col gap-5">
          <StatRow cols={4}>
            <StatTile label="Cleaning" value={value(t?.cleaning)} loading={loading && !data} />
            <StatTile label="Maintenance" value={value(t?.maintenance)} loading={loading && !data} />
            <StatTile label="Paid on behalf" value={value(t?.paidOnBehalf)} loading={loading && !data} />
            <StatTile label={u && !u.deductsFromOwner ? 'Owner-paid costs' : 'Deducted before the split'} value={value(t?.deducted)} loading={loading && !data}
              hint={t && t.notCharged ? `${rm(t.notCharged)} more paid by The Conts or a guest, not deducted` : undefined} />
          </StatRow>
          {u && !u.deductsFromOwner && <p className="m-0 text-meta text-muted-ink">On this unit's contract the owner gets a fixed rent, so these costs do not change what the owner is paid.</p>}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">
            <div className="flex flex-col gap-2 min-w-0">
              <Eyebrow>By kind</Eyebrow>
              {u ? <KindBreakdown b={u} deducts={u.deductsFromOwner} /> : <div className="skeleton h-40" />}
            </div>
            <div className="flex flex-col gap-2 min-w-0">
              <Eyebrow>Paid on behalf</Eyebrow>
              {data ? <PaidOnBehalfList items={pob} adjustments={data.adjustments} ownerId={ownerId} showUnit={false} canChange={canEdit && data.canChangeAdjustments} onChanged={changed} />
                : <div className="skeleton h-24" />}
            </div>
          </div>
          <CleaningPrice unitId={unitId} price={cleaningPrice} legacy={legacyCosts} canEdit={canEdit} onSaved={onChanged} />
        </div>
      )}
      {modal === 'bill' && <BillModal units={[{ id: unitId, label: unitLabel }]} defaultUnitId={unitId} ownerId={ownerId} canAdjust={!!data?.canChangeAdjustments}
        month={month} onClose={() => setModal(null)} onSaved={changed} />}
    </Card>
  );
}

/** The unit's standard cleaning price: what a finished standard clean charges the unit (functions/_lib/cleaning.ts). */
function CleaningPrice({ unitId, price, legacy, canEdit, onSaved }: { unitId: string; price: number | null | undefined; legacy: { category: string; amount: number }[]; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const current = price && price > 0 ? price : null;
  const [draft, setDraft] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const shown = draft === undefined ? current : draft;
  const dirty = draft !== undefined && draft !== current;
  // The old "Recurring monthly costs" rows other than cleaning: kept, never deducted from any statement.
  const notDeducted = legacy.filter(e => e.category.toLowerCase() !== 'cleaning' && e.amount > 0);
  async function save() {
    setBusy(true);
    try {
      await api.patch(`/units/${encodeURIComponent(unitId)}`, { cleaningPrice: draft ?? null });
      toast({ tone: 'success', title: 'Cleaning price saved.', body: draft ? `A finished standard clean now charges ${rm(draft)}.` : 'Cleared: cleans charge the last price used or the default.' });
      setDraft(undefined); onSaved();
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-3 pt-4 [border-top:1px_solid_var(--color-line-soft)]">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-[220px] max-w-full">
          <MoneyInput label="Standard cleaning price (RM)" placeholder="Not set" valueSen={shown ?? null} onChangeSen={v => setDraft(v)} disabled={!canEdit}
            help="Charged to the unit, owner pays, when a standard clean is finished." />
        </div>
        {canEdit && <Button size="sm" variant="secondary" loading={busy} disabled={!dirty} disabledReason="Nothing has changed" onClick={() => void save()}>Save price</Button>}
      </div>
      {!current && <span className="text-meta text-muted-ink">Not set: a clean charges the last price used on this unit, or the default in Settings.</span>}
      {notDeducted.length > 0 && (
        <div className="rounded-control bg-muted px-3 py-2.5 text-meta text-muted-ink text-pretty">
          From the old monthly costs list, never deducted from a statement: {notDeducted.map(e => `${e.category} ${rm(e.amount)}`).join(', ')}.
          If the owner should pay one, add it as a bill paid on behalf.
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
  const [modal, setModal] = useState<null | 'bill' | 'expense' | 'utilities'>(null);
  const changed = () => { reload(); pending.reload(); onChanged(); };
  const many = units.length > 1;
  const items = data?.items ?? [];
  const columns = useMemo<Column<CostItem>[]>(() => [
    ...(many ? [{ key: 'unit', label: 'Unit', value: (r: CostItem) => r.unitLabel, width: 170, filter: { kind: 'select' as const } }] : []),
    { key: 'description', label: 'Expense', value: r => r.description || r.kindLabel, hideable: false, width: 220, sub: r => r.kindLabel },
    { key: 'kind', label: 'Kind', value: r => r.kindLabel, hidden: true, width: 140, filter: { kind: 'select' } },
    { key: 'date', label: 'Date', type: 'date', value: r => r.incurredOn, width: 110 },
    { key: 'payer', label: 'Paid by', value: r => PAYER_LABEL[r.chargeTo] ?? r.chargeTo, width: 120, filter: { kind: 'select' },
      render: r => <span className={cx('text-meta', r.chargeTo === 'owner' ? 'text-ink font-medium' : 'text-muted-ink')}>{r.chargeTo === 'owner' ? 'Owner, deducted' : `${PAYER_LABEL[r.chargeTo] ?? r.chargeTo}, not deducted`}</span> },
    { key: 'reference', label: 'Reference', value: r => r.reference, hidden: true, width: 130 },
    { key: 'amount', label: 'Amount', type: 'money', value: r => r.amount, width: 110, render: r => <MoneyText sen={r.amount} mode="exact" className="text-copy font-medium" /> },
    { key: 'receipt', label: 'Receipt', width: 80, noExport: true, sortable: false, filter: false,
      render: r => r.receiptDocumentId
        ? <button type="button" onClick={() => downloadFile(`/documents/${r.receiptDocumentId}/download`).catch(notifyFailure)} className="p-0 bg-transparent border-none cursor-pointer text-meta text-gold-ink underline [font-family:inherit]">Receipt</button>
        : <span className="text-muted-ink">—</span> },
  ], [many]);
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
          {canEdit && units.length > 0 && <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal('bill')}>Add a bill paid on behalf</Button>}
        </div>
      </div>
      {(pending.data?.data.length ?? 0) > 0 && <div className="px-5 pt-4"><ApprovalBanner items={pending.data!.data} onChanged={changed} /></div>}
      {error && !data ? <div className="p-5 text-copy text-critical">{error}</div> : (
        <div className="p-5 flex flex-col gap-5">
          <StatRow cols={4}>
            <StatTile label="Cleaning" value={value(t?.cleaning)} loading={loading && !data} />
            <StatTile label="Maintenance" value={value(t?.maintenance)} loading={loading && !data} />
            <StatTile label="Paid on behalf" value={value(t?.paidOnBehalf)} loading={loading && !data} />
            <StatTile label="Deducted before the split" value={value(t?.deducted)} loading={loading && !data}
              hint={t && t.notCharged ? `${rm(t.notCharged)} more paid by others, not deducted` : undefined} />
          </StatRow>
          {!data ? <div className="skeleton h-40" /> : view === 'owner' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">
              <div className="flex flex-col gap-2 min-w-0"><Eyebrow>{titleCase(ownerName)} · all units</Eyebrow><KindBreakdown b={data.total} /></div>
              <div className="flex flex-col gap-2 min-w-0">
                <Eyebrow>Paid on behalf</Eyebrow>
                <PaidOnBehalfList items={items.filter(i => i.group === 'paid_on_behalf')} adjustments={data.adjustments} ownerId={ownerId} showUnit={many}
                  canChange={canEdit && data.canChangeAdjustments} onChanged={changed} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-4">
              {data.units.map(u => (
                <section key={u.unitId} className="border border-solid border-line rounded-card p-4 flex flex-col gap-2 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <a href={`#/properties/units/${encodeURIComponent(u.unitId)}?tab=financials`} className="text-[15px] font-semibold text-ink! no-underline min-w-0 [overflow-wrap:anywhere]">{titleCase(u.unitLabel)}</a>
                    <MoneyText sen={u.totals.deducted} mode="exact" strong className="text-copy whitespace-nowrap" />
                  </div>
                  <KindBreakdown b={u} deducts={u.deductsFromOwner} />
                  <details className="group">
                    <summary className="cursor-pointer text-meta font-medium text-gold-ink list-none [&::-webkit-details-marker]:hidden">
                      Paid on behalf on this unit ({items.filter(i => i.unitId === u.unitId && i.group === 'paid_on_behalf').length + data.adjustments.filter(a => a.unitId === u.unitId).length})
                    </summary>
                    <PaidOnBehalfList items={items.filter(i => i.unitId === u.unitId && i.group === 'paid_on_behalf')} adjustments={data.adjustments.filter(a => a.unitId === u.unitId)}
                      ownerId={ownerId} showUnit={false} canChange={canEdit && data.canChangeAdjustments} onChanged={changed} />
                  </details>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="[border-top:1px_solid_var(--color-line-soft)]">
        <div className="flex items-center justify-between gap-3 flex-wrap px-5 pt-4 pb-2">
          <span className="text-copy font-semibold">Every expense, {monthLabel(month)}</span>
          {canEdit && units.length > 0 && (
            <span className="flex gap-2 flex-wrap">
              <Button size="sm" variant="secondary" icon={<Icon name="Zap" size="sm" />} onClick={() => setModal('utilities')}>Utility bills</Button>
              <Button size="sm" variant="secondary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal('expense')}>Record expense</Button>
            </span>
          )}
        </div>
        <DataTable<CostItem> id="owner.costs" urlPrefix="cost." bare noViews pageSize={0} maxHeight="480px"
          columns={columns} rows={data ? items : null} rowKey={r => r.id} loading={loading} error={error} onRetry={reload}
          noun={['expense', 'expenses']} exportName={`${ownerName} expenses ${month}`}
          empty={{ title: `No expenses recorded for ${monthLabel(month)}.`, icon: 'Receipt' }}
          renderCard={r => (
            <span className="flex items-start justify-between gap-3 min-w-0">
              <span className="flex flex-col min-w-0">
                {many && <span className="text-meta text-muted-ink truncate">{titleCase(r.unitLabel)}</span>}
                <span className="text-copy truncate" title={r.description}>{r.description || r.kindLabel}</span>
                <span className="text-meta text-muted-ink">{r.kindLabel} · {fmtDate(r.incurredOn)}</span>
              </span>
              <span className="flex flex-col items-end shrink-0">
                <MoneyText sen={r.amount} mode="exact" className="text-copy font-medium" />
                <span className="text-caption text-muted-ink">{r.chargeTo === 'owner' ? 'Deducted' : `${PAYER_LABEL[r.chargeTo] ?? r.chargeTo} pays`}</span>
              </span>
            </span>
          )} />
      </div>
      {modal === 'bill' && <BillModal units={units} ownerId={ownerId} canAdjust={!!data?.canChangeAdjustments} month={month} onClose={() => setModal(null)} onSaved={changed} />}
      {modal === 'expense' && <ExpenseEntryModal units={units} month={month} onClose={() => setModal(null)} onSaved={changed} />}
      {modal === 'utilities' && <UtilitiesModal ownerId={ownerId} month={month} onClose={() => setModal(null)} onSaved={changed} />}
    </Card>
  );
}
