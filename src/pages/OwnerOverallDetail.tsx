import { type ReactNode } from 'react';
import { cx } from '../lib/design-tokens';
import { amount, percent, plural } from '../lib/format';
import { StatusBadge } from '../components/StatusBadge';
import { Segmented } from '../components/Metric';
import { CloseButton } from '../components/CloseButton';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { overallTotals, type OverallFigures } from '../lib/ownerOverall';

/** The overall owner report's unit drawer: L1 summary, L2 breakdown, L3 full detail. Every figure comes from
 *  ownerOverall.ts; this file only lays them out. */

export type Level = 1 | 2 | 3;
export interface ReportRow extends OverallFigures { unitId: string; code: string; building: string; ownerName: string }

export const LEVELS: { key: `${Level}`; label: string }[] = [
  { key: '1', label: 'L1 Summary' }, { key: '2', label: 'L2 Breakdown' }, { key: '3', label: 'L3 Full detail' },
];

/** 1,234.56 with a real minus sign; `cents: false` gives 1,235 (the phone's summary table). */
export const money = (sen: number, cents = true) => (sen < 0 ? `−${amount(-sen, { cents })}` : amount(sen, { cents }));
export const signed = (sen: number, cents = true) => (sen < 0 ? `−${amount(-sen, { cents })}` : `+${amount(sen, { cents })}`);
export const contractName = (c: 'LT' | 'PS') => (c === 'LT' ? 'Long term' : 'Profit sharing');

export function GainLoss({ sen, size = 'sm', cents = true }: { sen: number; size?: 'sm' | 'md'; cents?: boolean }) {
  return (
    <StatusBadge size={size} tone={sen < 0 ? 'critical' : 'success'}
      label={<span className="inline-flex items-center gap-0.5 tabular-nums whitespace-nowrap">
        {sen < 0 ? <Icon name="ArrowDown" size="sm" style={{ width: 12, height: 12 }} /> : <Icon name="ArrowUp" size="sm" style={{ width: 12, height: 12 }} />}
        {signed(sen, cents)}
      </span>} />
  );
}

export function unitStatus(r: OverallFigures): { label: string; tone: 'success' | 'critical' | 'neutral' } {
  if (r.nights === 0) return { label: 'Vacant', tone: 'neutral' };
  return r.gainLoss < 0 ? { label: 'Losing', tone: 'critical' } : { label: 'Gaining', tone: 'success' };
}

function Line({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-muted-ink">{label}{note && <span className="ml-1.5 text-meta text-faint">{note}</span>}</span>
      <span className={cx('tabular-nums whitespace-nowrap', tone ?? 'text-ink')}>{value}</span>
    </div>
  );
}

function Section({ title, level, children }: { title: string; level: Level; children: ReactNode }) {
  return (
    <section className="px-5 py-4 [border-top:1px_solid_var(--color-line-soft)]">
      <h3 className="mb-2 flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.09em] text-muted-ink">
        {title}<span className="ml-auto rounded-[4px] bg-muted px-1.5 text-caption tracking-normal text-faint">L{level}</span>
      </h3>
      {children}
    </section>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-control border border-solid border-line-soft bg-page px-3 py-2 min-w-0">
      <div className="text-caption font-semibold uppercase tracking-[0.09em] text-muted-ink">{label}</div>
      <div className={cx('text-copy font-semibold tabular-nums truncate', tone ?? 'text-ink')}>{value}</div>
    </div>
  );
}

const avg = (rows: ReportRow[], pick: (r: ReportRow) => number) => (rows.length ? rows.reduce((n, r) => n + pick(r), 0) / rows.length : 0);

