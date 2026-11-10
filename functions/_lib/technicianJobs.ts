import { type Env, all } from './db';
import { MYT_DATE } from './ops';
import { CATEGORIES, hasTechnicianList } from './maintenance';
import { notTestTechnician } from './hr';
import { REPAIR_CARDS, readJobMinutes, type RepairCardKey } from './jobCards';
import { minutesBetween, totalJobs, type JobTotals } from './jobEfficiency';

/**
 * Employee Performance for technicians: each repair an in-house technician finished in the range, by the day it was
 * resolved (as Labor Cost's revenue rows), against its category's card minutes (HR > Employees > Standard Times).
 * The time taken is Start to Done on the job. A restarted job keeps only its last start, so only that stretch counts.
 */

export interface RepairCard { category: RepairCardKey; label: string; minutes: number; done: number }
export interface TechnicianJobs extends JobTotals { technicianId: string; name: string }
export interface RepairJob {
  id: string; day: string; technicianId: string; technician: string; unit: string; title: string; category: RepairCardKey;
  cardMinutes: number; actualMinutes: number | null;
}
export interface TechnicianJobsPayload { ready: boolean; cards: RepairCard[]; people: TechnicianJobs[]; jobs: RepairJob[] }

interface TechnicianJobRow {
  technician_id: string; full_name: string; job_id: string | null; day: string | null; unit: string | null;
  title: string | null; category: string | null; started_at: string | null; ended_at: string | null;
}

const repairCategory = (category: string | null): RepairCardKey =>
  CATEGORIES.find(known => known === category) ?? 'other';

/** Every active in-house technician (and any switched off who still finished a repair in the range), with their jobs. */
export async function technicianJobs(env: Env, from: string, to: string): Promise<TechnicianJobsPayload> {
  if (!(await hasTechnicianList(env))) return { ready: false, cards: [], people: [], jobs: [] };
  const [rows, minutes] = await Promise.all([all<TechnicianJobRow>(env, `
    SELECT tech.id AS technician_id, tech.full_name, m.id AS job_id, ${MYT_DATE('m.resolved_at')} AS day,
           u.unit_number AS unit, m.title, m.category, m.started_at, m.ended_at
    FROM technicians tech
    LEFT JOIN maintenance_issues m ON m.technician_id = tech.id AND m.state = 'resolved' AND m.resolved_at IS NOT NULL
      AND ${MYT_DATE('m.resolved_at')} BETWEEN ? AND ?
    LEFT JOIN units u ON u.id = m.unit_id
    WHERE tech.employment_type = 'internal' AND (tech.is_active > 0 OR m.id IS NOT NULL) AND ${notTestTechnician('tech')}
    ORDER BY tech.full_name, tech.id, day, m.id`, from, to), readJobMinutes(env)]);

  const jobs: RepairJob[] = rows.flatMap(row => {
    if (!row.job_id) return [];
    const category = repairCategory(row.category);
    return [{
      id: row.job_id, day: row.day ?? '', technicianId: row.technician_id, technician: row.full_name, unit: row.unit ?? '', title: row.title ?? '', category,
      cardMinutes: minutes[category], actualMinutes: minutesBetween(row.started_at, row.ended_at),
    }];
  });
  const names = new Map(rows.map(row => [row.technician_id, row.full_name]));
  const people: TechnicianJobs[] = [...names].map(([technicianId, name]) => ({
    technicianId, name,
    ...totalJobs(jobs.filter(job => job.technicianId === technicianId)),
  }));
  const cards: RepairCard[] = REPAIR_CARDS.map(({ key, label }) => ({
    category: key, label, minutes: minutes[key], done: jobs.filter(job => job.category === key).length,
  }));
  return { ready: true, cards, people, jobs };
}
