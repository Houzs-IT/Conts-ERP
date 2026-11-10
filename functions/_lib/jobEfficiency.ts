/** Whole minutes from one stamp to another, or null when either is missing, unreadable, or the end is before the start. */
export function minutesBetween(startedAt: string | null, endedAt: string | null): number | null {
  if (!startedAt || !endedAt) return null;
  const elapsedMilliseconds = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(elapsedMilliseconds) && elapsedMilliseconds >= 0 ? Math.round(elapsedMilliseconds / 60_000) : null;
}

export interface TimedJob { cardMinutes: number; actualMinutes: number | null }

/** One person's jobs added up. Only jobs with both a start and a finish and a card above 0 count towards efficiency
 *  and early/late, so a missing stamp or an undecided card never drags the figure. */
export interface JobTotals {
  jobs: number;
  cardMinutes: number;
  actualMinutes: number;
  untimedJobs: number;
  efficiencyPercent: number | null;
  minutesOverCard: number | null;
}

export function totalJobs(jobs: TimedJob[]): JobTotals {
  const timed = jobs.filter((job): job is { cardMinutes: number; actualMinutes: number } => job.actualMinutes !== null);
  const compared = timed.filter(job => job.cardMinutes > 0);
  const comparedCard = compared.reduce((sum, job) => sum + job.cardMinutes, 0);
  const comparedActual = compared.reduce((sum, job) => sum + job.actualMinutes, 0);
  return {
    jobs: jobs.length,
    cardMinutes: jobs.reduce((sum, job) => sum + job.cardMinutes, 0),
    actualMinutes: timed.reduce((sum, job) => sum + job.actualMinutes, 0),
    untimedJobs: jobs.length - timed.length,
    efficiencyPercent: comparedCard > 0 && comparedActual > 0 ? Math.round((comparedCard / comparedActual) * 100) : null,
    minutesOverCard: compared.length ? comparedActual - comparedCard : null,
  };
}
