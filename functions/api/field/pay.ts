import { type Env, all, json, fail, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { companyDetails, type Company } from '../../_lib/letterhead';
import { hasEmployees, employeeForUser } from '../../_lib/hr';
import { computePay, type PayFigures } from '../../_lib/payrollCalc';
import { hasPayroll, NOT_MIGRATED, isPeriod, throughDay, monthInputs, payslipsFor, type PayslipView } from '../../_lib/payroll';

export interface FieldPayPayload {
  name: string; employeeId: string | null; month: string; today: string; company: Company;
  /** Months with an approved or paid slip, newest first, plus this month. */
  months: string[];
  /** The office's approved or paid slip for the month, when there is one. */
  payslip: PayslipView | null;
  /** Otherwise what the month comes to so far: an estimate, not a payslip. */
  estimate: PayFigures | null;
}

/** GET /api/field/pay?month=YYYY-MM — the signed-in person's pay: an approved or paid slip, or an estimate of the month
 *  so far from their punches and leave. A draft the office is still checking is never shown as a payslip. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await hasEmployees(env)) || !(await hasPayroll(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const me = await employeeForUser(env, session.userId);
  if (!me) return fail('FORBIDDEN', 'Pay is for the company\'s own cleaners and technicians.', 403);

  const today = mytToday();
  const asked = new URL(request.url).searchParams.get('month');
  const month = isPeriod(asked) ? asked : today.slice(0, 7);
  const closed = me.id
    ? (await all<{ period: string }>(env, `SELECT period FROM payslips WHERE employee_id = ? AND status IN ('approved','paid') ORDER BY period DESC LIMIT 24`, me.id)).map(r => r.period)
    : [];
  const months = [...new Set([today.slice(0, 7), ...closed])].sort().reverse();

  const slip = me.id ? (await payslipsFor(env, month, me.id)).find(s => s.status !== 'draft') ?? null : null;
  let estimate: PayFigures | null = null;
  const through = throughDay(month, today);
  if (!slip && me.id && through) {
    const input = (await monthInputs(env, [me], month, through)).get(me.id);
    if (input) estimate = computePay(input);
  }
  const payload: FieldPayPayload = { name: me.name, employeeId: me.employeeId, month, today, company: await companyDetails(env), months, payslip: slip, estimate };
  return json(payload);
};
