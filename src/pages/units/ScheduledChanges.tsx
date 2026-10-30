import { useState } from 'react';
import { Button } from '../../components/Button';
import { CloseButton } from '../../components/CloseButton';
import { Drawer } from '../../components/Dialog';
import { Select } from '../../components/Select';
import { Skeleton } from '../../components/States';
import { useToast } from '../../components/Toast';
import { DateField, MoneyInput } from '../../components/inputs';
import { api, notifyFailure } from '../../lib/api';
import { date, rm, todayMyt } from '../../lib/format';
import { useApi } from '../../lib/useApi';
import { CLEAN_KINDS, type UnitPriceChange, type UnitPriceData } from './UnitCleaning';

interface Sku { id: string; code: string; name: string; defaultPrice: number | null; internalCost: number | null }
interface ContractTerms { id: string | null; termsLabel: string; startsOn: string | null }
interface ContractPayload { current: ContractTerms; untilThen?: ContractTerms | null }
type Figures = { charge: number | null; pay: number | null };

const amountOf = (sen: number | null) => (sen == null ? 'list price' : rm(sen));
const Heading = ({ children }: { children: string }) => <h3 className="m-0 text-copy font-semibold">{children}</h3>;

/** A unit's changes that wait for a date (owner, 30 Oct 2026): its own basic clean, deep clean and maintenance prices,
 *  and its contract. Nothing is moved on the day: a job reads the price in force on its own day, and the statement the
 *  contract in force that month, so a change takes over by itself and earlier work keeps its figures. */
