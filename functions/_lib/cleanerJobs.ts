import { type Env, all } from './db';
import { MYT_DATE } from './ops';

/**
 * Employee Performance for cleaners (HR > Employees > Employee Performance): Hookka's job cards, as The Conts' two
 * cleaning jobs. Each finished Basic clean (turnover) and Deep clean counts once for every in-house cleaner on it, in
 * the range by the day it was finished (as Labor Cost's revenue rows). Production minutes are the count times the
 * job's standard minutes; efficiency is production minutes against clocked hours, not worked out while minutes are 0.
 */

// shortcut: standard minutes are 0 until the office decides how long each job takes; move to a setting once they do.
export const JOB_CARDS = [
  { kind: 'turnover', label: 'Basic clean', minutes: 0 },
  { kind: 'deep_clean', label: 'Deep clean', minutes: 0 },
] as const;
export type JobCardKind = (typeof JOB_CARDS)[number]['kind'];

export interface JobCard { kind: JobCardKind; label: string; minutes: number; done: number }
export interface CleanerJobs { cleanerId: string; name: string; basic: number; deep: number; productionMinutes: number }
export interface CleanerJobsPayload { from: string; to: string; cards: JobCard[]; people: CleanerJobs[] }

const minutesOf = (kind: JobCardKind): number => JOB_CARDS.find(c => c.kind === kind)?.minutes ?? 0;

/** Every active in-house cleaner (and any switched off who still finished a job in the range), with their counts. */
export async function cleanerJobs(env: Env, from: string, to: string): Promise<CleanerJobsPayload> {
  const rows = await all<{ id: string; full_name: string; basic: number; deep: number }>(env, `
    SELECT c.id, c.full_name,
           count(t.id) FILTER (WHERE t.kind = 'turnover')::int AS basic,
           count(t.id) FILTER (WHERE t.kind = 'deep_clean')::int AS deep
    FROM cleaners c
    LEFT JOIN tasks t ON t.kind IN ('turnover','deep_clean') AND t.state = 'resolved' AND t.completed_at IS NOT NULL
      AND ${MYT_DATE('t.completed_at')} BETWEEN ? AND ?
      AND (t.cleaner_id = c.id OR (c.user_id IS NOT NULL AND t.assignee_id = c.user_id)
           OR EXISTS (SELECT 1 FROM task_cleaners tc WHERE tc.task_id = t.id AND (tc.cleaner_id = c.id OR (c.user_id IS NOT NULL AND tc.user_id = c.user_id))))
    WHERE c.employment_type = 'internal'
    GROUP BY c.id, c.full_name, c.is_active
    HAVING c.is_active > 0 OR count(t.id) > 0
    ORDER BY c.full_name`, from, to);
  const people: CleanerJobs[] = rows.map(({ id, full_name, basic, deep }) => ({
    cleanerId: id, name: full_name, basic: Number(basic), deep: Number(deep),
    productionMinutes: Number(basic) * minutesOf('turnover') + Number(deep) * minutesOf('deep_clean'),
  }));
  const cards: JobCard[] = JOB_CARDS.map(({ kind, label, minutes }) => ({
    kind, label, minutes, done: people.reduce((n, p) => n + (kind === 'turnover' ? p.basic : p.deep), 0),
  }));
  return { from, to, cards, people };
}
