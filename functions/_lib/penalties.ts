import { z } from 'zod';
import { type Env, all, one, run, nowIso, mytToday } from './db';
import { hasColumn } from './auth';
import { employeeIdsFor } from './hr';

/**
 * Worker Penalty (migration 0173), ported from Hookka's worker-penalties: a penalty raised against a cleaning or repair
 * job (Hookka: a production order), shared out to the workers responsible, approved, then taken off each one's payslip
 * for the payroll month it lands on.
 */

export const hasPenalties = (env: Env): Promise<boolean> => hasColumn(env, 'worker_penalties', 'id').catch(() => false);
export const NOT_MIGRATED = 'Worker Penalty needs a database update (migration 0173) that has not been applied yet.';
export const PENALTY_STATUSES = ['draft', 'pending', 'approved', 'posted'] as const;
export type PenaltyStatus = (typeof PENALTY_STATUSES)[number];
export type JobKind = 'cleaning' | 'repair';

export interface PenaltyLine { id: string; employeeId: string; name: string; amountSen: number; payrollPeriod: string | null; posted: boolean }
export interface Penalty {
  id: string; penaltyNo: string; date: string; jobKind: JobKind | null; jobId: string | null; jobRef: string | null;
  reason: string; remarks: string | null; status: PenaltyStatus; rejectedReason: string | null;
  createdBy: string | null; createdById: string | null; submittedAt: string | null; approvedBy: string | null; approvedAt: string | null;
  lines: PenaltyLine[]; totalSen: number;
}

/** What the editor sends. Lines may be empty while it is a draft; submitting needs at least one. */
export const penaltyInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.'),
  jobKind: z.enum(['cleaning', 'repair']).nullable().default(null),
  jobId: z.string().nullable().default(null),
  reason: z.string().trim().min(1, 'Say what happened.').max(300),
  remarks: z.string().trim().max(1000).transform(v => v || null).nullable().default(null),
  lines: z.array(z.object({
    employeeId: z.string().nullable().default(null),
    cleanerId: z.string().nullable().default(null),
    technicianId: z.string().nullable().default(null),
    amountSen: z.int().min(1, 'Enter an amount.').max(10_000_000),
  })).max(50),
}).refine(p => (p.jobKind === null) === (p.jobId === null), { path: ['jobId'], message: 'Pick the job, or clear it.' });
export type PenaltyInput = z.infer<typeof penaltyInput>;

const PERSON_NAME = `COALESCE((SELECT c.full_name FROM cleaners c WHERE c.id = e.cleaner_id), (SELECT t.full_name FROM technicians t WHERE t.id = e.technician_id))`;

/** Every penalty with its lines, newest first. ponytail: no paging; add it when the list passes a few hundred. */
export async function listPenalties(env: Env, id?: string): Promise<Penalty[]> {
  const heads = await all<{ id: string; penalty_no: string; penalty_date: string; job_kind: JobKind | null; job_id: string | null; job_ref: string | null; reason: string; remarks: string | null;
    status: PenaltyStatus; rejected_reason: string | null; created_by: string | null; created_name: string | null; submitted_at: string | null; approved_name: string | null; approved_at: string | null }>(env, `
    SELECT p.id, p.penalty_no, p.penalty_date, p.job_kind, p.job_id, p.job_ref, p.reason, p.remarks, p.status, p.rejected_reason, p.created_by,
           cu.full_name AS created_name, p.submitted_at, au.full_name AS approved_name, p.approved_at
    FROM worker_penalties p LEFT JOIN users cu ON cu.id = p.created_by LEFT JOIN users au ON au.id = p.approved_by
    ${id ? 'WHERE p.id = ?' : ''} ORDER BY p.penalty_date DESC, p.penalty_no DESC`, ...(id ? [id] : []));
  if (!heads.length) return [];
  const lines = await all<{ id: string; penalty_id: string; employee_id: string; name: string | null; amount_sen: number; payroll_period: string | null; posted_at: string | null }>(env, `
    SELECT l.id, l.penalty_id, l.employee_id, ${PERSON_NAME} AS name, l.amount_sen, l.payroll_period, l.posted_at
    FROM worker_penalty_lines l JOIN employees e ON e.id = l.employee_id
    WHERE l.penalty_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) ORDER BY name`, JSON.stringify(heads.map(h => h.id)));
  return heads.map(h => {
    const mine = lines.filter(l => l.penalty_id === h.id).map(l => ({
      id: l.id, employeeId: l.employee_id, name: l.name ?? 'Unknown', amountSen: Number(l.amount_sen), payrollPeriod: l.payroll_period, posted: !!l.posted_at,
    }));
    return {
      id: h.id, penaltyNo: h.penalty_no, date: h.penalty_date, jobKind: h.job_kind, jobId: h.job_id, jobRef: h.job_ref, reason: h.reason, remarks: h.remarks,
      status: h.status, rejectedReason: h.rejected_reason, createdBy: h.created_name, createdById: h.created_by, submittedAt: h.submitted_at,
      approvedBy: h.approved_name, approvedAt: h.approved_at, lines: mine, totalSen: mine.reduce((n, l) => n + l.amountSen, 0),
    };
  });
}

