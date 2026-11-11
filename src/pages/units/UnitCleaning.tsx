import { Link } from 'react-router-dom';
import { StaleBanner } from '../../components/DataState';
import { Skeleton } from '../../components/States';
import { cx } from '../../lib/design-tokens';
import { amount, plural } from '../../lib/format';

/** The unit's cleaning prices, on its Details tab: for each clean type the old price (the unit's own cleaning price
 *  from before the price table) and what applies now, what the owner is charged, what a guest is charged and what the
 *  cleaner is paid, and where that comes from (GET /api/housekeeping/unit-prices?unitId=). Read only (chew, 10 Nov
 *  2026: prices are entered under Cleaning, Prices, not here). Amounts are sen. */

export interface UnitPrice {
  internalCost: number | null; externalCharge: number | null; guestCharge?: number | null;
  /** The unit's old cleaning price (unit costs); a clean still falls back to it when nothing else is set. */
  oldCharge?: number | null;
  source: 'unit' | 'table' | null;
  override: { internalCost: number | null; externalCharge: number | null; guestCharge?: number | null } | null;
}
/** A unit's own price in force or still to come (management only). Both figures empty: the list price from that day. */
export interface UnitPriceChange { itemId: string; name: string; domain: string; cleanKind: string | null; effectiveFrom: string; ownerPrice: number | null; internalCost: number | null; scheduled: boolean }
export interface UnitPriceData {
  ready: boolean; rows: Array<{ unitId: string; bedCount?: number; prices: Record<string, UnitPrice> }>; mayEdit: boolean; dated?: boolean;
  byBed?: boolean; bedPricing?: 'size' | 'count'; guestPrices?: boolean; changes?: UnitPriceChange[];
}

export const CLEAN_KINDS = [['turnover', 'Basic clean'], ['deep_clean', 'Deep clean']] as const;

/** What the owner is charged for one clean now: the unit's own or the table's price, else the old price it falls back to. */
const ownerNow = (p: UnitPrice | undefined): number | null => p?.externalCharge ?? p?.oldCharge ?? null;

/** Basic or deep clean with no owner price at all (own, table or old): cleaning jobs on this unit show "Price not set". */
export const missingCleanPrice = (d: UnitPriceData | null): boolean => {
  const prices = d?.ready ? d.rows[0]?.prices : undefined;
  return !!prices && ['turnover', 'deep_clean'].some(k => ownerNow(prices[k]) == null);
};

const CELL = 'py-2 px-2 [border-top:1px_solid_var(--color-line-soft)]';
const GROUP = '[border-left:1px_solid_var(--color-line)]';
const HEAD = 'pb-1.5 px-2 text-meta font-semibold text-muted-ink';
const figure = (v: number | null | undefined) => (v == null ? <span className="text-muted-ink">—</span> : amount(v));

export function UnitCleaning({ data, loading, error, reload }: {
  unitId: string; data: UnitPriceData | null; loading: boolean; error: string | null; reload: () => void; canEdit: boolean;
}) {
  if (error) return <div className="mb-[22px]"><StaleBanner message={`Cleaning prices could not be loaded: ${error}`} onRetry={reload} /></div>;
  if (!data) return loading ? <div className="mb-[22px]"><Skeleton height={120} /></div> : null;
  if (!data.ready) return <p className="m-0 mb-[22px] text-copy text-muted-ink">Cleaning prices are not switched on yet. They need a database update (migration 0126).</p>;
  const row = data.rows[0];
  const prices = row?.prices;
  if (!prices) return <p className="m-0 mb-[22px] text-copy text-muted-ink">This unit has no cleaning prices to show yet.</p>;
  const byCount = data.byBed && data.bedPricing === 'count';
  const from = (p: UnitPrice | undefined): string => {
    if (p?.override) return "This unit's own price";
    if (p?.source === 'table') return byCount ? `Price table, ${plural(row.bedCount ?? 0, 'bed')}` : 'Price list';
    if (p?.oldCharge != null) return 'Old price: the table has none for this unit';
    return 'Not set';
  };
  return (
    <div className="flex flex-col gap-2 mb-[22px]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] max-w-[820px] table-fixed border-collapse text-copy tabular-nums">
          <colgroup><col className="w-[18%]" /><col className="w-[13%]" /><col className="w-[13%]" /><col className="w-[13%]" /><col className="w-[13%]" /><col /></colgroup>
          <thead>
            <tr>
              <th rowSpan={2} scope="col" className={cx(HEAD, 'text-left align-bottom pl-0')}>Clean type</th>
              <th rowSpan={2} scope="col" className={cx(HEAD, 'text-right align-bottom')}>Old price</th>
              <th colSpan={3} scope="colgroup" className={cx('text-center pb-1 text-copy font-semibold', GROUP)}>Now</th>
              <th rowSpan={2} scope="col" className={cx(HEAD, 'text-left align-bottom')}>Comes from</th>
            </tr>
            <tr>
              <th scope="col" className={cx(HEAD, 'text-right', GROUP)}>Owner</th>
              <th scope="col" className={cx(HEAD, 'text-right')}>Guest</th>
              <th scope="col" className={cx(HEAD, 'text-right')}>Cleaner pay</th>
            </tr>
          </thead>
          <tbody>
            {CLEAN_KINDS.map(([k, label]) => {
              const p = prices[k];
              return (
                <tr key={k}>
                  <th scope="row" className={cx(CELL, 'text-left font-medium pl-0')}>{label}</th>
                  <td className={cx(CELL, 'text-right text-muted-ink')}>{figure(p?.oldCharge)}</td>
                  <td className={cx(CELL, 'text-right', GROUP)}>{figure(ownerNow(p))}</td>
                  <td className={cx(CELL, 'text-right')}>{figure(p?.guestCharge)}</td>
                  <td className={cx(CELL, 'text-right')}>{figure(p?.internalCost)}</td>
                  <td className={cx(CELL, 'text-left text-meta text-muted-ink')}>{from(p)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <span className="text-meta text-muted-ink">
        Amounts in RM. Prices are changed under <Link to="/operations/cleaning?tab=prices" className="text-gold-ink font-medium">Cleaning, Prices</Link>: the table by number of beds, or this unit's own price under Per unit.
      </span>
    </div>
  );
}
