// node --test src/lib/hr.test.mjs. The employee record's rules in functions/_lib/hrFields.ts (migration 0162).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { employeeInput, EMPLOYEE_DEFAULTS } = await import('../../functions/_lib/hrFields.ts');

test('the defaults are a valid record', () => {
  assert.equal(employeeInput.safeParse(EMPLOYEE_DEFAULTS).success, true);
});

test('a resigned employee needs a last working day', () => {
  const r = employeeInput.safeParse({ ...EMPLOYEE_DEFAULTS, status: 'resigned', resignedAt: null });
  assert.equal(r.success, false);
  assert.equal(r.error.issues[0].path[0], 'resignedAt');
  assert.equal(employeeInput.safeParse({ ...EMPLOYEE_DEFAULTS, status: 'resigned', resignedAt: '2026-10-31' }).success, true);
});

test('bank account keeps digits only; empty text becomes null', () => {
  const r = employeeInput.parse({ ...EMPLOYEE_DEFAULTS, bankAccount: '1234 5678-90', position: '  ', nationality: ' Malaysian ' });
  assert.equal(r.bankAccount, '1234567890');
  assert.equal(r.position, null);
  assert.equal(r.nationality, 'Malaysian');
  assert.equal(employeeInput.safeParse({ ...EMPLOYEE_DEFAULTS, bankAccount: '12ab' }).success, false);
});

test('only the listed banks, and money in whole sen', () => {
  assert.equal(employeeInput.safeParse({ ...EMPLOYEE_DEFAULTS, bankName: 'Maybank' }).success, true);
  assert.equal(employeeInput.safeParse({ ...EMPLOYEE_DEFAULTS, bankName: 'maybank' }).success, false);
  assert.equal(employeeInput.safeParse({ ...EMPLOYEE_DEFAULTS, basicSalarySen: 1500.5 }).success, false);
  assert.equal(employeeInput.safeParse({ ...EMPLOYEE_DEFAULTS, basicSalarySen: -1 }).success, false);
});
