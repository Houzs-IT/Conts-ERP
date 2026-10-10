import { useMemo } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { TONE, cx } from '../lib/design-tokens';
import type { Tone } from '../lib/types';

/** Coverage & Fleet — ported from 2990's SCM (Coverage & Fleet), drawn in Conts. A read-only
 *  overview of which vehicles and drivers are available today, aggregating the fleet masters +
 *  open maintenance + today's driver leave. */

type VState = 'AVAILABLE' | 'MAINTENANCE' | 'INACTIVE';
type DState = 'AVAILABLE' | 'ON_LEAVE' | 'INACTIVE';
interface Veh { id: string; code: string; plate: string; vehicleType: string; active: boolean; openMaintenance: number; overdue: number; state: VState }
interface Drv { id: string; driverCode: string; name: string; phone: string; active: boolean; onLeave: boolean; state: DState }
interface Summary { vehiclesTotal: number; vehiclesAvailable: number; vehiclesMaintenance: number; driversTotal: number; driversAvailable: number; driversOnLeave: number }
interface Payload { vehicles: Veh[]; drivers: Drv[]; summary: Summary; generatedAt: string }

const V_TONE: Record<VState, Tone> = { AVAILABLE: 'success', MAINTENANCE: 'warning', INACTIVE: 'neutral' };
const V_LABEL: Record<VState, string> = { AVAILABLE: 'Available', MAINTENANCE: 'In maintenance', INACTIVE: 'Inactive' };
const D_TONE: Record<DState, Tone> = { AVAILABLE: 'success', ON_LEAVE: 'warning', INACTIVE: 'neutral' };
const D_LABEL: Record<DState, string> = { AVAILABLE: 'Available', ON_LEAVE: 'On leave', INACTIVE: 'Inactive' };

const FALLBACK: Payload = {
  generatedAt: '',
  vehicles: [
    { id: 'v1', code: 'LRY-01', plate: 'WXY 1234', vehicleType: '3-tonne lorry', active: true, openMaintenance: 0, overdue: 0, state: 'AVAILABLE' },
    { id: 'v2', code: 'LRY-02', plate: 'VBA 5678', vehicleType: '1-tonne van', active: true, openMaintenance: 1, overdue: 1, state: 'MAINTENANCE' },
  ],
  drivers: [
    { id: 'd1', driverCode: 'DRV-001', name: 'Ahmad Zaki', phone: '+60123456789', active: true, onLeave: false, state: 'AVAILABLE' },
    { id: 'd2', driverCode: 'DRV-002', name: 'Ravi Kumar', phone: '+60129876543', active: true, onLeave: true, state: 'ON_LEAVE' },
  ],
  summary: { vehiclesTotal: 2, vehiclesAvailable: 1, vehiclesMaintenance: 1, driversTotal: 2, driversAvailable: 1, driversOnLeave: 1 },
};

export default function CoverageFleetPage() {
  const { data, loading, error, reload } = useApi<Payload>('/coverage-fleet', FALLBACK);
  const s = data?.summary;

  const vehicleColumns = useMemo<Column<Veh>[]>(() => [
    { key: 'vehicle', label: 'Vehicle', value: v => v.code, text: v => `${v.code} ${v.plate}`, hideable: false, render: v => <span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{v.code}</span>, sub: v => v.plate || null },
    { key: 'type', label: 'Type', value: v => v.vehicleType },
    { key: 'status', label: 'Status', type: 'status', value: v => v.state, status: v => ({ label: V_LABEL[v.state], tone: V_TONE[v.state] }), render: v => <Pill tone={V_TONE[v.state]} label={V_LABEL[v.state]} extra={v.overdue > 0 ? `${v.overdue} overdue` : ''} /> },
  ], []);
  const driverColumns = useMemo<Column<Drv>[]>(() => [
    { key: 'driver', label: 'Driver', value: d => d.name, text: d => `${d.name} ${d.driverCode}`, hideable: false, sub: d => <span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px]">{d.driverCode}</span> },
    { key: 'phone', label: 'Phone', value: d => d.phone },
    { key: 'status', label: 'Status', type: 'status', value: d => d.state, status: d => ({ label: D_LABEL[d.state], tone: D_TONE[d.state] }) },
  ], []);

  return (
    <>
      <PageHeader title="Coverage & fleet" sub="Who and what is available for delivery today" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <Tile label="Vehicles available" value={s ? `${s.vehiclesAvailable}/${s.vehiclesTotal}` : '—'} tone="success" />
        <Tile label="In maintenance" value={s ? String(s.vehiclesMaintenance) : '—'} tone="warning" />
        <Tile label="Drivers available" value={s ? `${s.driversAvailable}/${s.driversTotal}` : '—'} tone="success" />
        <Tile label="On leave today" value={s ? String(s.driversOnLeave) : '—'} tone="warning" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 min-w-0">
        <div className="min-w-0">
          <DataTable<Veh>
            id="scm.coverage-fleet.vehicles" urlPrefix="v." columns={vehicleColumns} rows={data ? data.vehicles : null} rowKey={v => v.id}
            loading={loading} error={error} onRetry={reload} pageSize={0}
            noun={['vehicle', 'vehicles']} exportName="coverage-vehicles"
            header={<div className="px-5 pt-4 pb-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-muted-ink">Vehicles</div>}
            empty={{ title: 'No vehicles.' }} />
        </div>
        <div className="min-w-0">
          <DataTable<Drv>
            id="scm.coverage-fleet.drivers" urlPrefix="d." columns={driverColumns} rows={data ? data.drivers : null} rowKey={d => d.id}
            loading={loading} error={error} onRetry={reload} pageSize={0}
            noun={['driver', 'drivers']} exportName="coverage-drivers"
            header={<div className="px-5 pt-4 pb-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-muted-ink">Drivers</div>}
            empty={{ title: 'No drivers.' }} />
        </div>
      </div>
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <Card>
      <div className="px-4 py-3.5 flex flex-col gap-1">
        <span className="text-[11.5px] uppercase tracking-[0.08em] text-muted-ink">{label}</span>
        <span className={cx('text-[24px] font-semibold tabular-nums', TONE[tone].text)}>{value}</span>
      </div>
    </Card>
  );
}
function Pill({ tone, label, extra }: { tone: Tone; label: string; extra?: string }) {
  return <span className={cx('inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-0.5 rounded-full', TONE[tone].bg, TONE[tone].text)}><span className="w-1.5 h-1.5 rounded-full bg-current" />{label}{extra ? ` · ${extra}` : ''}</span>;
}
