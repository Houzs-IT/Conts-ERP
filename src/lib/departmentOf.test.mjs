// node --test src/lib/departmentOf.test.mjs. The department a person is filed under (functions/_lib/hrFields.ts):
// Working Hours, Labor Cost, Payroll and Advances label people with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const { departmentOf, DEPARTMENTS, DEPARTMENT_LABEL } = await import('../../functions/_lib/hrFields.ts');

test('a Renovation person is filed under Renovation', () => {
  assert.equal(departmentOf({ cleanerId: null, renovatorId: 'r1' }), 'renovation');
});

test('a cleaner is filed under Cleaning, also when they are a technician too', () => {
  assert.equal(departmentOf({ cleanerId: 'c1', renovatorId: null }), 'cleaning');
});

test('a technician only is filed under Maintenance', () => {
  assert.equal(departmentOf({ cleanerId: null, renovatorId: null }), 'maintenance');
});

test('every department has a label', () => {
  assert.deepEqual(DEPARTMENTS.map(department => DEPARTMENT_LABEL[department]), ['Cleaning', 'Maintenance', 'Renovation']);
});
