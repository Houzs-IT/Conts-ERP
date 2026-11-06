import { useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { CloseButton } from '../../components/CloseButton';
import { Drawer } from '../../components/Dialog';
import { Segmented } from '../../components/Metric';
import { SearchSelect, Select } from '../../components/Select';
import { Skeleton } from '../../components/States';
import { useToast } from '../../components/Toast';
import { DateField, MoneyInput } from '../../components/inputs';
import { api, notifyFailure } from '../../lib/api';
import { date, rm, todayMyt } from '../../lib/format';
import { useApi } from '../../lib/useApi';
import { CLEAN_KINDS, type UnitPriceChange, type UnitPriceData } from './UnitCleaning';
import { PercentSchedule } from './PercentSchedule';

interface Sku { id: string; code: string; name: string; defaultPrice: number | null; internalCost: number | null }
type Figures = { charge: number | null; pay: number | null };
type PriceKind = 'cleaning' | 'maintenance';
const ALL_UNITS = 'all-units';
export interface ScheduleUnit { id: string; label: string; building: string; hint: string }
export type PricedUnit = Pick<ScheduleUnit, 'id' | 'label'>;

const amountOf = (sen: number | null) => (sen == null ? 'list price' : rm(sen));
/** The item's list name is older than the clean names staff use: a clean reads as on the Details tab. */
const nameOf = (c: UnitPriceChange) => CLEAN_KINDS.find(([k]) => k === c.cleanKind)?.[1] ?? c.name;
const Heading = ({ children }: { children: string }) => <h3 className="m-0 text-copy font-semibold">{children}</h3>;

function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Drawer open onClose={onClose} width={560} labelledBy="schedule-a-change">
      <div className="flex items-start justify-between gap-3 p-5 [border-bottom:1px_solid_var(--color-line)] sticky top-0 bg-card z-[1]">
        <h2 id="schedule-a-change" className="m-0 text-title font-semibold [overflow-wrap:anywhere]">{title}</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="p-5 flex flex-col gap-6">{children}</div>
    </Drawer>
  );
}

/** The side panel of Scheduled changes (owner, 6 Nov 2026): only a dated % change, for all units or one. A unit's own
 *  prices in RM are scheduled on the unit page, a contract on the unit's Contract tab. */
export function PercentChangePanel({ units, onClose, onSaved }: { units: ScheduleUnit[]; onClose: () => void; onSaved: () => void }) {
  const [unitId, setUnitId] = useState(ALL_UNITS);
  const unit = units.find(u => u.id === unitId) ?? null;
  const unitOptions = [{ value: ALL_UNITS, label: 'All units' }, ...units.map(u => ({ value: u.id, label: u.label, group: u.building, hint: u.hint }))];
  return (
    <SidePanel title="Schedule a % change" onClose={onClose}>
      <SearchSelect label="Units" showLabel size="md" placeholder="Search unit" value={unitId} onChange={setUnitId} options={unitOptions} />
      {(unit || unitId === ALL_UNITS) && <PercentSchedule key={unitId} unit={unit} onSaved={onSaved} />}
    </SidePanel>
  );
}

/** One unit's own cleaning or maintenance price in RM from a later date, opened from the unit page. Nothing is moved on
 *  the day: a job reads the price in force on its own day, so the change takes over by itself. */
