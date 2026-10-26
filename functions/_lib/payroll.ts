import { type Env, all, one, run, nowIso, mytToday } from './db';
import { hasColumn } from './auth';
import { listEmployees, ensureEmployeeId } from './hr';
import type { Employee } from './hrFields';
import { hasLeaves, readHolidays } from './leave';
import type { LeaveType } from './leaveRules';
import { workedMinutes } from './attendanceCalc';
import type { PcbStatus } from './pcb';
import { computePay, parsePayRules, type PayFigures, type PayInput, type PayRules, type PunchDay, type ApprovedLeave } from './payrollCalc';

/** Payroll on the database (migration 0165, PLAN-hr-employees.md phase 4). The arithmetic is in payrollCalc.ts. */

export const hasPayroll = (env: Env): Promise<boolean> => hasColumn(env, 'payslips', 'id').catch(() => false);
export const NOT_MIGRATED = 'Payroll needs a database update (migration 0165) that has not been applied yet.';
export const RULES_KEY = 'hr.pay_rules';
export const isPeriod = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export async function readPayRules(env: Env): Promise<PayRules> {
  const row = await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key = ?', RULES_KEY);
  return parsePayRules(row?.value);
}

/** Minutes since midnight, Malaysia time (UTC+8 all year), for the shift rules. */
const mytMinute = (iso: string): number => Math.floor(Date.parse(iso) / 60_000 + 8 * 60) % (24 * 60);

