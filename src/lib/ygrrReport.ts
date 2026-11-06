export interface YgrrMonthShare { month: string; ownerShare: number }

export interface YgrrRow {
  unitId: string; building: string; number: string; owner: string; ownerPct: number;
  annual: number; due: number; yearFrom: string; yearTo: string;
  shares: YgrrMonthShare[];
  topUp: number;
}

export interface YgrrPayload { month: string; months: string[]; rows: YgrrRow[] }

export interface YgrrStanding {
  sharesSoFar: number; monthsCounted: number; monthsInYear: number; guaranteedPerMonth: number;
  paceDue: number; aheadBy: number; shortOfYear: number;
}

export interface YgrrMonthCell { month: string; ownerShare: number; overTargetSoFar: number }

const monthIndex = (month: string): number => {
  const [year, monthNumber] = month.split('-').map(Number);
  return year * 12 + monthNumber - 1;
};

export const monthsInclusive = (from: string, to: string): number => monthIndex(to) - monthIndex(from) + 1;

export function standingOf({ shares, due, yearFrom, yearTo }: YgrrRow): YgrrStanding {
  const sharesSoFar = shares.reduce((total, { ownerShare }) => total + ownerShare, 0);
  const monthsInYear = monthsInclusive(yearFrom, yearTo);
  const monthsCounted = shares.length;
  const guaranteedPerMonth = Math.round(due / monthsInYear);
  const paceDue = guaranteedPerMonth * monthsCounted;
  return {
    sharesSoFar, monthsCounted, monthsInYear, guaranteedPerMonth,
    paceDue, aheadBy: sharesSoFar - paceDue, shortOfYear: Math.max(0, due - sharesSoFar),
  };
}

export function monthCellsOf(row: YgrrRow): YgrrMonthCell[] {
  const { guaranteedPerMonth } = standingOf(row);
  let overTargetSoFar = 0;
  return row.shares.map(({ month, ownerShare }) => {
    overTargetSoFar += ownerShare - guaranteedPerMonth;
    return { month, ownerShare, overTargetSoFar };
  });
}
