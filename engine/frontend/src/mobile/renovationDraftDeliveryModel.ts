/* Which day filter a Draft delivery job falls under. A draft past its day stays on Today until someone deals with it. */

export type JobDay = "today" | "tomorrow" | "week";
export const JOB_DAYS: ReadonlyArray<{ key: JobDay; label: string }> = [{ key: "today", label: "Today" }, { key: "tomorrow", label: "Tomorrow" }, { key: "week", label: "This week" }];

export interface DraftJob {
  id: string; doNumber: string; due: string | null; time: string | null; place: string; projectCode: string | null; soDocNo: string | null;
  items: Array<{ code: string; description: string; qty: number; uom: string | null }>;
  pos: Array<{ poNumber: string; supplier: string | null }>;
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Today in Malaysia. */
export const todayKl = (now: Date = new Date()): string => new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);

/** The Sunday that ends this week. */
export function weekEnd(today: string): string {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, dow === 0 ? 0 : 7 - dow);
}

export function jobsFor(jobs: readonly DraftJob[], day: JobDay, today: string): DraftJob[] {
  const tomorrow = addDays(today, 1);
  const end = weekEnd(today);
  return jobs.filter((j) => {
    const due = j.due ?? today;
    if (day === "today") return due <= today;
    if (day === "tomorrow") return due === tomorrow;
    return due <= end;
  });
}

export const isLate = (j: DraftJob, today: string): boolean => !!j.due && j.due < today;