/** The job's unit and title, kept on the penalty as written. Null when the job does not exist. */
async function jobRef(env: Env, kind: JobKind, id: string): Promise<string | null> {
  const r = kind === 'cleaning'
    ? await one<{ unit: string | null; title: string }>(env, `SELECT COALESCE(u.unit_number, t.external_address) AS unit, t.title FROM tasks t LEFT JOIN units u ON u.id = t.unit_id WHERE t.id = ?`, id)
    : await one<{ unit: string | null; title: string }>(env, `SELECT u.unit_number AS unit, m.title FROM maintenance_issues m JOIN units u ON u.id = m.unit_id WHERE m.id = ?`, id);
  return r ? [r.unit, r.title].filter(Boolean).join(' · ') : null;
}

/** Write a draft: the penalty, then its lines replaced in one statement. Returns the penalty id. */
export async function saveDraft(env: Env, p: PenaltyInput, userId: string, id?: string): Promise<string> {
  const ref = p.jobKind && p.jobId ? await jobRef(env, p.jobKind, p.jobId) : null;
  if (p.jobKind && p.jobId && !ref) throw new Error('That job no longer exists.');
  const now = nowIso();
  let penaltyId = id;
  if (penaltyId) {
    await run(env, `UPDATE worker_penalties SET penalty_date = ?, job_kind = ?, job_id = ?, job_ref = ?, reason = ?, remarks = ?, updated_at = ? WHERE id = ? AND status = 'draft'`,
      p.date, p.jobKind, p.jobId, ref, p.reason, p.remarks, now, penaltyId);
  } else {
    penaltyId = crypto.randomUUID();
    const seq = await one<{ n: number }>(env, `SELECT nextval('worker_penalty_no_seq')::int AS n`);
    await run(env, `INSERT INTO worker_penalties (id, penalty_no, penalty_date, job_kind, job_id, job_ref, reason, remarks, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      penaltyId, `WP-${String(seq?.n ?? 0).padStart(4, '0')}`, p.date, p.jobKind, p.jobId, ref, p.reason, p.remarks, userId, now, now);
  }
  const ids = await employeeIdsFor(env, p.lines);
  if (new Set(ids).size !== ids.length) throw new Error('The same worker is on the penalty twice. Put their amount on one line.');
  await run(env, 'DELETE FROM worker_penalty_lines WHERE penalty_id = ?', penaltyId);
  if (ids.length) {
    await run(env, `INSERT INTO worker_penalty_lines (id, penalty_id, employee_id, amount_sen)
      SELECT r.id, ?, r.employee_id, r.amount_sen FROM jsonb_to_recordset(?::text::jsonb) AS r(id text, employee_id text, amount_sen int)`,
      penaltyId, JSON.stringify(ids.map((employeeId, i) => ({ id: crypto.randomUUID(), employee_id: employeeId, amount_sen: p.lines[i].amountSen }))));
  }
  return penaltyId;
}

/** Hookka's rule for the payroll month: the approval month, or the next month (up to a year on) whose payslip for that
 *  person is still open, so an approved month is never changed after the fact. */
export async function placeOnPayroll(env: Env, penaltyId: string): Promise<void> {
  const month = mytToday().slice(0, 7);
  const lines = await all<{ id: string; employee_id: string }>(env, 'SELECT id, employee_id FROM worker_penalty_lines WHERE penalty_id = ?', penaltyId);
  const locked = new Set((await all<{ employee_id: string; period: string }>(env, `
    SELECT employee_id, period FROM payslips WHERE status <> 'draft' AND period >= ?
      AND employee_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, month, JSON.stringify(lines.map(l => l.employee_id)))).map(r => `${r.employee_id}|${r.period}`));
  const next = (p: string): string => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 1)).toISOString().slice(0, 7);
  const placed = lines.map(l => {
    let period = month;
    for (let i = 0; i < 12 && locked.has(`${l.employee_id}|${period}`); i++) period = next(period);
    return { id: l.id, period };
  });
  await run(env, `UPDATE worker_penalty_lines l SET payroll_period = r.period FROM jsonb_to_recordset(?::text::jsonb) AS r(id text, period text) WHERE l.id = r.id`, JSON.stringify(placed));
}

