import { type Env, all, json, fail, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasEmployees, listEmployees } from '../../_lib/hr';
import type { Employee } from '../../_lib/hrFields';
import { computePay, type PayFigures, type PayRules } from '../../_lib/payrollCalc';
import { hasPayroll, NOT_MIGRATED, isPeriod, throughDay, periodEnded, onPayroll, monthInputs, payslipsFor, readPayRules, type PayslipView } from '../../_lib/payroll';

export interface PayrollLine {
  employee: Pick<Employee, 'id' | 'name' | 'employeeId' | 'cleanerId' | 'technicianId' | 'payBasis' | 'paymentMethod' | 'bankName'>;
  /** The stored slip, once the month has been run. */
  payslip: PayslipView | null;
  /** What the month comes to now, before a slip is made (or since the draft was made). */
  estimate: PayFigures | null;
}
export interface AdvanceView { id: string; employeeId: string; name: string; date: string; amountSen: number; note: string | null; status: 'unsettled' | 'settled' }
export interface PayrollPayload { period: string; today: string; ended: boolean; rules: PayRules; lines: PayrollLine[]; advances: AdvanceView[] }

/** GET /api/payroll?period=YYYY-MM — HR > Workers > Payroll: each person on the month's payroll with their slip (or what
 *  it would come to now), the month's advances and the pay rules. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Payroll is kept by the office.', 403);
  if (!(await hasEmployees(env)) || !(await hasPayroll(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);

  const today = mytToday();
  const asked = new URL(request.url).searchParams.get('period');
  const period = isPeriod(asked) ? asked : today.slice(0, 7);
  const through = throughDay(period, today);
  const people = (await listEmployees(env)).filter(e => onPayroll(e, period));
  const [slips, inputs, rules, advances] = await Promise.all([
    payslipsFor(env, period),
    through ? monthInputs(env, people, period, through) : Promise.resolve(new Map()),
    readPayRules(env),
    all<{ id: string; employee_id: string; advance_date: string; amount_sen: number; note: string | null; status: 'unsettled' | 'settled'; name: string }>(env, `
      SELECT a.id, a.employee_id, a.advance_date, a.amount_sen, a.note, a.status, COALESCE(c.full_name, t.full_name) AS name
      FROM employee_advances a JOIN employees e ON e.id = a.employee_id
      LEFT JOIN cleaners c ON c.id = e.cleaner_id LEFT JOIN technicians t ON t.id = e.technician_id
      WHERE a.advance_date LIKE ? ORDER BY a.advance_date, name`, `${period}-%`),
  ]);
  const slipBy = new Map(slips.map(s => [s.employeeId, s]));

  const lines: PayrollLine[] = people.map(e => {
    const input = e.id ? inputs.get(e.id) : undefined;
    return {
      employee: { id: e.id, name: e.name, employeeId: e.employeeId, cleanerId: e.cleanerId, technicianId: e.technicianId, payBasis: e.payBasis, paymentMethod: e.paymentMethod, bankName: e.bankName },
      payslip: (e.id && slipBy.get(e.id)) || null,
      estimate: input ? computePay(input) : null,
    };
  });
  const payload: PayrollPayload = {
    period, today, ended: periodEnded(period, today), rules, lines,
    advances: advances.map(a => ({ id: a.id, employeeId: a.employee_id, name: a.name, date: a.advance_date, amountSen: Number(a.amount_sen), note: a.note, status: a.status })),
  };
  return json(payload);
};
