export interface YgrrMonthShare { month: string; ownerShare: number }

export interface YgrrRow {
  unitId: string; building: string; number: string; owner: string; ownerPct: number;
  annual: number; due: number; yearFrom: string; yearTo: string;
  shares: YgrrMonthShare[];
  topUp: number;
}

export interface YgrrPayload { month: string; months: string[]; rows: YgrrRow[] }

export interface YgrrStanding {
  sharesSoFar: number; monthsCounted: number; monthsInYear: number;
  paceDue: number; aheadBy: number; shortOfYear: number;
}

const monthIndex = (month: string): number => {
  const [year, monthNumber] = month.split('-').map(Number);
  return year * 12 + monthNumber - 1;
};

export const monthsInclusive = (from: string, to: string): number => monthIndex(to) - monthIndex(from) + 1;

export function standingOf({ shares, due, yearFrom, yearTo }: YgrrRow): YgrrStanding {
  const sharesSoFar = shares.reduce((total, { ownerShare }) => total + ownerShare, 0);
  const monthsInYear = monthsInclusive(yearFrom, yearTo);
  const monthsCounted = shares.length;
  const paceDue = Math.round((due * monthsCounted) / monthsInYear);
  return { sharesSoFar, monthsCounted, monthsInYear, paceDue, aheadBy: sharesSoFar - paceDue, shortOfYear: Math.max(0, due - sharesSoFar) };
}
