import { type Env, json, fail, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { cleanerJobs, type CleanerJobsPayload } from '../../_lib/cleanerJobs';
import { technicianJobs, type TechnicianJobsPayload } from '../../_lib/technicianJobs';

export interface EmployeePerformancePayload extends CleanerJobsPayload { repairs: TechnicianJobsPayload }

const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const MAX_DAYS = 366;

/** GET /api/employees/performance?from&to — HR > Employees > Employee Performance: each in-house cleaner's finished
 *  Basic and Deep cleans and each in-house technician's finished repairs in the range (this month by default, at most
 *  a year), against the Standard Times cards. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Employee performance is kept by the office.', 403);
  const today = mytToday();
  const q = new URL(request.url).searchParams;
  const from = isDay(q.get('from')) ? String(q.get('from')) : `${today.slice(0, 7)}-01`;
  const to = isDay(q.get('to')) ? String(q.get('to')) : today;
  if (to < from) return fail('VALIDATION', 'The end date is before the start date.', 422, { to: 'Before the start.' });
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 >= MAX_DAYS) return fail('VALIDATION', 'Pick at most a year.', 422, { to: 'At most a year.' });
  const [cleaners, repairs] = await Promise.all([cleanerJobs(env, from, to), technicianJobs(env, from, to)]);
  const payload: EmployeePerformancePayload = { ...cleaners, repairs };
  return json(payload);
};
