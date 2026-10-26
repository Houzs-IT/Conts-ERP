import { z } from 'zod';
import { mayRun } from '../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { findEmployee, ensureEmployeeId } from '../../_lib/hr';
import { hasPayroll, NOT_MIGRATED } from '../../_lib/payroll';

const MANAGE = ['management']; // everyone else needs Full on HR (functions/_lib/access.ts)
const advance = z.object({
  cleanerId: z.string().nullable().default(null),
  technicianId: z.string().nullable().default(null),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.'),
  amountSen: z.int().min(1, 'Enter an amount.').max(10_000_000),
  note: z.string().trim().max(200).transform(v => v || null).nullable().default(null),
});

/** POST /api/payroll/advances { cleanerId | technicianId, date, amountSen, note? } — money paid out ahead of payday.
 *  The payslip of the advance's own month takes it back in full (Hookka: no carry-forward; re-date it to move it). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayRun(session, MANAGE)) return fail('FORBIDDEN', 'Advances need Full access to HR.', 403);
  if (!(await hasPayroll(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const parsed = advance.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail('VALIDATION', 'Some fields need a fix.', 422, Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0] ?? 'form'), i.message])));
  }
  const a = parsed.data;
  const person = await findEmployee(env, a);
  if (!person) return fail('NOT_FOUND', 'That person is not an in-house cleaner or technician.', 404);
  const employeeId = await ensureEmployeeId(env, person);
  const locked = await one<{ status: string }>(env, `SELECT status FROM payslips WHERE employee_id = ? AND period = ? AND status <> 'draft'`, employeeId, a.date.slice(0, 7));
  if (locked) return fail('CONFLICT', `${person.name}'s payslip for ${a.date.slice(0, 7)} is already ${locked.status}. Date the advance in an open month.`, 409, { date: 'That month is closed.' });

  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `INSERT INTO employee_advances (id, employee_id, advance_date, amount_sen, note, entered_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, employeeId, a.date, a.amountSen, a.note, session.userId, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'payroll.advance', entityTable: 'employee_advances', entityId: id, after: { name: person.name, date: a.date, amountSen: a.amountSen, note: a.note } });
  return json({ id }, 201);
};
