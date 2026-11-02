/** A utility bill whose printed period crosses a contract's start or end is split by days (finance, chew 28 Oct 2026;
 *  FINANCE-SOP §3.10; plan docs/superpowers/plans/2026-11-02-utility-bill-scan.md). Days before the contract starts, or
 *  after it ends, are the owner's alone, taken after the split; the days inside follow the contract as any bill does.
 *  Days count both ends of the printed period. The owner-alone part is rounded to the sen; the shared part is the rest. */
export type SplitContract = { startsOn: string; endsOn: string | null; ownerId: string };
export type ContractSplit =
  | { kind: 'none' }
  | { kind: 'two-contracts' }
  | { kind: 'split'; ownerId: string; insideSen: number; outsideSen: number; insideDays: number; outsideDays: number; totalDays: number };

const DAY = 864e5;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Days from `from` to `to`, both included. */
export const daysBetween = (from: string, to: string): number => Math.round((t(to) - t(from)) / DAY) + 1;

export function contractSplit(period: { from: string | null; to: string | null }, amountSen: number, contracts: SplitContract[]): ContractSplit {
  const { from, to } = period;
  if (!from || !to || !ISO.test(from) || !ISO.test(to) || t(to) < t(from)) return { kind: 'none' };
  /* The contracts that touch the period, or begin after it ends (a bill wholly before the contract starts). */
  const touching = contracts.filter(c => t(c.startsOn) <= t(to) && (!c.endsOn || t(c.endsOn) >= t(from)));
  if (touching.length > 1) return { kind: 'two-contracts' };
  const c = touching[0] ?? contracts.filter(x => t(x.startsOn) > t(to)).sort((a, b) => t(a.startsOn) - t(b.startsOn))[0];
  if (!c) return { kind: 'none' };
  const totalDays = daysBetween(from, to);
  const inFrom = Math.max(t(from), t(c.startsOn));
  const inTo = Math.min(t(to), c.endsOn ? t(c.endsOn) : t(to));
  const insideDays = inTo < inFrom ? 0 : Math.round((inTo - inFrom) / DAY) + 1;
  if (insideDays === totalDays) return { kind: 'none' };
  const outsideDays = totalDays - insideDays;
  const outsideSen = Math.round((amountSen * outsideDays) / totalDays);
  return { kind: 'split', ownerId: c.ownerId, insideSen: amountSen - outsideSen, outsideSen, insideDays, outsideDays, totalDays };
}