/** The approved penalties on a person's month, in sen, for payroll and its drift check. */
export const PENALTY_SUM_SQL = `
  SELECT l.employee_id, SUM(l.amount_sen)::int AS total FROM worker_penalty_lines l JOIN worker_penalties p ON p.id = l.penalty_id
  WHERE p.status IN ('approved','posted') AND l.payroll_period = ?`;

/** When a payslip is approved its month's penalty lines are posted, and a penalty whose lines are all posted is
 *  "posted". Reopening the payslip undoes both. */
export async function postPenalties(env: Env, payslipId: string, employeeId: string, period: string): Promise<void> {
  await run(env, `UPDATE worker_penalty_lines l SET payslip_id = ?, posted_at = ? FROM worker_penalties p
    WHERE p.id = l.penalty_id AND p.status IN ('approved','posted') AND l.employee_id = ? AND l.payroll_period = ?`, payslipId, nowIso(), employeeId, period);
  await run(env, `UPDATE worker_penalties p SET status = 'posted', updated_at = ? WHERE p.status = 'approved'
    AND NOT EXISTS (SELECT 1 FROM worker_penalty_lines l WHERE l.penalty_id = p.id AND l.posted_at IS NULL)`, nowIso());
}
export async function unpostPenalties(env: Env, payslipId: string): Promise<void> {
  await run(env, `UPDATE worker_penalty_lines SET payslip_id = NULL, posted_at = NULL WHERE payslip_id = ?`, payslipId);
  await run(env, `UPDATE worker_penalties p SET status = 'approved', updated_at = ? WHERE p.status = 'posted'
    AND EXISTS (SELECT 1 FROM worker_penalty_lines l WHERE l.penalty_id = p.id AND l.posted_at IS NULL)`, nowIso());
}

/** Recent cleaning and repair jobs for the editor's job picker, by unit or title, with who did them (Hookka's order
 *  lookup suggests the job card's people). Last 120 days, at most 20. */
const PEOPLE_JSON = z.array(z.object({ id: z.string(), name: z.string() }));
export interface JobOption { kind: JobKind; id: string; ref: string; date: string | null; people: { cleanerId: string | null; technicianId: string | null; name: string }[] }
export async function findJobs(env: Env, q: string): Promise<JobOption[]> {
  const like = `%${q.trim().toLowerCase()}%`;
  const since = new Date(Date.parse(`${mytToday()}T00:00:00Z`) - 120 * 86_400_000).toISOString();
  const [cleans, repairs] = await Promise.all([
    all<{ id: string; unit: string | null; title: string; day: string | null; people: string | null }>(env, `
      SELECT t.id, COALESCE(u.unit_number, t.external_address) AS unit, t.title, substr(COALESCE(t.completed_at, t.scheduled_for, t.created_at), 1, 10) AS day,
             (SELECT json_agg(json_build_object('id', c.id, 'name', c.full_name))::text FROM cleaners c
               WHERE c.employment_type = 'internal' AND (c.id = t.cleaner_id OR c.id IN (SELECT tc.cleaner_id FROM task_cleaners tc WHERE tc.task_id = t.id))) AS people
      FROM tasks t LEFT JOIN units u ON u.id = t.unit_id
      WHERE COALESCE(t.completed_at, t.scheduled_for, t.created_at) >= ? AND (lower(COALESCE(u.unit_number, t.external_address, '')) LIKE ? OR lower(t.title) LIKE ?)
      ORDER BY COALESCE(t.completed_at, t.scheduled_for, t.created_at) DESC LIMIT 20`, since, like, like),
    all<{ id: string; unit: string; title: string; day: string | null; people: string | null }>(env, `
      SELECT m.id, u.unit_number AS unit, m.title, substr(COALESCE(m.resolved_at, m.created_at), 1, 10) AS day,
             (SELECT json_agg(json_build_object('id', t.id, 'name', t.full_name))::text FROM technicians t WHERE t.employment_type = 'internal' AND t.id = m.technician_id) AS people
      FROM maintenance_issues m JOIN units u ON u.id = m.unit_id
      WHERE COALESCE(m.resolved_at, m.created_at) >= ? AND (lower(u.unit_number) LIKE ? OR lower(m.title) LIKE ?)
      ORDER BY COALESCE(m.resolved_at, m.created_at) DESC LIMIT 20`, since, like, like),
  ]);
  const people = (raw: string | null): { id: string; name: string }[] => (raw ? PEOPLE_JSON.parse(JSON.parse(raw)) : []);
  return [
    ...cleans.map(c => ({ kind: 'cleaning' as const, id: c.id, ref: [c.unit, c.title].filter(Boolean).join(' · '), date: c.day, people: people(c.people).map(p => ({ cleanerId: p.id, technicianId: null, name: p.name })) })),
    ...repairs.map(r => ({ kind: 'repair' as const, id: r.id, ref: `${r.unit} · ${r.title}`, date: r.day, people: people(r.people).map(p => ({ cleanerId: null, technicianId: p.id, name: p.name })) })),
  ].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, 20);
}

