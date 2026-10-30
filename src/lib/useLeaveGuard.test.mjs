// node --test src/lib/useLeaveGuard.test.mjs. Which moves count as leaving a form with unsaved changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leavesPlace } from './useLeaveGuard.ts';

const here = { pathname: '/properties/units/a', search: '?tab=details' };
const params = ['tab', 'view'];

test('another page is leaving', () => {
  assert.equal(leavesPlace(here, { pathname: '/properties/units/b', search: '?tab=details' }, params), true);
  assert.equal(leavesPlace(here, { pathname: '/reservations', search: '' }, params), true);
});

test('another tab or view on the same page is leaving', () => {
  assert.equal(leavesPlace(here, { pathname: here.pathname, search: '?tab=contract' }, params), true);
  assert.equal(leavesPlace(here, { pathname: here.pathname, search: '' }, params), true);
  assert.equal(leavesPlace(here, { pathname: here.pathname, search: '?tab=details&view=list' }, params), true);
});

test('a search box or filter on the same tab is not leaving', () => {
  assert.equal(leavesPlace(here, { pathname: here.pathname, search: '?tab=details&q=tower' }, params), false);
  assert.equal(leavesPlace(here, { search: '?q=tower&tab=details' }, params), false);
});
