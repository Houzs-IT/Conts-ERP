/** Standalone unit test for the pure PriceLabs payload -> rate-row mapping.
 *  No test runner is configured in this repo, so this runs directly:  npx tsx functions/_lib/pricelabs.test.ts
 *  It exits non-zero on the first failed assertion. */
import { mapPriceLabsPayload, priceToSen } from './pricelabs';

let passed = 0;
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`FAIL: ${name}`); // uncaught -> non-zero exit
  passed++;
  console.log(`ok - ${name}`);
}
function eq(name: string, a: unknown, b: unknown) {
  check(name, JSON.stringify(a) === JSON.stringify(b));
}

// Money: major currency units -> integer sen, rounded.
eq('priceToSen whole', priceToSen(199), 19900);
eq('priceToSen with cents', priceToSen(199.5), 19950);
eq('priceToSen rounds half-sen up', priceToSen(199.999), 20000);
eq('priceToSen zero', priceToSen(0), 0);

// Bare-array payload maps every item and converts money.
eq('bare array maps to sen rows',
  mapPriceLabsPayload([
    { listing_id: 'PL-1', date: '2026-10-01', price: 250 },
    { listing_id: 'PL-1', date: '2026-10-02', price: 275.5 },
  ]),
  [
    { listingId: 'PL-1', date: '2026-10-01', rateSen: 25000 },
    { listingId: 'PL-1', date: '2026-10-02', rateSen: 27550 },
  ]);

// { data: [...] } wrapper is accepted too.
eq('data-wrapped payload',
  mapPriceLabsPayload({ data: [{ listing_id: 'PL-2', date: '2026-12-24', price: 480 }] }),
  [{ listingId: 'PL-2', date: '2026-12-24', rateSen: 48000 }]);

// Empty array is valid and yields nothing.
eq('empty array', mapPriceLabsPayload([]), []);

// Invalid shapes throw (endpoint turns this into a 422).
function throws(name: string, fn: () => unknown) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  check(name, threw);
}
throws('rejects bad date', () => mapPriceLabsPayload([{ listing_id: 'PL-1', date: '10/01/2026', price: 250 }]));
throws('rejects negative price', () => mapPriceLabsPayload([{ listing_id: 'PL-1', date: '2026-10-01', price: -5 }]));
throws('rejects missing listing_id', () => mapPriceLabsPayload([{ date: '2026-10-01', price: 250 }]));
throws('rejects non-array non-data', () => mapPriceLabsPayload({ nope: true }));

console.log(`\n${passed} assertions passed`);
