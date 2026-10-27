import { useState } from 'react';
import { Button } from '../../components/Button';
import { MoneyInput } from '../../components/inputs';
import { Skeleton } from '../../components/States';
import { useToast } from '../../components/Toast';
import { api, notifyFailure } from '../../lib/api';
import { rm } from '../../lib/format';

/** The unit's own cleaning prices, on its Details tab (staff sheet UNIT, 27 Oct 2026). The same figures as Cleaning,
 *  Prices, Per unit (GET and PUT /api/housekeeping/unit-prices): per clean type, what the owner is charged and what the
 *  cleaner is paid. A box left empty uses the list price, shown in grey. Amounts are sen. */

export interface UnitPrice { internalCost: number | null; externalCharge: number | null; source: 'unit' | 'table' | null; override: { internalCost: number | null; externalCharge: number | null } | null }
export interface UnitPriceData { ready: boolean; rows: Array<{ unitId: string; prices: Record<string, UnitPrice> }>; mayEdit: boolean }

export const CLEAN_KINDS = [['turnover', 'Basic clean'], ['deep_clean', 'Deep clean']] as const;

/** Basic or deep clean with no owner price at all (not its own, not the list's): cleaning jobs on this unit show "Price not set". */
export const missingCleanPrice = (d: UnitPriceData | null): boolean => {
  const prices = d?.ready ? d.rows[0]?.prices : undefined;
  return !!prices && ['turnover', 'deep_clean'].some(k => prices[k]?.externalCharge == null);
};

type Draft = Record<string, { charge?: number | null; pay?: number | null }>;

export function UnitCleaning({ unitId, data, loading, error, reload, canEdit }: {
  unitId: string; data: UnitPriceData | null; loading: boolean; error: string | null; reload: () => void; canEdit: boolean;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  if (error) return <p role="alert" className="m-0 mb-[22px] text-copy text-critical">Cleaning prices could not be loaded: {error} <button type="button" onClick={reload} className="p-0 bg-transparent border-none cursor-pointer [font-family:inherit] font-semibold text-gold-ink">Try again</button></p>;
  if (!data) return loading ? <div className="mb-[22px]"><Skeleton height={120} /></div> : null;
  if (!data.ready) return <p className="m-0 mb-[22px] text-copy text-muted-ink">Cleaning prices are not switched on yet. They need a database update (migration 0126).</p>;
  const prices = data.rows[0]?.prices;
  if (!prices) return <p className="m-0 mb-[22px] text-copy text-muted-ink">This unit has no cleaning prices to show yet.</p>;
  const mayEdit = canEdit && data.mayEdit;
  const own = (k: string) => prices[k]?.override ?? null;
  const charge = (k: string) => (draft[k]?.charge !== undefined ? draft[k].charge : own(k)?.externalCharge ?? null);
  const pay = (k: string) => (draft[k]?.pay !== undefined ? draft[k].pay : own(k)?.internalCost ?? null);
  const hint = (k: string, field: 'externalCharge' | 'internalCost') => {
    const p = prices[k];
    return p?.source === 'table' && p[field] != null ? `List ${rm(p[field])}` : 'Not set';
  };
  const set = (k: string, p: Draft[string]) => setDraft(d => ({ ...d, [k]: { ...d[k], ...p } }));
  const changed = CLEAN_KINDS.filter(([k]) => draft[k] && (charge(k) !== (own(k)?.externalCharge ?? null) || pay(k) !== (own(k)?.internalCost ?? null)));

  async function save() {
    setBusy(true);
    try {
      for (const [k] of changed) await api.put('/housekeeping/unit-prices', { unitId, kind: k, internalCost: pay(k), externalCharge: charge(k) });
      toast({ tone: 'success', title: 'Cleaning prices saved.', body: 'Cleans not yet finished on this unit use them from now on.' });
      setDraft({});
      reload();
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-3 mb-[22px]">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5 max-w-[640px]">
        <span className="max-sm:hidden text-meta font-medium text-muted-ink">Clean type</span>
        <span className="max-sm:hidden text-meta font-medium text-muted-ink">Owner is charged</span>
        <span className="max-sm:hidden text-meta font-medium text-muted-ink">Cleaner is paid</span>
        {CLEAN_KINDS.map(([k, label]) => (
          <div key={k} className="contents">
            <span className="max-sm:col-span-2 text-copy font-medium">{label}{own(k) && <span className="ml-1.5 text-meta font-normal text-gold-ink">own price</span>}</span>
            <MoneyInput label="" aria-label={`${label}: owner is charged`} placeholder={hint(k, 'externalCharge')} valueSen={charge(k)} disabled={!mayEdit}
              onChangeSen={v => set(k, { charge: v })} />
            <MoneyInput label="" aria-label={`${label}: cleaner is paid`} placeholder={hint(k, 'internalCost')} valueSen={pay(k)} disabled={!mayEdit}
              onChangeSen={v => set(k, { pay: v })} />
          </div>
        ))}
      </div>
      <span className="text-meta text-muted-ink">
        {mayEdit ? 'Leave a box empty to use the list price, shown in grey. The list is edited under Cleaning, Prices.' : 'Only management changes cleaning prices. The list is under Cleaning, Prices.'}
      </span>
      {mayEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" loading={busy} disabled={changed.length === 0} disabledReason="Change a price first." onClick={() => void save()}>Save cleaning prices</Button>
          {changed.length > 0 && !busy && <Button size="sm" variant="secondary" onClick={() => setDraft({})}>Discard</Button>}
        </div>
      )}
    </div>
  );
}
