// Booking value and fee from a Channex revision (functions/_lib/channexAmounts.ts). Pure: needs no server.
// Run: node scripts/api-checks/channex-amounts.mjs
import { bookingAmounts } from '../../functions/_lib/channexAmounts.ts';
let fails = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` :: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`); };
const NOTES = 'Listing Base Price: 125.00\nTransient Occupancy Tax Paid Amount: N/A\nListing Cancellation Payout: 104.07\nListing Cancellation Host Fee: 20.93\nOccupancy Tax Amount Paid To Host: N/A\nExtra Guest Fee: 0.00';

check('the first live Airbnb booking: 104.07 payout + 20.93 fee is a RM 125.00 booking', bookingAmounts({ amount: '104.07', ota_name: 'AirBNB', notes: NOTES }), { grossSen: 12500, feeSen: 2093, source: 'notes' });
check('Airbnb with a commission figure: it is added back to the payout', bookingAmounts({ amount: 104.07, ota_commission: '20.93', ota_name: 'Airbnb' }), { grossSen: 12500, feeSen: 2093, source: 'commission' });
check('Airbnb with no fee anywhere: the amount is kept, fee 0', bookingAmounts({ amount: '104.07', ota_name: 'AirBNB', notes: 'Number Of Pets: 0' }), { grossSen: 10407, feeSen: 0, source: 'amount' });
check('Airbnb fee line of N/A is not a fee', bookingAmounts({ amount: '90', ota_name: 'AirBNB', notes: 'Listing Cancellation Host Fee: N/A' }), { grossSen: 9000, feeSen: 0, source: 'amount' });
check('Booking.com: the amount already includes the commission', bookingAmounts({ amount: '200.00', ota_commission: '30.00', ota_name: 'Booking.com' }), { grossSen: 20000, feeSen: 3000, source: 'commission' });
check('Booking.com note text is never read as a fee', bookingAmounts({ amount: '200.00', ota_name: 'Booking.com', notes: 'Host Fee: 50.00' }), { grossSen: 20000, feeSen: 0, source: 'amount' });
check('no amount on the booking: the room amount is used', bookingAmounts({ ota_name: 'Agoda' }, '150.5'), { grossSen: 15050, feeSen: 0, source: 'amount' });
console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0);