export type PenaltyAction = 'submit' | 'approve' | 'reject' | 'revoke';
export const isPenaltyAction = (v: string): v is PenaltyAction => v === 'submit' || v === 'approve' || v === 'reject' || v === 'revoke';
const FROM: Record<PenaltyAction, PenaltyStatus> = { submit: 'draft', approve: 'pending', reject: 'pending', revoke: 'approved' };
const DONE: Record<PenaltyAction, string> = { submit: 'submitted', approve: 'approved', reject: 'rejected', revoke: 'revoked' };

/**
 * Hookka's lifecycle. submit: draft -> pending, needs a worker. approve: pending -> approved and placed on payroll; nobody
 * approves a penalty they raised, except management (Hookka: Super Admin). reject: back to draft with the reason.
 * revoke: approved -> draft, only before any line is on an approved payslip. Returns a refusal, or null when done.
 */
export async function movePenalty(env: Env, id: string, action: PenaltyAction, who: { userId: string; role: string }, reason?: string | null): Promise<{ status: number; message: string } | null> {
  const p = await one<{ status: PenaltyStatus; created_by: string | null; lines: number; posted: number }>(env, `
    SELECT p.status, p.created_by, (SELECT COUNT(*)::int FROM worker_penalty_lines l WHERE l.penalty_id = p.id) AS lines,
           (SELECT COUNT(*)::int FROM worker_penalty_lines l WHERE l.penalty_id = p.id AND l.posted_at IS NOT NULL) AS posted
    FROM worker_penalties p WHERE p.id = ?`, id);
  if (!p) return { status: 404, message: 'That penalty no longer exists.' };
  if (p.status !== FROM[action]) return { status: 409, message: `That penalty is ${p.status}; it cannot be ${DONE[action]} from there.` };
  const now = nowIso();
  if (action === 'submit') {
    if (!p.lines) return { status: 422, message: 'Add at least one worker before submitting.' };
    await run(env, `UPDATE worker_penalties SET status = 'pending', submitted_by = ?, submitted_at = ?, rejected_reason = NULL, updated_at = ? WHERE id = ? AND status = 'draft'`, who.userId, now, now, id);
  } else if (action === 'approve') {
    if (p.created_by === who.userId && who.role !== 'management') return { status: 403, message: 'Someone else must approve a penalty you raised.' };
    await run(env, `UPDATE worker_penalties SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`, who.userId, now, now, id);
    await placeOnPayroll(env, id);
  } else if (action === 'reject') {
    if (!reason?.trim()) return { status: 422, message: 'Say why, so whoever raised it knows what to fix.' };
    await run(env, `UPDATE worker_penalties SET status = 'draft', rejected_reason = ?, submitted_at = NULL, updated_at = ? WHERE id = ? AND status = 'pending'`, reason.trim().slice(0, 300), now, id);
  } else {
    if (p.posted) return { status: 409, message: 'Part of this penalty is already on an approved payslip. Reopen that payslip first.' };
    await run(env, `UPDATE worker_penalties SET status = 'draft', approved_by = NULL, approved_at = NULL, submitted_at = NULL, updated_at = ? WHERE id = ? AND status = 'approved'`, now, id);
    await run(env, 'UPDATE worker_penalty_lines SET payroll_period = NULL WHERE penalty_id = ?', id);
  }
  return null;
}
