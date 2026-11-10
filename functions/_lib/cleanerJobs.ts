import { type Env, all } from './db';
import { MYT_DATE } from './ops';
import { CLEANING_CARDS, readJobMinutes, type CleaningCardKey } from './jobCards';
import { minutesBetween, totalJobs, type JobTotals } from './jobEfficiency';

/**
 * Employee Performance for cleaners (HR > Employees > Employee Performance): Hookka's job cards, as The Conts' two
 * cleaning jobs. Each finished Basic clean (turnover) and Deep clean counts once for every in-house cleaner on it, in
 * the range by the day it was finished (as Labor Cost's revenue rows). Production minutes are the count times the
 * card's standard minutes (HR > Employees > Standard Times); efficiency is those minutes against the time from Start
 * to Done on the jobs that have both.
 */

export interface JobCard { kind: CleaningCardKey; label: string; minutes: number; done: number }
export interface CleanerJobs extends JobTotals { cleanerId: string; name: string; basic: number; deep: number }
export interface CleanerJobsPayload { from: string; to: string; cards: JobCard[]; people: CleanerJobs[] }

interface CleanerJobRow { id: string; full_name: string; kind: CleaningCardKey | null; started_at: string | null; completed_at: string | null }

/** Every active in-house cleaner (and any switched off who still finished a job in the range), with their jobs. */
export async function cleanerJobs(env: Env, from: string, to: string): Promise<CleanerJobsPayload> {
  const [rows, minutes] = await Promise.all([all<CleanerJobRow>(env, `
    SELECT c.id, c.full_name, t.kind, t.started_at, t.completed_at
    FROM cleaners c
    LEFT JOIN tasks t ON t.kind IN ('turnover','deep_clean') AND t.state = 'resolved' AND t.completed_at IS NOT NULL
      AND ${MYT_DATE('t.completed_at')} BETWEEN ? AND ?
      AND (t.cleaner_id = c.id OR (c.user_id IS NOT NULL AND t.assignee_id = c.user_id)
           OR EXISTS (SELECT 1 FROM task_cleaners tc WHERE tc.task_id = t.id AND (tc.cleaner_id = c.id OR (c.user_id IS NOT NULL AND tc.user_id = c.user_id))))
    WHERE c.employment_type = 'internal' AND (c.is_active > 0 OR t.id IS NOT NULL)
    ORDER BY c.full_name, c.id`, from, to), readJobMinutes(env)]);

  const byCleaner = new Map<string, { name: string; jobs: CleanerJobRow[] }>();
  for (const row of rows) {
    const entry = byCleaner.get(row.id) ?? { name: row.full_name, jobs: [] };
    if (row.kind) entry.jobs.push(row);
    byCleaner.set(row.id, entry);
  }
  const people: CleanerJobs[] = [...byCleaner].map(([cleanerId, { name, jobs }]) => ({
    cleanerId, name,
    basic: jobs.filter(job => job.kind === 'turnover').length,
    deep: jobs.filter(job => job.kind === 'deep_clean').length,
    ...totalJobs(jobs.map(job => ({
      cardMinutes: job.kind ? minutes[job.kind] : 0,
      actualMinutes: minutesBetween(job.started_at, job.completed_at),
    }))),
  }));
  const cards: JobCard[] = CLEANING_CARDS.map(({ key, label }) => ({
    kind: key, label, minutes: minutes[key],
    done: people.reduce((sum, person) => sum + (key === 'turnover' ? person.basic : person.deep), 0),
  }));
  return { from, to, cards, people };
}
