// node --test src/lib/payroll.test.mjs. One month's pay in functions/_lib/payrollCalc.ts (migration 0165), figures worked
// out by hand. November 2026: the 1st is a Sunday, so Monday to Saturday gives 25 working days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The functions code imports its siblings without an extension (the bundler adds it); let Node try `.ts`.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));

const { computePay, DEFAULT_PAY_RULES, parsePayRules, periodDates } = await import('../../functions/_lib/payrollCalc.ts');

const person = {
  payBasis: 'monthly', dailyRateSen: 0, workingDaysPerMonth: 26, workingHoursPerDay: 8, otMultiplier: 1.5,
  epfEnabled: true, socsoEnabled: true, eisEnabled: true, pcbEnabled: false,
  taxResidency: null, taxCategory: null, taxChildReliefSen: null,
};
const NO_YTD = { remunerationSen: 0, epfSen: 0, pcbSen: 0 };
const workingDates = periodDates('2026-11', '2026-11-30').filter(d => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0);
const base = { period: '2026-11', throughDay: '2026-11-30', employee: person, basicSalarySen: 260_000, leaves: [], holidays: [], advanceSen: 0, ytd: NO_YTD, rules: DEFAULT_PAY_RULES };

test('November 2026 has 25 working days', () => {
  assert.equal(workingDates.length, 25);
});

test('a monthly month: absence, overtime, Sunday, leave, forgotten clock-out, statutory and an advance', () => {
  const days = workingDates
    .filter(d => d !== '2026-11-30' && d !== '2026-11-27')
    .map(d => ({ date: d, minutes: d === '2026-11-02' ? 600 : d === '2026-11-03' ? 520 : 480, forgotOut: d === '2026-11-04' }));
  days.push({ date: '2026-11-15', minutes: 300, forgotOut: false }); // a Sunday
  const f = computePay({ ...base, days, leaves: [{ type: 'annual', startDate: '2026-11-27', endDate: '2026-11-27' }], advanceSen: 20_000 });
  assert.equal(f.dayRateSen, 10_000);          // RM 2,600 / 26
  assert.equal(f.hourRateSen, 1_250);          // RM 100 / 8 h
  assert.equal(f.workingDays, 25);
  assert.equal(f.daysWorked, 23);
  assert.equal(f.paidLeaveDays, 1);
  assert.equal(f.absentDays, 1);               // 30 Nov
  assert.equal(f.absenceDeductionSen, 10_000);
  assert.equal(f.otHours, 2.5);                // 2 h on the 2nd, 40 min floored to 30 min on the 3rd, none on the forgotten day
  assert.equal(f.otSen, 4_688);                // 2.5 x 12.50 x 1.5 = 46.875
  assert.equal(f.sundayHours, 5);
  assert.equal(f.sundaySen, 12_500);           // 5 x 12.50 x 2
  assert.equal(f.grossSen, 267_188);
  assert.equal(f.epfEmployeeSen, 28_600);      // 11% of the basic
  assert.equal(f.epfEmployerSen, 33_800);
  assert.equal(f.socsoEmployeeSen, 745);
  assert.equal(f.eisEmployeeSen, 390);
  assert.equal(f.pcbStatus, 'DISABLED');
  assert.equal(f.totalDeductionsSen, 29_735);
  assert.equal(f.netSen, 217_453);             // gross - statutory - RM 200 advance
});

test('the running month counts only the days so far', () => {
  const days = periodDates('2026-11', '2026-11-10').filter(d => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0).map(d => ({ date: d, minutes: 480, forgotOut: false }));
  const f = computePay({ ...base, throughDay: '2026-11-10', days });
  assert.equal(f.workingDays, 8);
  assert.equal(f.absentDays, 0);
  assert.equal(f.grossSen, 260_000);
});

test('emergency leave is paid or an absence, by the rule', () => {
  const days = workingDates.filter(d => d !== '2026-11-30').map(d => ({ date: d, minutes: 480, forgotOut: false }));
  const leaves = [{ type: 'emergency', startDate: '2026-11-30', endDate: '2026-11-30' }];
  assert.equal(computePay({ ...base, days, leaves }).absentDays, 0);
  assert.equal(computePay({ ...base, days, leaves, rules: { ...DEFAULT_PAY_RULES, emergencyLeavePaid: false } }).absentDays, 1);
  assert.equal(computePay({ ...base, days, leaves: [{ type: 'unpaid', startDate: '2026-11-30', endDate: '2026-11-30' }] }).absentDays, 1);
});

test('daily pay: days worked times the rate, public-holiday hours at 3x, no absences', () => {
  const days = ['2026-11-02', '2026-11-04', '2026-11-05'].map(d => ({ date: d, minutes: 480, forgotOut: false }));
  days.push({ date: '2026-11-03', minutes: 240, forgotOut: false });
  const f = computePay({
    ...base, employee: { ...person, payBasis: 'daily', dailyRateSen: 12_000, epfEnabled: false, socsoEnabled: false, eisEnabled: false },
    days, holidays: [{ date: '2026-11-03', name: 'Test holiday' }],
  });
  assert.equal(f.daysWorked, 3);
  assert.equal(f.absentDays, 0);
  assert.equal(f.holidayHours, 4);
  assert.equal(f.holidaySen, 18_000);          // 4 x RM 15 x 3
  assert.equal(f.grossSen, 54_000);
  assert.equal(f.netSen, 54_000);
});

test('PCB: worked out for a declared resident, refused for an undeclared one on a high salary', () => {
  const days = workingDates.map(d => ({ date: d, minutes: 480, forgotOut: false }));
  // RM 8,000 a month all year: ten months already paid, so the projection reaches the taxed bands.
  const high = { ...base, basicSalarySen: 800_000, days, ytd: { remunerationSen: 8_000_000, epfSen: 880_000, pcbSen: 0 } };
  const declared = computePay({ ...high, employee: { ...person, pcbEnabled: true, taxResidency: 'resident', taxCategory: 'single', taxChildReliefSen: 0 } });
  assert.equal(declared.pcbStatus, 'COMPUTED');
  assert.ok(declared.pcbSen > 0);
  assert.equal(declared.totalDeductionsSen, declared.epfEmployeeSen + 745 + 390 + declared.pcbSen);
  const undeclared = computePay({ ...high, employee: { ...person, pcbEnabled: true } });
  assert.equal(undeclared.pcbStatus, 'UNKNOWN');
  assert.equal(undeclared.pcbSen, 0);
});

test('an advance bigger than the month is shown as owed, not written off', () => {
  const f = computePay({ ...base, basicSalarySen: 10_000, days: [], advanceSen: 50_000, employee: { ...person, epfEnabled: false, socsoEnabled: false, eisEnabled: false } });
  assert.ok(f.netSen < 0);
});

test('pay rules: defaults when never set, an error when broken', () => {
  assert.deepEqual(parsePayRules(null), DEFAULT_PAY_RULES);
  assert.throws(() => parsePayRules('{"epfEmployeePct":"eleven"}'), /not valid/);
});