const lastDay = (period: string): string =>
  `${period}-${String(new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
/** The day a period is counted to: its last day, or today while it is running. Null for a month not started. */
export function throughDay(period: string, today = mytToday()): string | null {
  if (`${period}-01` > today) return null;
  const end = lastDay(period);
  return end < today ? end : today;
}
export const periodEnded = (period: string, today = mytToday()): boolean => lastDay(period) < today;

/** Who is on a month's payroll: active people, and anyone who resigned during or after it. */
export const onPayroll = (e: Employee, period: string): boolean =>
  e.isActive && e.status === 'active' ? true : e.status === 'resigned' && !!e.resignedAt && e.resignedAt >= `${period}-01`;

/**
 * Everything one month's pay needs, for every person at once (one query per kind, whatever the head count): punches,
 * approved leave, the month's advances, the salary in force on the last day, and the year so far from approved and paid
 * slips (PCB's X, Y and K).
 */
export async function monthInputs(env: Env, people: Employee[], period: string, through: string): Promise<Map<string, PayInput>> {
  const ids = people.map(p => p.id).filter((x): x is string => !!x);
  const out = new Map<string, PayInput>();
  if (!ids.length) return out;
  const idList = JSON.stringify(ids);
  const inIds = `employee_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`;
  const start = `${period}-01`, end = lastDay(period);
  const today = mytToday();
  const [rules, holidays, punches, leaves, advances, ytd, salaries] = await Promise.all([
    readPayRules(env),
    readHolidays(env),
    all<{ employee_id: string; work_date: string; clock_in_at: string; clock_out_at: string | null; forgot_out: number }>(env,
      `SELECT employee_id, work_date, clock_in_at, clock_out_at, forgot_out FROM attendance WHERE ${inIds} AND work_date BETWEEN ? AND ?`, idList, start, end),
    hasLeaves(env).then(ok => ok ? all<{ employee_id: string; type: LeaveType; start_date: string; end_date: string }>(env,
      `SELECT employee_id, type, start_date, end_date FROM leaves WHERE ${inIds} AND status = 'approved' AND start_date <= ? AND end_date >= ?`, idList, end, start) : []),
    all<{ employee_id: string; total: number }>(env,
      `SELECT employee_id, SUM(amount_sen)::int AS total FROM employee_advances WHERE ${inIds} AND advance_date BETWEEN ? AND ? GROUP BY employee_id`, idList, start, end),
    all<{ employee_id: string; gross: number; epf: number; pcb: number }>(env, `
      SELECT employee_id, SUM(gross_sen)::int AS gross, SUM(epf_employee_sen)::int AS epf, SUM(pcb_sen)::int AS pcb FROM payslips
      WHERE ${inIds} AND status IN ('approved','paid') AND period >= ? AND period < ? GROUP BY employee_id`, idList, `${period.slice(0, 4)}-01`, period),
    all<{ employee_id: string; basic_salary_sen: number }>(env, `
      SELECT DISTINCT ON (employee_id) employee_id, basic_salary_sen FROM employee_salary_history
      WHERE ${inIds} AND effective_from <= ? ORDER BY employee_id, effective_from DESC`, idList, end),
  ]);

  const group = <T extends { employee_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.employee_id, [...(m.get(r.employee_id) ?? []), r]);
    return m;
  };
  const punchesBy = group(punches), leavesBy = group(leaves);
  const advanceBy = new Map(advances.map(a => [a.employee_id, Number(a.total)]));
  const ytdBy = new Map(ytd.map(y => [y.employee_id, { remunerationSen: Number(y.gross), epfSen: Number(y.epf), pcbSen: Number(y.pcb) }]));
  const salaryBy = new Map(salaries.map(s => [s.employee_id, s.basic_salary_sen]));

  for (const e of people) {
    if (!e.id) continue;
    const days: PunchDay[] = (punchesBy.get(e.id) ?? []).map(r => {
      // An earlier day still open has no end: it counts as the standard day, like a forgotten clock-out.
      const forgotOut = !!r.forgot_out || (!r.clock_out_at && r.work_date < today);
      return {
        date: r.work_date, minutes: forgotOut ? 0 : workedMinutes(r.clock_in_at, r.clock_out_at), forgotOut,
        inMin: mytMinute(r.clock_in_at), outMin: r.clock_out_at ? mytMinute(r.clock_out_at) : null,
      };
    });
    const approved: ApprovedLeave[] = (leavesBy.get(e.id) ?? []).map(l => ({ type: l.type, startDate: l.start_date, endDate: l.end_date }));
    out.set(e.id, {
      period, throughDay: through, employee: e,
      // Before any history row exists (a record saved before 0165 with no salary), the record's own salary.
      basicSalarySen: salaryBy.get(e.id) ?? e.basicSalarySen,
      days, leaves: approved, holidays, advanceSen: advanceBy.get(e.id) ?? 0,
      ytd: ytdBy.get(e.id) ?? { remunerationSen: 0, epfSen: 0, pcbSen: 0 }, rules,
    });
  }
  return out;
}

export interface PayslipRow extends Record<string, unknown> {
  id: string; employee_id: string; period: string; status: 'draft' | 'approved' | 'paid'; employee_name: string; employee_no: string | null;
  pay_basis: 'monthly' | 'daily'; payment_method: 'transfer' | 'cash'; bank_name: string | null; bank_account: string | null;
  generated_at: string; approved_at: string | null; paid_at: string | null;
}
/** A stored slip, in the same shape the engine returns, plus who it is for and where it stands. */
export interface PayslipView extends PayFigures {
  id: string; employeeId: string; period: string; status: 'draft' | 'approved' | 'paid'; employeeName: string; employeeNo: string | null;
  payBasis: 'monthly' | 'daily'; paymentMethod: 'transfer' | 'cash'; bankName: string | null; bankAccount: string | null;
  generatedAt: string; approvedAt: string | null; paidAt: string | null;
}

/** Column per figure, so the insert, the update and the read never drift apart. */
const FIGURE_COLS: [keyof PayFigures, string][] = [
  ['basicSalarySen', 'basic_salary_sen'], ['dayRateSen', 'day_rate_sen'], ['hourRateSen', 'hour_rate_sen'],
  ['workingDays', 'working_days'], ['daysWorked', 'days_worked'], ['paidLeaveDays', 'paid_leave_days'], ['absentDays', 'absent_days'],
  ['absenceDeductionSen', 'absence_deduction_sen'], ['otHours', 'ot_hours'], ['otSen', 'ot_sen'], ['sundayHours', 'sunday_hours'],
  ['sundaySen', 'sunday_sen'], ['holidayHours', 'holiday_hours'], ['holidaySen', 'holiday_sen'],
  ['lateShortHours', 'late_short_hours'], ['lateShortSen', 'late_short_sen'], ['allowanceSen', 'allowance_sen'], ['grossSen', 'gross_sen'],
  ['epfEmployeeSen', 'epf_employee_sen'], ['epfEmployerSen', 'epf_employer_sen'], ['socsoEmployeeSen', 'socso_employee_sen'],
  ['socsoEmployerSen', 'socso_employer_sen'], ['eisEmployeeSen', 'eis_employee_sen'], ['eisEmployerSen', 'eis_employer_sen'],
  ['pcbSen', 'pcb_sen'], ['pcbStatus', 'pcb_status'], ['pcbNote', 'pcb_note'], ['advanceSen', 'advance_sen'],
  ['totalDeductionsSen', 'total_deductions_sen'], ['netSen', 'net_sen'],
];

export function toPayslip(r: PayslipRow): PayslipView {
  const n = (col: string): number => Number(r[col]);
  const status = String(r.pcb_status);
  return {
    basicSalarySen: n('basic_salary_sen'), dayRateSen: n('day_rate_sen'), hourRateSen: n('hour_rate_sen'),
    workingDays: n('working_days'), daysWorked: n('days_worked'), paidLeaveDays: n('paid_leave_days'), absentDays: n('absent_days'),
    absenceDeductionSen: n('absence_deduction_sen'), otHours: n('ot_hours'), otSen: n('ot_sen'), sundayHours: n('sunday_hours'),
    sundaySen: n('sunday_sen'), holidayHours: n('holiday_hours'), holidaySen: n('holiday_sen'),
    lateShortHours: n('late_short_hours'), lateShortSen: n('late_short_sen'), allowanceSen: n('allowance_sen'), grossSen: n('gross_sen'),
    epfEmployeeSen: n('epf_employee_sen'), epfEmployerSen: n('epf_employer_sen'), socsoEmployeeSen: n('socso_employee_sen'),
    socsoEmployerSen: n('socso_employer_sen'), eisEmployeeSen: n('eis_employee_sen'), eisEmployerSen: n('eis_employer_sen'),
    pcbSen: n('pcb_sen'), pcbStatus: isPcbStatus(status) ? status : 'UNKNOWN', pcbNote: String(r.pcb_note), advanceSen: n('advance_sen'),
    totalDeductionsSen: n('total_deductions_sen'), netSen: n('net_sen'),
    id: r.id, employeeId: r.employee_id, period: r.period, status: r.status, employeeName: r.employee_name, employeeNo: r.employee_no,
    payBasis: r.pay_basis, paymentMethod: r.payment_method, bankName: r.bank_name, bankAccount: r.bank_account,
    generatedAt: r.generated_at, approvedAt: r.approved_at, paidAt: r.paid_at,
  };
}
const isPcbStatus = (v: string): v is PcbStatus => v === 'DISABLED' || v === 'COMPUTED' || v === 'ZERO_PROVEN' || v === 'UNKNOWN';

export async function payslipsFor(env: Env, period: string, employeeId?: string): Promise<PayslipView[]> {
  const rows = await all<PayslipRow>(env, `SELECT * FROM payslips WHERE period = ? ${employeeId ? 'AND employee_id = ?' : ''} ORDER BY employee_name`,
    period, ...(employeeId ? [employeeId] : []));
  return rows.map(toPayslip);
}

/**
 * Make or refresh the month's draft slips for everyone on payroll. Approved and paid slips are never touched. Returns
 * how many were written. The month must have started.
 */
export async function generateDrafts(env: Env, period: string, userId: string): Promise<{ written: number; kept: number }> {
  const through = throughDay(period);
  if (!through) throw new Error(`${period} has not started.`);
  const people = (await listEmployees(env)).filter(e => onPayroll(e, period));
  // Everyone gets an HR record now, so the run has an id to hang each slip on.
  for (const e of people) if (!e.id) e.id = await ensureEmployeeId(env, e);
  const inputs = await monthInputs(env, people, period, through);
  const locked = new Set((await all<{ employee_id: string }>(env, `SELECT employee_id FROM payslips WHERE period = ? AND status <> 'draft'`, period)).map(r => r.employee_id));
  const now = nowIso();
  let written = 0;
  for (const e of people) {
    if (!e.id || locked.has(e.id)) continue;
    const input = inputs.get(e.id);
    if (!input) continue;
    const f = computePay(input);
    const cols: [string, unknown][] = [
      ['employee_name', e.name], ['employee_no', e.employeeId], ['pay_basis', e.payBasis], ['payment_method', e.paymentMethod],
      ['bank_name', e.bankName], ['bank_account', e.bankAccount],
      ...FIGURE_COLS.map(([k, c]): [string, unknown] => [c, f[k]]),
      ['rules', JSON.stringify(input.rules)], ['generated_by', userId], ['generated_at', now], ['updated_at', now],
    ];
    await run(env, `
      INSERT INTO payslips (id, employee_id, period, status, ${cols.map(([c]) => c).join(', ')}, created_at)
      VALUES (?, ?, ?, 'draft', ${cols.map(([c]) => (c === 'rules' ? '?::jsonb' : '?')).join(', ')}, ?)
      ON CONFLICT (employee_id, period) DO UPDATE SET ${cols.map(([c]) => `${c} = excluded.${c}`).join(', ')}
      WHERE payslips.status = 'draft'`,
      crypto.randomUUID(), e.id, period, ...cols.map(([, v]) => v), now);
    written++;
  }
  return { written, kept: locked.size };
}
