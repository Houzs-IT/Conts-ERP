import { type Env, one } from './db';
import { CATEGORIES } from './maintenance';

/**
 * Job cards (HR > Employees > Standard Times): the standard minutes one job should take. Cleaners have Basic and Deep
 * clean; technicians have one card per repair category. Every card is 0 until the office decides its time, and a card
 * at 0 is left out of efficiency. Saved as one settings row, as the maintenance approval rules are.
 */

export const JOB_MINUTES_KEY = 'hr.jobCardMinutes';
export const MAX_JOB_MINUTES = 24 * 60;

export const CLEANING_CARDS = [
  { key: 'turnover', label: 'Basic clean' },
  { key: 'deep_clean', label: 'Deep clean' },
] as const;

const CATEGORY_LABEL: Record<(typeof CATEGORIES)[number], string> = {
  plumbing: 'Plumbing', electrical: 'Electrical', aircon: 'Aircon', furniture: 'Furniture', appliance: 'Appliance', other: 'Other',
};
export const REPAIR_CARDS = CATEGORIES.map(key => ({ key, label: CATEGORY_LABEL[key] }));

export type CleaningCardKey = (typeof CLEANING_CARDS)[number]['key'];
export type RepairCardKey = (typeof CATEGORIES)[number];
export type JobCardKey = CleaningCardKey | RepairCardKey;
export type JobMinutes = Record<JobCardKey, number>;

const CARD_KEYS: readonly JobCardKey[] = [...CLEANING_CARDS.map(c => c.key), ...CATEGORIES];
export const isJobCardKey = (value: string): value is JobCardKey => (CARD_KEYS as readonly string[]).includes(value);
export const isJobMinutes = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_JOB_MINUTES;

function parseSaved(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? { ...parsed } : {};
}

export async function readJobMinutes(env: Env): Promise<JobMinutes> {
  const row = await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key = ?', JOB_MINUTES_KEY);
  const saved = parseSaved(row?.value);
  const minutesFor = (key: JobCardKey): number => {
    const minutes = saved[key];
    return isJobMinutes(minutes) ? minutes : 0;
  };
  return {
    turnover: minutesFor('turnover'), deep_clean: minutesFor('deep_clean'),
    plumbing: minutesFor('plumbing'), electrical: minutesFor('electrical'), aircon: minutesFor('aircon'),
    furniture: minutesFor('furniture'), appliance: minutesFor('appliance'), other: minutesFor('other'),
  };
}