export function OwnerOverallDetail({ row, all, level, onLevel, onClose, onStep, position, total }: {
  row: ReportRow; all: ReportRow[]; level: Level; onLevel: (l: Level) => void; onClose: () => void;
  onStep: (by: -1 | 1) => void; position: number; total: number;
}) {
  const r = row, lt = r.contract === 'LT', st = unitStatus(r);
  const deductionItems: [string, number][] = [['Cleaning', r.cleaning], ['Utilities', r.utilities], ['Additional deduction', r.additional], ['Misc. charges', r.misc]];
  const biggest = Math.max(1, ...deductionItems.map(([, v]) => v));
  // The split bar: what the deductions took, what the owner is owed, and what is left (nothing when losing).
  const scale = Math.max(r.revenue, r.deductions + r.ownerBase, 1);
  const width = (v: number) => `${(Math.max(v, 0) / scale) * 100}%`;

  const peers = all.filter(x => x.contract === r.contract);
  const rank = [...peers].sort((a, b) => b.gainLoss - a.gainLoss).findIndex(x => x.unitId === r.unitId) + 1;
  const building = all.filter(x => x.building === r.building);
  const peerTotals = overallTotals(peers);
  const delta = (v: number, base: number, text: string) => (
    <span className={cx('tabular-nums text-meta', v - base < 0 ? 'text-danger' : 'text-success')}>{text}</span>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="sticky top-0 z-[1] bg-card px-5 pt-4 pb-3 [border-bottom:1px_solid_var(--color-line)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-caption font-semibold uppercase tracking-[0.09em] text-muted-ink">{contractName(r.contract)}</div>
            <h2 id="owner-overall-unit" className="text-title font-semibold truncate">{r.code}</h2>
            <div className="text-meta text-muted-ink truncate">{r.building} · {r.ownerName}</div>
            <div className="mt-1.5"><StatusBadge size="sm" tone={st.tone} label={st.label} /></div>
          </div>
          <CloseButton onClick={onClose} />
        </div>
        <Segmented label="Detail level" className="mt-3" value={`${level}`} onChange={k => onLevel(Number(k) as Level)} options={LEVELS} />
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto text-copy">
        <div className="px-5 py-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-caption font-semibold uppercase tracking-[0.09em] text-muted-ink">Gain / Loss</div>
              <div className="mt-1"><GainLoss sen={r.gainLoss} size="md" /></div>
            </div>
            <div className="text-right text-meta text-muted-ink">
              <div>{percent(r.occupancy)} occupancy</div>
              <div><span className="tabular-nums text-ink">{r.nights}</span> of {r.days} nights booked</div>
            </div>
          </div>
          <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img"
            aria-label={`Revenue ${money(r.revenue)}: deductions ${money(r.deductions)}, owner base ${money(r.ownerBase)}, kept ${money(Math.max(r.gainLoss, 0))}`}>
            <span className="h-full bg-warning-line" style={{ width: width(r.deductions) }} />
            <span className="h-full bg-info-line" style={{ width: width(r.ownerBase) }} />
            <span className="h-full bg-success-line" style={{ width: width(r.gainLoss) }} />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-meta text-muted-ink">
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-[2px] bg-warning-line" />Deductions</span>
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-[2px] bg-info-line" />Owner base</span>
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-[2px] bg-success-line" />Kept</span>
            {r.gainLoss < 0 && <span className="text-danger">Short by {money(-r.gainLoss)}</span>}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Tile label="Revenue" value={r.revenue ? money(r.revenue) : '—'} />
            <Tile label="Deduction" value={money(r.deductions)} />
            <Tile label="Payout" value={money(r.payout)} />
          </div>
        </div>

        {level >= 2 && <>
          <Section title="Revenue and profitability" level={2}>
            <Line label="Total revenue" value={r.revenue ? money(r.revenue) : '—'} tone={r.revenue ? undefined : 'text-faint'} />
            <Line label="Gross profit (GP)" value={money(r.gp)} note={r.revenue ? `${percent(r.margin)} margin` : undefined} tone={r.gp < 0 ? 'text-danger' : undefined} />
            <Line label="Gain / Loss" value={signed(r.gainLoss)} tone={r.gainLoss < 0 ? 'text-danger' : 'text-success'} />
          </Section>
          <Section title="Itemized deductions" level={2}>
            {deductionItems.map(([label, v]) => (
              <div key={label} className="py-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-ink">{label}</span>
                  <span className={cx('tabular-nums', v ? 'text-ink' : 'text-faint')}>{v ? money(v) : '—'}</span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden"><span className="block h-full bg-warning-line" style={{ width: `${(v / biggest) * 100}%` }} /></div>
              </div>
            ))}
            <div className="mt-2 flex items-baseline justify-between pt-2 font-semibold [border-top:1px_dashed_var(--color-line)]">
              <span>Total deduction</span><span className="tabular-nums">{money(r.deductions)}</span>
            </div>
          </Section>
          <Section title="Owner payout split" level={2}>
            <Line label="Owner %" value={lt ? '—' : `${r.ownerPct}%`} note={lt ? 'not used on long term' : 'of GP'} tone={lt ? 'text-faint' : undefined} />
            <Line label={lt ? 'LT (fixed rent)' : 'GRR (guaranteed minimum)'} value={r.ltGrr ? money(r.ltGrr) : '—'} tone={r.ltGrr ? undefined : 'text-faint'} />
            <Line label="O1" value={r.o1 ? money(r.o1) : '—'} note={lt ? undefined : 'GP × owner %'} tone={r.o1 ? undefined : 'text-faint'} />
            <Line label="O2" value={r.o2 ? money(r.o2) : '—'} note="adjustments" tone={r.o2 < 0 ? 'text-danger' : r.o2 ? undefined : 'text-faint'} />
            <div className="mt-2 flex items-baseline justify-between rounded-control bg-muted px-3 py-2 font-semibold">
              <span>Final owner payout</span><span className="tabular-nums text-heading">{money(r.payout)}</span>
            </div>
          </Section>
        </>}

        {level >= 3 && <>
          <Section title="How the numbers are worked out" level={3}>
            <Ledger rows={[
              ['', 'Total revenue', money(r.revenue)],
              ...deductionItems.map(([label, v]): LedgerRow => ['−', label, money(v)]),
              ['=', 'Gross profit (GP)', money(r.gp), true],
              ...(lt ? [] : [['×', `Owner share ${r.ownerPct}% gives O1`, money(r.o1)] as LedgerRow]),
              ['−', lt ? 'Owner base = LT fixed rent' : r.o1 >= r.ltGrr ? `Owner base = O1 (GRR is ${money(r.ltGrr)})` : `Owner base = GRR (O1 is ${money(r.o1)})`, money(r.ownerBase)],
              ['=', 'Gain / Loss', signed(r.gainLoss), true],
            ]} />
            <p className="mt-3 rounded-control px-3 py-2 text-meta text-muted-ink [border:1px_dashed_var(--color-line)]">
              Owner payout = owner base {money(r.ownerBase)} {r.o2 < 0 ? '−' : '+'} O2 {money(Math.abs(r.o2))} = <span className="font-semibold text-ink">{money(r.payout)}</span>.
              O2 is passed to the owner and does not change gain / loss.
            </p>
          </Section>
          <Section title="Nights and unit economics" level={3}>
            <Line label="Nights booked" value={`${r.nights} / ${r.days}`} note={percent(r.occupancy)} />
            <Line label="Revenue per booked night" value={r.nights ? money(r.revPerNight) : '—'} />
            <Line label="Cleaning per booked night" value={r.nights ? money(Math.round(r.cleaning / r.nights)) : '—'} />
            <Line label="Utilities per day" value={money(Math.round(r.utilities / r.days))} note={`all ${r.days} days`} />
            <Line label="Deductions / revenue" value={r.revenue ? percent((r.deductions / r.revenue) * 100) : '—'} />
            <Line label="Break-even revenue" value={money(r.breakEven)} note={lt ? 'deductions + LT' : 'deductions + GRR'} />
          </Section>
          <Section title="Compared with other units" level={3}>
            <p className="mb-1 text-meta text-muted-ink">Against the {plural(peers.length, `${contractName(r.contract).toLowerCase()} unit`)}</p>
            <Line label="Gain / Loss rank" value={`#${rank} of ${peers.length}`} />
            <div className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="text-muted-ink">Occupancy vs average<span className="ml-1.5 text-meta text-faint">{percent(peerTotals.occupancy)}</span></span>
              {delta(r.occupancy, peerTotals.occupancy, `${r.occupancy - peerTotals.occupancy < 0 ? '−' : '+'}${Math.abs(r.occupancy - peerTotals.occupancy).toFixed(1)} pts`)}
            </div>
            <div className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="text-muted-ink">Revenue vs average<span className="ml-1.5 text-meta text-faint">{money(Math.round(avg(peers, x => x.revenue)))}</span></span>
              {delta(r.revenue, avg(peers, x => x.revenue), signed(Math.round(r.revenue - avg(peers, x => x.revenue))))}
            </div>
            <div className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="text-muted-ink">Gain / Loss vs average<span className="ml-1.5 text-meta text-faint">{signed(Math.round(avg(peers, x => x.gainLoss)))}</span></span>
              {delta(r.gainLoss, avg(peers, x => x.gainLoss), signed(Math.round(r.gainLoss - avg(peers, x => x.gainLoss))))}
            </div>
            <Line label="Same building average" note={`${r.building} · ${plural(building.length, 'unit')}`}
              value={signed(Math.round(avg(building, x => x.gainLoss)))} tone={avg(building, x => x.gainLoss) < 0 ? 'text-danger' : 'text-success'} />
          </Section>
        </>}

        {level < 3 && (
          <div className="px-5 pb-5 pt-1">
            <Button variant="secondary" size="sm" className="w-full" onClick={() => onLevel((level + 1) as Level)}>
              Show {level === 1 ? 'breakdown (L2)' : 'full detail (L3)'}
            </Button>
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 px-5 py-3 [border-top:1px_solid_var(--color-line)]">
        <Button variant="secondary" size="sm" icon={<Icon name="ArrowUp" size="sm" />} disabled={position <= 1} onClick={() => onStep(-1)}>Previous</Button>
        <span className="text-meta text-muted-ink tabular-nums">{position} / {total}</span>
        <Button variant="secondary" size="sm" icon={<Icon name="ArrowDown" size="sm" />} disabled={position >= total} onClick={() => onStep(1)}>Next</Button>
      </footer>
    </div>
  );
}

type LedgerRow = [op: string, label: string, value: string, strong?: boolean];
function Ledger({ rows }: { rows: LedgerRow[] }) {
  return (
    <div>
      {rows.map(([op, label, value, strong], i) => (
        <div key={i} className={cx('grid grid-cols-[1.25rem_1fr_auto] items-baseline gap-2 py-1', strong && 'mt-1 pt-2 font-semibold [border-top:1px_solid_var(--color-line)]')}>
          <span className="text-faint">{op}</span>
          <span className={strong ? 'text-ink' : 'text-muted-ink'}>{label}</span>
          <span className="tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  );
}
