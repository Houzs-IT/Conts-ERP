import { useSearchParams } from 'react-router-dom';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { useApi } from '../../lib/useApi';
import { monthLabel, todayMyt } from '../../lib/format';
import { PnlTable, type PnlRow } from './PnlTable';

interface Payload { month: string; current: boolean; closed: boolean; pnl: PnlRow[] | null; companyPnl: PnlRow[] | null }

const shift = (ym: string, by: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** The month the Financials tab shows (?fmonth=, this month by default), with a stepper and a month picker. */
export function useFinancialMonth(): [string, (m: string) => void] {
  const [params, setParams] = useSearchParams();
  const now = todayMyt().slice(0, 7);
  const raw = params.get('fmonth');
  const month = raw && /^\d{4}-\d{2}$/.test(raw) ? raw : now;
  const set = (m: string) => setParams(p => { const n = new URLSearchParams(p); if (m === now) n.delete('fmonth'); else n.set('fmonth', m); return n; }, { replace: true });
  return [month, set];
}

export function MonthStepper({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const now = todayMyt().slice(0, 7);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button type="button" aria-label="Previous month" onClick={() => onChange(shift(month, -1))} className="w-9 h-9 grid place-items-center rounded-control border border-solid border-line bg-card text-ink cursor-pointer hover:bg-muted"><Icon name="ChevronLeft" size="sm" /></button>
      <input type="month" aria-label="Month" value={month} max={shift(now, 12)} onChange={e => e.target.value && onChange(e.target.value)}
        className="field-input h-9! w-[160px]" />
      <button type="button" aria-label="Next month" onClick={() => onChange(shift(month, 1))} className="w-9 h-9 grid place-items-center rounded-control border border-solid border-line bg-card text-ink cursor-pointer hover:bg-muted"><Icon name="ChevronRight" size="sm" /></button>
      {month !== now && <Button size="sm" variant="tertiary" onClick={() => onChange(now)}>This month</Button>}
    </div>
  );
}

/** The unit's owner statement and The Conts' P and L for the picked month (GET /api/units/financials). */
export default function FinancialsTab({ unitId, month }: { unitId: string; month: string }) {
  const q = useApi<Payload>(`/units/financials?unitId=${encodeURIComponent(unitId)}&month=${month}`);
  const d = q.data && q.data.month === month ? q.data : null;
  const period = d?.current ? `${monthLabel(month)} to date` : monthLabel(month);
  const loading = <div className="py-10 px-5 text-center text-copy text-muted-ink">{q.error ?? 'Loading the month…'}</div>;
  return (
    <>
      <Card>
        <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex flex-col gap-1">
          <span className="text-[16px] font-semibold tracking-[-0.01em]">Owner statement · {period}</span>
          <span className="text-meta text-muted-ink [text-wrap:pretty]">
            Every line of the owner statement for this unit, by its income model: the reservations split by night into the month, each cost the owner pays (nil ones too), the operator's share and the payout.
            {d?.current ? ' The month is not closed yet, so the figures still move.' : ''}
          </span>
        </div>
        {d?.pnl ? <PnlTable rows={d.pnl} /> : d ? <div className="py-8 px-5 text-center text-copy text-muted-ink">No statement for this unit in {monthLabel(month)}.</div> : loading}
      </Card>
      {(d?.companyPnl || !d) && (
        <Card>
          <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex flex-col gap-1">
            <span className="text-[16px] font-semibold tracking-[-0.01em]">The Conts' P&amp;L · {period}</span>
            <span className="text-meta text-muted-ink [text-wrap:pretty]">What The Conts keeps or pays on this unit. On a guaranteed-rent unit: every reservation and every cost on the unit, whoever paid it, under the fixed rent to the owner. Costs paid by The Conts, a tenant or a guest never reach the owner statement.</span>
          </div>
          {d?.companyPnl ? <PnlTable rows={d.companyPnl} /> : loading}
        </Card>
      )}
    </>
  );
}
