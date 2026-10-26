// node --test src/lib/payroll.test.mjs. One month's pay in functions/_lib/payrollCalc.ts (migration 0168), figures worked
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
const base = { period: '2026-11', throughDay: '2026-11-30', employee: person, basicSalarySen: 260_000, leaves: [], holidays: [], advanceSen: 0, penaltySen: 0, ytd: NO_YTD, rules: DEFAULT_PAY_RULES };

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

const { shiftDay } = await import('../../functions/_lib/payrollCalc.ts');
const SHIFT = { ...DEFAULT_PAY_RULES, useShiftRules: true }; // Hookka's 08:00-18:00, 12:00-13:00 lunch, 15 min grace
const hm = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

test('shift rules start off; the defaults are Hookka\'s otherwise', () => {
  assert.equal(DEFAULT_PAY_RULES.useShiftRules, false);
  assert.equal(DEFAULT_PAY_RULES.shiftStartMin, 480);
  assert.equal(DEFAULT_PAY_RULES.epfOn, 'basic');
  assert.deepEqual(parsePayRules('{"epfEmployeePct":11}').useShiftRules, false); // an old saved setting gains the new rules
});

test('Hookka\'s day: late past the grace counts from the start, lunch comes off, overtime in blocks after the end', () => {
  assert.deepEqual(shiftDay(hm('08:20'), hm('18:40'), SHIFT), { regularMin: 520, otMin: 30, shortfallMin: 0, lateMin: 20 });
  assert.deepEqual(shiftDay(hm('08:10'), hm('17:00'), SHIFT), { regularMin: 480, otMin: 0, shortfallMin: 60, lateMin: 0 });
  assert.equal(shiftDay(hm('08:00'), hm('18:14'), SHIFT).otMin, 0); // under one block earns nothing
});

test('shift rules on: a short day is docked at the hour rate (day rate / (hours + lunch))', () => {
  const days = workingDates.map(d => ({ date: d, minutes: 600, forgotOut: false, inMin: 480, outMin: d === '2026-11-02' ? 1020 : 1080 }));
  const f = computePay({ ...base, employee: { ...person, workingHoursPerDay: 9 }, days, rules: SHIFT });
  assert.equal(f.hourRateSen, 1_000);          // RM 100 / (9 h + 1 h lunch)
  assert.equal(f.lateShortHours, 1);
  assert.equal(f.lateShortSen, 1_000);
  assert.equal(f.otHours, 0);
  assert.equal(f.grossSen, 259_000);
});

test('shift rules off: lunch does not change the hour rate', () => {
  const f = computePay({ ...base, days: workingDates.map(d => ({ date: d, minutes: 480, forgotOut: false, inMin: null, outMin: null })) });
  assert.equal(f.hourRateSen, 1_250);
  assert.equal(f.lateShortSen, 0);
});

test('EPF on the basic earned instead of the full basic', () => {
  // No work in November: 25 absent days at RM 100 leave RM 100 of the RM 2,600 (the /26 day rate, as on Hookka).
  const f = computePay({ ...base, days: [], rules: { ...DEFAULT_PAY_RULES, epfOn: 'earned' } });
  assert.equal(f.grossSen, 10_000);
  assert.equal(f.epfEmployeeSen, 1_100);       // 11% of RM 100
  assert.equal(computePay({ ...base, days: [] }).epfEmployeeSen, 28_600); // Hookka's rule: 11% of the full RM 2,600
});

test('while the month runs, the last two working days with nothing logged are pending, not absent', () => {
  const f = computePay({ ...base, throughDay: '2026-11-10', days: [] });
  assert.equal(f.workingDays, 8);
  assert.equal(f.absentDays, 6);
});

test('day rate by the month\'s calendar days or working days', () => {
  assert.equal(computePay({ ...base, days: [], rules: { ...DEFAULT_PAY_RULES, dayRateDivisorMode: 'calendarDays' } }).dayRateSen, 8_667); // 2,600 / 30
  assert.equal(computePay({ ...base, days: [], rules: { ...DEFAULT_PAY_RULES, dayRateDivisorMode: 'workingDays' } }).dayRateSen, 10_400); // 2,600 / 25
});

test('leader allowance: the share of the month not missed, added after statutory and PCB', () => {
  const days = workingDates.filter(d => d !== '2026-11-30').map(d => ({ date: d, minutes: 480, forgotOut: false, inMin: null, outMin: null }));
  const f = computePay({ ...base, days, employee: { ...person, leaderAllowanceSen: 26_000 } });
  assert.equal(f.absentDays, 1);
  assert.equal(f.allowanceSen, 25_000);        // RM 260 x 25 / 26
  assert.equal(f.grossSen, 250_000 + 25_000);  // 2,600 - 100 absent + 250 allowance
  assert.equal(f.epfEmployeeSen, 28_600);      // EPF unchanged by the allowance
  assert.equal(f.netSen, 275_000 - 28_600 - 745 - 390);
});

test('Working Hours grid: logged hours win over the punch; a logged day with no punch counts; zero logged is not worked', () => {
  const days = workingDates.map(d => ({ date: d, minutes: 480, forgotOut: false, inMin: null, outMin: null }));
  days[0].loggedMin = 600;                     // office logged 10 h on 2 Nov over an 8 h punch: 2 h overtime
  days[1].loggedMin = 0;                       // office logged 0 on 3 Nov: an absence
  days.push({ date: '2026-11-15', minutes: 300, forgotOut: false, inMin: null, outMin: null, loggedMin: 300 }); // a Sunday, logged only
  const f = computePay({ ...base, days });
  assert.equal(f.otHours, 2);
  assert.equal(f.absentDays, 1);
  assert.equal(f.sundayHours, 5);
});

test('Working Hours grid with shift rules on: a logged day short of the standard day is docked', () => {
  const days = workingDates.map(d => ({ date: d, minutes: 0, forgotOut: false, inMin: null, outMin: null, loggedMin: d === '2026-11-02' ? 480 : 540 }));
  const f = computePay({ ...base, employee: { ...person, workingHoursPerDay: 9 }, days, rules: SHIFT });
  assert.equal(f.lateShortHours, 1);           // standard 08:00-18:00 less lunch = 9 h; 8 h logged
  assert.equal(f.otHours, 0);
});

test('a worker penalty comes off net pay after statutory, like an advance', () => {
  const days = workingDates.map(d => ({ date: d, minutes: 480, forgotOut: false, inMin: null, outMin: null }));
  const without = computePay({ ...base, days });
  const f = computePay({ ...base, days, penaltySen: 5_000, advanceSen: 2_000 });
  assert.equal(f.penaltySen, 5_000);
  assert.equal(f.grossSen, without.grossSen);
  assert.equal(f.epfEmployeeSen, without.epfEmployeeSen);
  assert.equal(f.netSen, without.netSen - 5_000 - 2_000);
});