export function ScheduledChanges({ unitId, unitLabel, money, onClose, onOpenContract }: {
  unitId: string; unitLabel: string; money: boolean; onClose: () => void; onOpenContract: () => void;
}) {
  const toast = useToast();
  const id = encodeURIComponent(unitId);
  const prices = useApi<UnitPriceData>(`/housekeeping/unit-prices?unitId=${id}`);
  const skus = useApi<{ data: Sku[] }>('/maintenance/skus?active=1');
  const contract = useApi<ContractPayload>(money ? `/units/${id}/contract` : null);
  const [from, setFrom] = useState('');
  const [clean, setClean] = useState<Record<string, Figures>>({});
  const [itemId, setItemId] = useState('');
  const [item, setItem] = useState<Figures>({ charge: null, pay: null });
  const [busy, setBusy] = useState(false);

  const data = prices.data, mayEdit = !!data?.mayEdit && !!data.dated;
  const listed = data?.rows[0]?.prices;
  const sku = skus.data?.data.find(s => s.id === itemId);
  const edits = [
    ...CLEAN_KINDS.filter(([k]) => clean[k]).map(([k]) => ({ kind: k as string, internalCost: clean[k].pay, externalCharge: clean[k].charge })),
    ...(itemId ? [{ itemId, internalCost: item.pay, externalCharge: item.charge }] : []),
  ];
  const scheduled = (data?.changes ?? []).filter(c => c.scheduled).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const inForce = (data?.changes ?? []).filter(c => !c.scheduled);
  const held = contract.data?.current.startsOn && contract.data.current.startsOn.slice(0, 10) > todayMyt() ? contract.data.current : null;

  async function schedule() {
    setBusy(true);
    try {
      for (const e of edits) await api.put('/housekeeping/unit-prices', { unitId, effectiveFrom: from, ...e });
      toast({ tone: 'success', title: 'Change scheduled.', body: `${unitLabel} uses the new ${edits.length === 1 ? 'price' : 'prices'} for jobs from ${date(from)}. Earlier jobs keep theirs.` });
      setClean({}); setItemId(''); setItem({ charge: null, pay: null });
      prices.reload();
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }
  async function cancel(c: UnitPriceChange) {
    try {
      await api.del(`/housekeeping/unit-prices?unitId=${id}&itemId=${encodeURIComponent(c.itemId)}&effectiveFrom=${c.effectiveFrom}`);
      toast({ tone: 'success', title: 'Scheduled change cancelled.', body: `${c.name} from ${date(c.effectiveFrom)}.` });
      prices.reload();
    } catch (e) { notifyFailure(e); }
  }

  const row = (c: UnitPriceChange) => (
    <li key={`${c.itemId}:${c.effectiveFrom}`} className="flex items-start justify-between gap-3 py-2.5 [border-top:1px_solid_var(--color-line-soft)]">
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="text-copy font-medium [overflow-wrap:anywhere]">{c.name}</span>
        <span className="text-meta text-muted-ink">{c.effectiveFrom <= '2000-01-01' ? 'From the start' : `From ${date(c.effectiveFrom)}`} · Owner {amountOf(c.ownerPrice)} · Cost {amountOf(c.internalCost)}</span>
      </span>
      {c.scheduled && mayEdit && <Button size="sm" variant="tertiary" onClick={() => void cancel(c)}>Cancel</Button>}
    </li>
  );

  return (
    <Drawer open onClose={onClose} width={520} labelledBy="scheduled-changes">
      <div className="flex items-start justify-between gap-3 p-5 [border-bottom:1px_solid_var(--color-line)] sticky top-0 bg-card z-[1]">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink">Scheduled changes</span>
          <h2 id="scheduled-changes" className="m-0 text-title font-semibold [overflow-wrap:anywhere]">{unitLabel}</h2>
        </div>
        <CloseButton onClick={onClose} />
      </div>

      <div className="p-5 flex flex-col gap-6">
        {money && (
          <section className="flex flex-col gap-2">
            <Heading>Contract</Heading>
            {contract.data && (held
              ? <p className="m-0 text-copy">{held.termsLabel}, starts {date(held.startsOn ?? '')}.{contract.data.untilThen ? ` Until then: ${contract.data.untilThen.termsLabel}.` : ''}</p>
              : <p className="m-0 text-copy text-muted-ink">No new contract waiting. In force: {contract.data.current.termsLabel}.</p>)}
            {contract.error && <p role="alert" className="m-0 text-copy text-critical">{contract.error}</p>}
            <p className="m-0 text-meta text-muted-ink">Give a new contract its start date on the Contract tab. The statement uses it for the whole month it starts in, so start on the 1st for a clean change.</p>
            <div><Button size="sm" variant="secondary" onClick={onOpenContract}>Go to the Contract tab</Button></div>
          </section>
        )}

        {prices.error && <p role="alert" className="m-0 text-copy text-critical">{prices.error}</p>}
        {!data && !prices.error && <Skeleton height={220} />}
        {data && !data.dated && <p className="m-0 text-copy text-muted-ink">Dated prices are not switched on yet. They need a database update (migration 0186).</p>}
        {data?.dated && !data.mayEdit && <p className="m-0 text-copy text-muted-ink">Only management schedules price changes.</p>}

        {mayEdit && <>
          <section className="flex flex-col gap-3">
            <Heading>New prices from a date</Heading>
            <DateField label="Applies from" value={from} min={todayMyt(1)} onChange={setFrom} />
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2.5">
              {CLEAN_KINDS.map(([k, label]) => {
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
              <span className="col-span-2 text-copy font-medium">Maintenance</span>
              <div className="col-span-2">
                <Select label="Maintenance item" value={itemId} placeholder="Choose an item" onChange={setItemId}
                  options={(skus.data?.data ?? []).map(s => ({ value: s.id, label: `${s.code} ${s.name}` }))} />
              </div>
              {itemId && <>
                <MoneyInput label="Owner is charged" placeholder={sku?.defaultPrice != null ? `List ${rm(sku.defaultPrice)}` : 'Not set'} valueSen={item.charge} onChangeSen={v => setItem(i => ({ ...i, charge: v }))} />
                <MoneyInput label="It costs us" placeholder={sku?.internalCost != null ? `List ${rm(sku.internalCost)}` : 'Not set'} valueSen={item.pay} onChangeSen={v => setItem(i => ({ ...i, pay: v }))} />
              </>}
            </div>
            <span className="text-meta text-muted-ink">Fill only what changes. A box left empty on a line you changed uses the list price from that date.</span>
            <div>
              <Button size="sm" variant="primary" loading={busy} disabled={!from || edits.length === 0}
                disabledReason={!from ? 'Pick the date first.' : 'Enter a new price first.'} onClick={() => void schedule()}>Schedule change</Button>
            </div>
          </section>

          <section className="flex flex-col gap-1">
            <Heading>Waiting for their date</Heading>
            {scheduled.length ? <ul className="m-0 mt-1 p-0 list-none">{scheduled.map(row)}</ul> : <p className="m-0 text-copy text-muted-ink">Nothing scheduled.</p>}
          </section>

          {inForce.length > 0 && (
            <section className="flex flex-col gap-1">
              <Heading>This unit's own prices now</Heading>
              <ul className="m-0 mt-1 p-0 list-none">{inForce.map(row)}</ul>
            </section>
          )}
        </>}
      </div>
    </Drawer>
  );
}
