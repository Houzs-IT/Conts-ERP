import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StaleBanner, TableSkeleton } from '../components/DataState';
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
  const vehicles = data?.vehicles ?? [];
  const drivers = data?.drivers ?? [];

  return (
    <>
      <PageHeader title="Coverage & fleet" sub="Who and what is available for delivery today" />
      {error && <StaleBanner message={`Showing the last coverage we have. ${error}`} onRetry={reload} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <Tile label="Vehicles available" value={s ? `${s.vehiclesAvailable}/${s.vehiclesTotal}` : '—'} tone="success" />
        <Tile label="In maintenance" value={s ? String(s.vehiclesMaintenance) : '—'} tone="warning" />
        <Tile label="Drivers available" value={s ? `${s.driversAvailable}/${s.driversTotal}` : '—'} tone="success" />
        <Tile label="On leave today" value={s ? String(s.driversOnLeave) : '—'} tone="warning" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <div className="px-5 pt-4 pb-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-muted-ink">Vehicles</div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[360px]">
              <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">{['Vehicle', 'Type', 'Status'].map(h => <th key={h} className="py-2.5 px-4 text-left text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted-ink">{h}</th>)}</tr></thead>
              <tbody>
                {loading && vehicles.length === 0 ? <tr><td colSpan={3}><TableSkeleton rows={4} cols={3} /></td></tr>
                : vehicles.length === 0 ? <tr><td colSpan={3}><div className="py-8 text-center text-[12.5px] text-muted-ink">No vehicles.</div></td></tr>
                : vehicles.map(v => (
                  <tr key={v.id} className="[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]">
                    <td className="py-[11px] px-4"><div className="flex flex-col"><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{v.code}</span>{v.plate && <span className="text-[11.5px] text-muted-ink">{v.plate}</span>}</div></td>
                    <td className="py-[11px] px-4 text-[12.5px] text-muted-ink">{v.vehicleType || '—'}</td>
                    <td className="py-[11px] px-4"><Pill tone={V_TONE[v.state]} label={V_LABEL[v.state]} extra={v.overdue > 0 ? `${v.overdue} overdue` : ''} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <div className="px-5 pt-4 pb-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-muted-ink">Drivers</div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[360px]">
              <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">{['Driver', 'Phone', 'Status'].map(h => <th key={h} className="py-2.5 px-4 text-left text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted-ink">{h}</th>)}</tr></thead>
              <tbody>
                {loading && drivers.length === 0 ? <tr><td colSpan={3}><TableSkeleton rows={4} cols={3} /></td></tr>
                : drivers.length === 0 ? <tr><td colSpan={3}><div className="py-8 text-center text-[12.5px] text-muted-ink">No drivers.</div></td></tr>
                : drivers.map(d => (
                  <tr key={d.id} className="[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]">
                    <td className="py-[11px] px-4"><div className="flex flex-col"><span className="text-[13px]">{d.name}</span><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px] text-muted-ink">{d.driverCode}</span></div></td>
                    <td className="py-[11px] px-4 text-[12.5px] text-muted-ink tabular-nums">{d.phone || '—'}</td>
                    <td className="py-[11px] px-4"><Pill tone={D_TONE[d.state]} label={D_LABEL[d.state]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
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