export function UnitPriceChangePanel({ unit, onClose, onSaved }: { unit: PricedUnit; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<PriceKind>('cleaning');
  return (
    <SidePanel title={`Schedule a price change: ${unit.label}`} onClose={onClose}>
      <Segmented<PriceKind> label="Price to change" value={kind} onChange={setKind}
        options={[{ key: 'cleaning', label: 'Cleaning' }, { key: 'maintenance', label: 'Maintenance' }]} />
      <PriceSchedule key={kind} kind={kind} unit={unit} onSaved={onSaved} />
    </SidePanel>
  );
}

function PriceSchedule({ kind, unit, onSaved }: { kind: PriceKind; unit: PricedUnit; onSaved: () => void }) {
  const toast = useToast();
  const prices = useApi<UnitPriceData>(`/housekeeping/unit-prices?unitId=${encodeURIComponent(unit.id)}`);
  const skus = useApi<{ data: Sku[] }>(kind === 'maintenance' ? '/maintenance/skus?active=1' : null);
  const [from, setFrom] = useState('');
  const [clean, setClean] = useState<Record<string, Figures>>({});
  const [itemId, setItemId] = useState('');
  const [item, setItem] = useState<Figures>({ charge: null, pay: null });
  const [busy, setBusy] = useState(false);

  const data = prices.data, mayEdit = !!data?.mayEdit && !!data.dated;
  const listed = data?.rows[0]?.prices;
  const items = skus.data?.data ?? [];
  const sku = items.find(s => s.id === itemId);
  const edits = kind === 'cleaning'
    ? CLEAN_KINDS.filter(([k]) => clean[k]).map(([k]) => ({ kind: k as string, internalCost: clean[k].pay, externalCharge: clean[k].charge }))
    : itemId ? [{ itemId, internalCost: item.pay, externalCharge: item.charge }] : [];
  const inForce = (data?.changes ?? []).filter(c => !c.scheduled && c.domain === kind);

  async function schedule() {
    setBusy(true);
    try {
      for (const e of edits) await api.put('/housekeeping/unit-prices', { unitId: unit.id, effectiveFrom: from, ...e });
      toast({ tone: 'success', title: 'Change scheduled.', body: `${unit.label} uses the new ${edits.length === 1 ? 'price' : 'prices'} for jobs from ${date(from)}. Earlier jobs keep theirs.` });
      onSaved();
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }

  return (
    <>
      {prices.error && <p role="alert" className="m-0 text-copy text-critical">{prices.error}</p>}
      {!data && !prices.error && <Skeleton height={220} />}
      {data && !data.dated && <p className="m-0 text-copy text-muted-ink">Dated prices are not switched on yet. They need a database update (migration 0186).</p>}
      {data?.dated && !data.mayEdit && <p className="m-0 text-copy text-muted-ink">Only management schedules price changes.</p>}

      {mayEdit && (
        <section className="flex flex-col gap-3">
          <Heading>New prices from a date</Heading>
          <DateField label="Applies from" value={from} min={todayMyt(1)} onChange={setFrom} />
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2.5">
            {kind === 'cleaning' && CLEAN_KINDS.map(([k, label]) => {
              const now = listed?.[k];
              const set = (p: Partial<Figures>) => setClean(c => ({ ...c, [k]: { charge: c[k]?.charge ?? null, pay: c[k]?.pay ?? null, ...p } }));
              return (
                <div key={k} className="contents">
                  <span className="col-span-2 text-copy font-medium">{label}</span>
                  <MoneyInput label="Owner is charged" placeholder={now?.externalCharge != null ? `Now ${rm(now.externalCharge)}` : 'Not set'} valueSen={clean[k]?.charge ?? null} onChangeSen={v => set({ charge: v })} />
                  <MoneyInput label="Cleaner is paid" placeholder={now?.internalCost != null ? `Now ${rm(now.internalCost)}` : 'Not set'} valueSen={clean[k]?.pay ?? null} onChangeSen={v => set({ pay: v })} />
                </div>
              );
            })}
            {kind === 'maintenance' && <>
              <div className="col-span-2">
                <Select label="Maintenance item" showLabel size="md" value={itemId} placeholder="Choose an item" onChange={setItemId}
                  options={items.map(s => ({ value: s.id, label: `${s.code} ${s.name}` }))} />
                {skus.data && items.length === 0 && <p className="m-0 mt-1.5 text-meta text-muted-ink">No maintenance items on the list yet. Add them under Service prices.</p>}
              </div>
              {itemId && <>
                <MoneyInput label="Owner is charged" placeholder={sku?.defaultPrice != null ? `List ${rm(sku.defaultPrice)}` : 'Not set'} valueSen={item.charge} onChangeSen={v => setItem(i => ({ ...i, charge: v }))} />
                <MoneyInput label="It costs us" placeholder={sku?.internalCost != null ? `List ${rm(sku.internalCost)}` : 'Not set'} valueSen={item.pay} onChangeSen={v => setItem(i => ({ ...i, pay: v }))} />
              </>}
            </>}
          </div>
          <span className="text-meta text-muted-ink">Fill only what changes. A box left empty on a line you changed uses the list price from that date.</span>
          <div>
            <Button size="sm" variant="primary" loading={busy} disabled={!from || edits.length === 0}
              disabledReason={!from ? 'Pick the date first.' : 'Enter a new price first.'} onClick={() => void schedule()}>Schedule change</Button>
          </div>
        </section>
      )}

      {inForce.length > 0 && (
        <section className="flex flex-col gap-1">
          <Heading>This unit's own prices now</Heading>
          <ul className="m-0 mt-1 p-0 list-none">
            {inForce.map(c => (
              <li key={`${c.itemId}:${c.effectiveFrom}`} className="flex flex-col gap-0.5 py-2.5 [border-top:1px_solid_var(--color-line-soft)]">
                <span className="text-copy font-medium [overflow-wrap:anywhere]">{nameOf(c)}</span>
                <span className="text-meta text-muted-ink">{c.effectiveFrom <= '2000-01-01' ? 'From the start' : `From ${date(c.effectiveFrom)}`} · Owner {amountOf(c.ownerPrice)} · Cost {amountOf(c.internalCost)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
