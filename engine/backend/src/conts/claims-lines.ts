// Conts only (not part of Houzs's code): the lines of a staff receipt or payment request, made safe (design
// docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md §4.4).
import { lineDepartment } from './petty-cash';
import type { Staff } from './staff-identity';
import { receiptAccountProblem } from './petty-cash-routes';
import { defaultSubDepartment, loadSubDepartments, projectRenoKind, projectSide, RENO_KIND_OF, subForStaffDepartment } from './sub-departments';
import { isDepartment } from '../acc/rules';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as in the routes it serves */
export type LineRow = { department: string; unit_id: string | null; maintenance_issue_id: string | null; project_id: number | null; account_code: string | null; amount_sen: number; description: string | null; sort: number; sub_department_id?: string | null };

/** The sub-department each line starts on (SOP 1.1; chew 4 Nov 2026): a maintenance job's line Maintenance; else the
    float's department's when the receipt is paid from one, with or without a unit; else the person's own department's.
    A staff department nobody mapped falls back to the line's department's built-in row. Finance changes it while
    checking. Never refuses: with no list (not set up yet) the lines stay as they were. */
export async function defaultLineSubs(sb: any, companyId: number, lines: LineRow[], from: { staffDepartmentId: string | null; floatId: string | null }): Promise<void> {
  const loaded = await loadSubDepartments(sb, companyId);
  if (!loaded.ok || loaded.list.length === 0) return;
  let floatDept: string | null = null;
  if (from.floatId) {
    const { data } = await sb.from('petty_cash_floats').select('department_id').eq('company_id', companyId).eq('id', from.floatId).maybeSingle();
    floatDept = (data as { department_id?: string } | null)?.department_id ?? null;
  }
  let maintenanceDept: string | null = null;
  if (lines.some((l) => l.maintenance_issue_id)) {
    const { data } = await sb.schema('public').from('conts_departments').select('id').eq('kind', 'maintenance').limit(1);
    maintenanceDept = ((data ?? []) as Array<{ id: unknown }>)[0]?.id != null ? String((data as Array<{ id: unknown }>)[0]!.id) : null;
  }
  /* A line naming a project starts on the project's side and brand (SOP 1.1): the person's or float's own
     sub-department only when it fits, else the brand's (Renovation) or Rental (general). */
  const projectIds = [...new Set(lines.map((l) => l.project_id).filter((p): p is number => p != null))];
  const projects = new Map<number, { funding: string | null; internal_department: string | null }>();
  if (projectIds.length) {
    const { data } = await sb.schema('public').from('projects').select('id, funding, internal_department').eq('company_id', companyId).in('id', projectIds);
    for (const p of (data ?? []) as Array<{ id: number; funding: string | null; internal_department: string | null }>) projects.set(Number(p.id), p);
  }
  const kinds = projectIds.length ? await projectRenoKind(sb, companyId, projectIds) : new Map();
  for (const l of lines) {
    const fallback = isDepartment(l.department) ? l.department : 'shared';
    try {
      let s = subForStaffDepartment(loaded.list, l.maintenance_issue_id ? maintenanceDept : floatDept ?? from.staffDepartmentId, l.maintenance_issue_id ? 'rental' : fallback);
      const p = l.project_id != null ? projects.get(Number(l.project_id)) : undefined;
      if (p) {
        const side = projectSide(p);
        const kind = kinds.get(Number(l.project_id));
        const brandOk = side !== 'supply' || !s.fixedKey || !RENO_KIND_OF[s.fixedKey] || RENO_KIND_OF[s.fixedKey] === kind;
        if (s.department !== side || !brandOk || (side === 'supply' && !(s.fixedKey && RENO_KIND_OF[s.fixedKey]))) {
          s = side === 'supply'
            ? loaded.list.find((x) => x.fixedKey === (kind === 'INHOUSE_RENOVATION' ? 'theconts' : 'dreamcrafter')) ?? defaultSubDepartment(loaded.list, 'supply')
            : defaultSubDepartment(loaded.list, 'rental');
        }
      }
      l.sub_department_id = s.id;
      l.department = s.department;
    } catch { /* a list without its built-in rows: leave the line as it was */ }
  }
}

/** The lines a person sends, made safe: their own department, a maintenance job's unit and Rental, no account, and only
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
    /* The person's department, whatever is sent (chew, 2 Nov 2026: the department follows the user); a job is Rental.
       Finance corrects it while checking when a cost belongs elsewhere. */
    const dept = job ? 'rental' : lineDepartment(staff.side);
    const project = l.projectId == null || l.projectId === '' ? null : Number(l.projectId);
    if (project != null && !(Number.isInteger(project) && project > 0)) return { ok: false, message: 'Pick the project again.' };
    out.push({
      department: dept, unit_id: job ? job.unit_id : l.unitId ? String(l.unitId) : null, maintenance_issue_id: jobId, project_id: project,
      /* Nobody who hands in chooses the account (chew, 2 Nov 2026): finance sets it while checking. */
      account_code: null,
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

