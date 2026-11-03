// Owner income from October 2026 (owner, 3 Nov 2026): a stay's income is what the calendar shows as its host payout, the
// booking value less the booking site's fee, split by night into the month. It no longer waits for the payout to be
// recorded (collected revenue, payment lines). September 2026 and earlier stay as they were, on the payout recorded.
// Pure: no server or database needed.
//   node scripts/api-checks/owner-income-net.mjs
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = await build({ entryPoints: [join(root, 'functions/_lib/ownerStatement.ts')], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
const tmp = mkdtempSync(join(tmpdir(), 'income-net-'));
writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
const S = await import(pathToFileURL(join(tmp, 'm.mjs')).href);

let fails = 0;
const check = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' :: ' + extra}`); };

const unit = {
  id: 'u1', owner_id: 'o1', owner_name: 'Owner', unit_number: 'S-30-12', unit_code: 'S-30-12', property_name: 'ASTRUM AMPANG', address: null,
  package: 'Package A', term: null, split_kind: 'Profit share', split_value: 75, unit_misc: 0,
  contract_id: null, model: 'management', management_fee_pct: 25, grr_amount: 0, starts_on: null, ends_on: null,
  minimum_guarantee: 0, guarantee_starts_on: null, guarantee_ends_on: null, contract_misc: 0,
};
const terms = S.termsFor(unit, 25);
const stay = (id, check_in, check_out, collected_revenue, host_payout, parts) =>
  ({ id, unit_id: 'u1', check_in, check_out, collected_revenue, host_payout, channel: 'airbnb', external_ref: null, guest_name: null, ...(parts ? { parts } : {}) });
const income = (month, stays) => S.computeUnitMonth(month, unit, terms, stays, [], [], 10000).gross;

// 1. October: a stay with no payout recorded is income at its host payout (RM 802.78 = 952.23 - 149.45).
check('Oct stay with no payout recorded counts at its host payout', income('2026-10', [stay('a', '2026-10-18', '2026-10-30', 0, 80278)]) === 80278,
  String(income('2026-10', [stay('a', '2026-10-18', '2026-10-30', 0, 80278)])));

// 2. October: a recorded payout that differs from the host payout gives way to the host payout (S-22-04: 2,044.35, not 1,967.84).
check('Oct uses the host payout, not the recorded payout', income('2026-10', [stay('b', '2026-10-01', '2026-10-31', 196784, 204435)]) === 204435,
  String(income('2026-10', [stay('b', '2026-10-01', '2026-10-31', 196784, 204435)])));

// 3. A stay across the month end: October takes its October nights' share of the host payout (30 of 31 nights).
const across = stay('c', '2026-09-30', '2026-10-31', 196784, 204435);
check('Oct takes 30/31 of a stay that began on 30 Sep', income('2026-10', [across]) === Math.round(204435 * 30 / 31), String(income('2026-10', [across])));

// 4. September keeps the recorded payout: the same stay gives Sep 1/31 of the collected revenue.
check('Sep keeps the recorded payout', income('2026-09', [across]) === Math.round(196784 / 31), String(income('2026-09', [across])));

// 5. September keeps the payment lines (a monthly instalment) where there are any.
const instal = stay('d', '2026-09-01', '2026-10-31', 0, 300000, [{ check_in: '2026-09-01', check_out: '2026-10-01', amount: 120000 }, { check_in: '2026-10-01', check_out: '2026-10-31', amount: 125000 }]);
check('Sep keeps the instalment lines', income('2026-09', [instal]) === 120000, String(income('2026-09', [instal])));
// ... and October ignores them for the host payout: 30 of the stay's 60 nights.
check('Oct ignores the instalment lines', income('2026-10', [instal]) === 150000, String(income('2026-10', [instal])));

// 6. October: a stay without a host payout figure (an older caller that did not load it) keeps the recorded payout.
check('Oct without a host payout figure falls back to the recorded payout', income('2026-10', [stay('e', '2026-10-01', '2026-10-03', 20000, undefined)]) === 20000,
  String(income('2026-10', [stay('e', '2026-10-01', '2026-10-03', 20000, undefined)])));

// 6b. October: a stay with no booking value (a direct booking paid by hand) keeps its recorded money.
const handPaid = stay('g', '2026-10-05', '2026-10-07', 0, 0, [{ check_in: '2026-10-05', check_out: '2026-10-07', amount: 30000 }]);
check('Oct: no booking value keeps the money recorded by hand', income('2026-10', [handPaid]) === 30000, String(income('2026-10', [handPaid])));

// 7. October: no "no host payout recorded" warning for a stay that has a host payout.
const w = S.computeUnitMonth('2026-10', unit, terms, [stay('f', '2026-10-18', '2026-10-30', 0, 80278)], [], [], 10000).warnings;
check('Oct: no missing-payout warning when the host payout is known', !w.some(x => /no host payout recorded/.test(x)), w.join(' | '));

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
