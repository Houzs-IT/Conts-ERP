import { useMemo, useState, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { SystemStats } from '../components/SystemStats';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { EmptyState } from '../components/States';
import { Segmented } from '../components/Metric';
import { useApi } from '../lib/useApi';
import { rm, plural, buildingName } from '../lib/format';
import { Select, SearchSelect } from '../components/Select';
import { usePhone, SearchBox } from './finance/listKit';
import { TONE, cx } from '../lib/design-tokens';
import { UnitPrices } from './pricing/UnitPrices';
import { BatchEdit } from './pricing/BatchEdit';
import type { PricingPayload } from './pricing/types';
// Loaded when shown: imported directly by both Pricing and HR it became a chunk every page's preload list names
// (scripts/checks/entry-bundle.mjs).
const HolidayList = lazy(() => import('../components/HolidayList').then(m => ({ default: m.HolidayList })));

/* ------------------------------------------------------------------ *
 * Pricing (/performance/pricing): each unit's nightly, weekend and
 * holiday price, what every channel charges per level (a % or RM above
 * the direct price, or fixed prices of its own), batch edit for many
 * units, and the company's public holiday list. Date-by-date custom
 * prices stay on the Calendar (Change prices).
 * ------------------------------------------------------------------ */

type Tab = 'units' | 'batch' | 'holidays';
const TABS = [
  { key: 'units' as const, label: 'Unit prices' },
  { key: 'batch' as const, label: 'Batch edit' },
  { key: 'holidays' as const, label: 'Public holidays' },
];

export default function PricingPage() {
  const { data, loading, error, reload } = useApi<PricingPayload>('/pricing/rules');
  const [params, setParams] = useSearchParams();
  const tab: Tab = (['units', 'batch', 'holidays'] as const).find(t => t === params.get('tab')) ?? 'units';
  const setTab = (t: Tab) => setParams(p => { const n = new URLSearchParams(p); if (t === 'units') n.delete('tab'); else n.set('tab', t); return n; }, { replace: true });

  const units = data?.units ?? [];
  const selectedId = params.get('unitId');
  const setSelectedId = (id: string) => setParams(p => { const n = new URLSearchParams(p); n.set('unitId', id); return n; }, { replace: true });
  const phone = usePhone();
  const [q, setQ] = useState('');
  const [building, setBuilding] = useState('');

  const selected = units.find(u => u.unitId === selectedId) ?? units[0] ?? null;
  const buildings = useMemo(() => [...new Set(units.map(u => u.propertyName))].sort((a, b) => a.localeCompare(b)), [units]);
  const listed = useMemo(() => units
    .filter(u => (!building || u.propertyName === building) && (!q.trim() || `${u.propertyName} ${u.unitNumber}`.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => a.propertyName.localeCompare(b.propertyName) || a.unitNumber.localeCompare(b.unitNumber, 'en', { numeric: true })), [units, building, q]);
  const noRate = units.filter(u => u.baseRate <= 0).length;
  const withHoliday = units.filter(u => u.holidayRate).length;
  const priced = units.filter(u => u.baseRate > 0);
  // No unit sends its prices to a channel yet: "Failed updates 0" would only say the feature is off, so it is a note instead.
  const sending = units.some(u => u.rates.some(r => r.sync !== 'not_connected'));

  return (
    <>
      <PageHeader
        title="Pricing"
        sub={data ? `${plural(units.length, 'unit')}${noRate ? ` · ${noRate} with no nightly price` : ''} · nightly, weekend and holiday prices per channel` : 'Nightly, weekend and holiday prices per channel'}
      />

      <SystemStats loading={loading && units.length === 0} stats={[
        { label: 'Average nightly', value: priced.length ? rm(Math.round(priced.reduce((s, u) => s + u.baseRate, 0) / priced.length)) : undefined, hint: 'Direct, Sun to Thu' },
        { label: 'Units priced', value: data ? String(units.length - noRate) : undefined, hint: `of ${units.length}` },
        { label: 'Holiday price set', value: data ? String(withHoliday) : undefined, hint: `of ${units.length}` },
        ...(sending || !data ? [{ label: 'Failed updates', value: data ? String(units.reduce((s, u) => s + u.rates.filter(r => r.sync === 'failed').length, 0)) : undefined, hint: 'To channels', warn: units.some(u => u.rates.some(r => r.sync === 'failed')) }] : []),
      ]} />
      {data && units.length > 0 && !sending && (
        <p className="m-0 -mt-1 text-meta text-muted-ink">No unit is connected to a channel yet, so these prices are not sent anywhere. Connect a unit in Integrations to send them.</p>
      )}

      {/* The Metric switch, not TabBar: TabBar would become a chunk of its own that every page's preload list names. */}
      <div className="mb-4"><Segmented label="Pricing pages" options={TABS} value={tab} onChange={setTab} /></div>

      <div>
        {error && <StaleBanner message={`Showing the last prices we have. ${error}`} onRetry={reload} />}
        {data && !data.levelsReady && tab !== 'holidays' && (
          <div className={cx('mb-3 rounded-control px-4 py-2.5 border border-solid text-meta', TONE.warning.text, TONE.warning.bg, TONE.warning.border)}>
            Holiday prices and % or fixed channel prices need a database update (migration 0202) on this system. Nightly and weekend prices work as before.
          </div>
        )}

        {tab === 'holidays' ? (
          <Card className="p-5">
            {data && !data.holidaysReady
              ? <EmptyState bare title="The shared holiday list needs a database update." body="Migration 0202 has not been applied here yet. HR keeps using its own list until then." />
              : <Suspense fallback={<TableSkeleton rows={4} cols={3} />}><HolidayList onChanged={reload} /></Suspense>}
          </Card>
        ) : loading && units.length === 0 ? (
          <Card><TableSkeleton rows={5} cols={4} /></Card>
        ) : units.length === 0 ? (
          <EmptyState title="No units to price yet." body="Add a unit to set its prices." />
        ) : tab === 'batch' ? (
          <BatchEdit units={units} onSaved={reload} />
        ) : (
          <div className="flex gap-4 items-start flex-wrap">
            {phone ? (
              <SearchSelect label="Unit" showLabel className="w-full" placeholder="Search unit or building" value={selected?.unitId ?? ''} onChange={v => v && setSelectedId(v)}
                options={units.map(u => ({ value: u.unitId, label: u.unitNumber, group: buildingName(u.propertyName), hint: u.baseRate > 0 ? rm(u.baseRate, { cents: false }) : 'No nightly price' }))} />
            ) : (
              <Card className="lg:sticky lg:top-0 lg:z-[1]" style={{ flex: '0 1 280px', minWidth: 240, maxWidth: 320 }}>
                <div className="py-3 px-3 [border-bottom:1px_solid_var(--color-line)] flex flex-col gap-2">
                  <SearchBox label="Search units" placeholder="Search unit or building" value={q} onChange={setQ} />
                  <Select label="Building" value={building} onChange={setBuilding} placeholder={`All buildings · ${buildings.length}`} options={buildings.map(b => ({ value: b, label: buildingName(b) }))} />
                  <span className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink px-1">Units · {listed.length === units.length ? units.length : `${listed.length} of ${units.length}`}</span>
                </div>
                <div data-keep-scroll="pricing.units" className="max-h-[70vh] overflow-y-auto overscroll-contain [scrollbar-width:thin]">
                  {listed.length === 0 && <EmptyState bare kind="filtered" title="No units match." action={{ label: 'Clear filters', onClick: () => { setQ(''); setBuilding(''); } }} />}
                  {listed.map(u => {
                    const on = selected?.unitId === u.unitId;
                    const failed = u.rates.filter(r => r.sync === 'failed').length;
                    const queued = u.rates.filter(r => r.sync === 'queued').length;
                    const linked = u.rates.filter(r => r.sync !== 'not_connected').length;
                    const syncNote = failed ? `${failed} to fix` : queued ? `${queued} waiting to send` : linked ? 'All sent' : 'Not connected';
                    return (
                      <button key={u.unitId} type="button" onClick={() => setSelectedId(u.unitId)}
                        className={cx('flex flex-col gap-[3px] w-full text-left py-3 px-4 cursor-pointer [font:inherit] [border-bottom:1px_solid_var(--color-line-soft)]',
                          on ? '[border-left:3px_solid_var(--color-gold)] bg-gold-tint' : '[border-left:3px_solid_transparent] bg-transparent')}>
                        <span className="text-copy font-semibold">{u.unitNumber}</span>
                        <span className="text-meta text-muted-ink">{buildingName(u.propertyName)} · {u.baseRate > 0 ? rm(u.baseRate, { cents: false }) : <span className={TONE.critical.text}>No nightly price</span>}{u.holidayRate ? ` · holiday ${rm(u.holidayRate, { cents: false })}` : ''}</span>
                        <span className={cx('text-caption', failed ? TONE.critical.text : 'text-faint')}>{syncNote}</span>
                      </button>
                    );
                  })}
                </div>
              </Card>
            )}
            {selected && <UnitPrices key={selected.unitId} unit={selected} levelsReady={!!data?.levelsReady} onSaved={reload} />}
          </div>
        )}
      </div>
    </>
  );
}
