// Conts only (not part of Houzs's code): the lines of a staff receipt or payment request, made safe (design
// docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md §4.4).
import { lineDepartment } from './petty-cash';
import type { Staff } from './staff-identity';
import { receiptAccountProblem } from './petty-cash-routes';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as in the routes it serves */
export type LineRow = { department: string; unit_id: string | null; maintenance_issue_id: string | null; project_id: number | null; account_code: string | null; amount_sen: number; description: string | null; sort: number };

/** The lines a person sends, made safe: their own department by default, a maintenance job's unit and Rental, and only
 *  jobs they may name. Returns a message when something is wrong. */
export async function buildLines(sb: any, staff: Staff, raw: unknown, amountSen: number, companyId: number): Promise<{ ok: true; lines: LineRow[] } | { ok: false; message: string }> {
  const list = Array.isArray(raw) && raw.length ? (raw as Array<Record<string, unknown>>) : [{ amountSen }];
  if (list.length > 20) return { ok: false, message: 'Twenty lines at most.' };
  const jobIds = [...new Set(list.map(l => l.maintenanceIssueId).filter(Boolean).map(String))];
  const jobs = new Map<string, { unit_id: string; assignee_user_id: string | null; state: string }>();
  if (jobIds.length) {
    const { data } = await sb.schema('public').from('conts_maintenance_jobs').select('id, unit_id, assignee_user_id, state').in('id', jobIds);
    for (const j of (data ?? []) as Array<{ id: string; unit_id: string; assignee_user_id: string | null; state: string }>) jobs.set(String(j.id), j);
  }
  const out: LineRow[] = [];
  for (const [i, l] of list.entries()) {
    const amount = l.amountSen == null && list.length === 1 ? amountSen : Number(l.amountSen);
    if (!(Number.isInteger(amount) && amount > 0)) return { ok: false, message: 'Every line needs an amount.' };
    const jobId = l.maintenanceIssueId ? String(l.maintenanceIssueId) : null;
    const job = jobId ? jobs.get(jobId) : undefined;
    if (jobId && !job) return { ok: false, message: 'That maintenance job was not found.' };
    if (job && staff.field && (job.assignee_user_id !== staff.userId || job.state === 'resolved')) return { ok: false, message: 'Put the receipt on one of your own open jobs.' };
    const dept = job ? 'rental' : ['rental', 'supply', 'shared'].includes(String(l.department)) ? String(l.department) : lineDepartment(staff.side);
    const project = l.projectId == null || l.projectId === '' ? null : Number(l.projectId);
    if (project != null && !(Number.isInteger(project) && project > 0)) return { ok: false, message: 'Pick the project again.' };
    out.push({
      department: dept, unit_id: job ? job.unit_id : l.unitId ? String(l.unitId) : null, maintenance_issue_id: jobId, project_id: project,
      /* Field staff choose no account: finance sets it while checking. */
      account_code: !staff.field && l.accountCode ? String(l.accountCode).trim() : null,
      amount_sen: amount, description: l.description ? String(l.description).slice(0, 300) : null, sort: i,
    });
  }
  if (out.reduce((n, l) => n + l.amount_sen, 0) !== amountSen) return { ok: false, message: 'The lines must add up to the amount.' };
  /* A project must be one of the company's; an account must be one a cost can go to (never money or a control). */
  const projectIds = [...new Set(out.map(l => l.project_id).filter((p): p is number => p != null))];
  if (projectIds.length) {
    const { data, error } = await sb.schema('public').from('projects').select('id').eq('company_id', companyId).in('id', projectIds);
    if (error) return { ok: false, message: 'The projects could not be read. Try again.' };
    const found = new Set(((data ?? []) as Array<{ id: number }>).map(p => Number(p.id)));
    if (projectIds.some(p => !found.has(p))) return { ok: false, message: 'Pick the project again.' };
  }
  const bad = await receiptAccountProblem(sb, companyId, out.map(l => l.account_code).filter((a): a is string => !!a));
  if (bad) return { ok: false, message: bad };
  return { ok: true, lines: out };
}

