// Sample data for trying the owner screens: one demo owner, "[Demo] Tan Mei Ling", with three units in
// "[Demo] Building", each on a different revenue model, and a month of bookings, expenses (owner-paid and
// company-paid), utility account numbers and owner credits and charges.
//
//   unit D46-08   management share 75/20/5 (agent Kelvin)
//   unit D15-05   share with a RM 2,800 monthly minimum (Package D): below the minimum, so the company tops up
//   unit C31-03A  guaranteed rent RM 3,000 a month; a company-paid aircon repair that never reaches the owner
//
// Every id starts 'demo-own-', so the data is easy to find and to remove. Dates fall in one month (default: last
// month, so the owner profile opens on it); bookings and bills are rebuilt on every run, so it is safe to re-run.
//
//   DATABASE_URL=postgres://...  node scripts/demo-owners-seed.mjs [--month=2026-09]
//   DATABASE_URL=postgres://...  node scripts/demo-owners-seed.mjs --clean        removes all of it
//
// Refuses the production database (Supabase project cweomoenhsjvsxfsmiiw). Statements are not generated here:
// generate the month on Finance, Statements to see the demo owner's statement and report.
import postgres from 'postgres';

const url = process.env.DATABASE_URL ?? '';
if (!url) { console.error('Set DATABASE_URL to the database to seed (local or staging).'); process.exit(2); }
if (/cweomoenhsjvsxfsmiiw/.test(url)) { console.error('Refusing: that is the production database.'); process.exit(1); }
const clean = process.argv.includes('--clean');
const monthArg = process.argv.find(a => a.startsWith('--month='))?.slice(8);

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, connection: { search_path: 'pos' } });
const PREFIX = 'demo-own-';
const OWNER = `${PREFIX}owner`, PROPERTY = `${PREFIX}building`;
const U = { share: `${PREFIX}unit-d4608`, min: `${PREFIX}unit-d1505`, grr: `${PREFIX}unit-c3103a` };
const now = new Date().toISOString();

/** Every row the seed made, in an order foreign keys allow: tables that point at units or the owner go first. */
async function removeAll() {
  const statements = (await sql`SELECT id FROM owner_statements WHERE owner_id = ${OWNER}`).map(r => r.id);
  if (statements.length) {
    await sql`UPDATE owner_adjustments SET statement_id = NULL WHERE statement_id IN ${sql(statements)}`;
    await sql`DELETE FROM payouts WHERE statement_id IN ${sql(statements)} OR owner_id = ${OWNER}`.catch(() => sql`DELETE FROM payouts WHERE owner_id = ${OWNER}`);
    await sql`DELETE FROM statement_lines WHERE statement_id IN ${sql(statements)}`;
    await sql`DELETE FROM statement_units WHERE statement_id IN ${sql(statements)}`;
    await sql`DELETE FROM owner_statements WHERE id IN ${sql(statements)}`;
  }
  await sql`UPDATE units SET contract_id = NULL WHERE id LIKE ${PREFIX + '%'}`;
  // Anything else that points at a demo unit or the demo owner (rates, tasks, documents, audit-free tables).
  const cols = await sql`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'pos' AND column_name IN ('unit_id', 'owner_id') AND table_name NOT IN ('units', 'owners')
      AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'pos' AND table_type = 'BASE TABLE')`;
  for (let pass = 0; pass < 4; pass++) {
    let failed = 0;
    for (const c of cols) {
      await sql.unsafe(`DELETE FROM "${c.table_name}" WHERE "${c.column_name}" LIKE '${PREFIX}%'`).catch(() => { failed++; });
    }
    if (!failed) break;
  }
  await sql`DELETE FROM guests WHERE id LIKE ${PREFIX + '%'}`;
  await sql`DELETE FROM units WHERE id LIKE ${PREFIX + '%'}`;
  await sql`DELETE FROM owner_contracts WHERE id LIKE ${PREFIX + '%'}`;
  await sql`DELETE FROM properties WHERE id = ${PROPERTY}`;
  await sql`DELETE FROM owners WHERE id = ${OWNER}`;
}

if (clean) {
  await removeAll();
  const left = await sql`SELECT (SELECT COUNT(*) FROM units WHERE id LIKE ${PREFIX + '%'})::int AS units, (SELECT COUNT(*) FROM owners WHERE id = ${OWNER})::int AS owners`;
  console.log(`demo owner data removed (left: ${left[0].units} units, ${left[0].owners} owners)`);
  await sql.end();
  process.exit(0);
}

const today = new Date();
const month = monthArg && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthArg) ? monthArg
  : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const d = (day) => `${month}-${String(day).padStart(2, '0')}`;
const [y, m] = month.split('-').map(Number);
const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
const startOfYear = `${y}-01-01`;

await sql.begin(async tx => {
  await tx`INSERT INTO owners (id, display_name, email, phone, ic_number, bank_name, bank_account_holder, bank_account_number, bank_account_last4, created_at, updated_at)
    VALUES (${OWNER}, '[Demo] Tan Mei Ling', 'demo.owner@theconts.invalid', '+60 12-000 0000', '900101-14-5101', 'MBBE', '[Demo] Tan Mei Ling', '000000002977', '2977', ${now}, ${now})
    ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = EXCLUDED.updated_at`;
  await tx`INSERT INTO properties (id, name, address_line, city, state, created_at, updated_at)
    VALUES (${PROPERTY}, '[Demo] Building', '1 Jalan Contoh', 'Kuala Lumpur', 'Kuala Lumpur', ${now}, ${now})
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at`;

  const units = [
    { id: U.share, number: 'D46-08', name: '[Demo] KLCC View 2BR', pkg: 'Package A', split: 'Profit share', splitValue: 75, rate: 28000 },
    { id: U.min, number: 'D15-05', name: '[Demo] City Studio', pkg: 'Package D', split: 'Profit share', splitValue: 75, rate: 18000 },
    { id: U.grr, number: 'C31-03A', name: '[Demo] Garden Suite', pkg: 'Package C', split: 'GRR — guaranteed rent', splitValue: 300000, rate: 26000 },
  ];
  for (const u of units) {
    await tx`INSERT INTO units (id, property_id, owner_id, unit_number, unit_code, listing_name, bedrooms, bathrooms, max_guests, base_rate, is_listed, package, term, split_kind, split_value, created_at, updated_at)
      VALUES (${u.id}, ${PROPERTY}, ${OWNER}, ${u.number}, ${'DEMO-' + u.number.replace(/-/g, '')}, ${u.name}, 2, 2, 4, ${u.rate}, 0, ${u.pkg}, 'Short term', ${u.split}, ${u.splitValue}, ${now}, ${now})
      ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, package = EXCLUDED.package, split_kind = EXCLUDED.split_kind, split_value = EXCLUDED.split_value, updated_at = EXCLUDED.updated_at`;
  }

  // One contract per unit, each on its own revenue model.
  const contracts = [
    { id: `${PREFIX}contract-d4608`, unit: U.share, revenue_model: 'management', model: 'management', fee: 25, agent: 5, agent_name: 'Kelvin', grr: 0, min: 0, misc: 1 },
    { id: `${PREFIX}contract-d1505`, unit: U.min, revenue_model: 'management_guarantee', model: 'management', fee: 25, agent: null, agent_name: null, grr: 0, min: 280000, misc: 0 },
    { id: `${PREFIX}contract-c3103a`, unit: U.grr, revenue_model: 'grr', model: 'grr', fee: 0, agent: null, agent_name: null, grr: 300000, min: 0, misc: 0 },
  ];
  for (const c of contracts) {
    await tx`INSERT INTO owner_contracts (id, owner_id, unit_id, revenue_model, model, management_fee_pct, agent_fee_pct, agent_name, grr_amount, minimum_guarantee, guarantee_starts_on, misc_charges, starts_on, renews_on, created_at)
      VALUES (${c.id}, ${OWNER}, ${c.unit}, ${c.revenue_model}, ${c.model}, ${c.fee}, ${c.agent}, ${c.agent_name}, ${c.grr}, ${c.min}, ${c.min ? startOfYear : null}, ${c.misc}, ${startOfYear}, ${`${y + 2}-01-01`}, ${now})
      ON CONFLICT (id) DO UPDATE SET unit_id = EXCLUDED.unit_id, revenue_model = EXCLUDED.revenue_model, model = EXCLUDED.model, management_fee_pct = EXCLUDED.management_fee_pct,
        agent_fee_pct = EXCLUDED.agent_fee_pct, agent_name = EXCLUDED.agent_name, grr_amount = EXCLUDED.grr_amount, minimum_guarantee = EXCLUDED.minimum_guarantee,
        guarantee_starts_on = EXCLUDED.guarantee_starts_on, misc_charges = EXCLUDED.misc_charges, starts_on = EXCLUDED.starts_on, ends_on = NULL`;
    await tx`UPDATE units SET contract_id = ${c.id} WHERE id = ${c.unit}`;
  }

  // The month's bookings, bills and credits are rebuilt each run.
  await tx`DELETE FROM reservations WHERE id LIKE ${PREFIX + 'res-%'}`;
  await tx`DELETE FROM expenses WHERE id LIKE ${PREFIX + 'exp-%'}`;
  await tx`DELETE FROM owner_adjustments WHERE id LIKE ${PREFIX + 'adj-%'} AND statement_id IS NULL`;

  const guests = ['Aiman Hakim', 'Sarah Lim', 'Rajesh Nair', 'Emily Wong', 'Daniel Tan', 'Nur Aisyah', 'Kenji Sato', 'Priya Devi'];
  for (const [i, g] of guests.entries()) {
    await tx`INSERT INTO guests (id, full_name, created_at) VALUES (${`${PREFIX}guest-${i + 1}`}, ${'[Demo] ' + g}, ${now}) ON CONFLICT (id) DO NOTHING`;
  }
  // [unit, check-in day, nights, collected sen, channel]. D46-08 earns RM 7,941.00; D15-05 RM 3,080.00; C31-03A RM 4,500.00.
  const stays = [
    [U.share, 1, 4, 148000, 'airbnb'], [U.share, 6, 6, 205000, 'booking_com'], [U.share, 13, 5, 171000, 'airbnb'], [U.share, 19, 4, 132100, 'direct'], [U.share, 24, 5, 138000, 'airbnb'],
    [U.min, 3, 5, 110000, 'airbnb'], [U.min, 12, 4, 88000, 'booking_com'], [U.min, 20, 5, 110000, 'airbnb'],
    [U.grr, 2, 7, 210000, 'airbnb'], [U.grr, 15, 8, 240000, 'booking_com'],
  ];
  for (const [i, [unit, day, n, amount, channel]] of stays.entries()) {
    const out = day + n > lastDay ? lastDay : day + n;
    await tx`INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, guests_count, gross_booking_value, channel_fee, collected_revenue, created_at, updated_at)
      VALUES (${`${PREFIX}res-${i + 1}`}, ${unit}, ${`${PREFIX}guest-${(i % guests.length) + 1}`}, ${channel}, ${`DEMO-${month.replace('-', '')}-${i + 1}`}, 'checked_out',
              ${d(day)}, ${d(out)}, 2, ${Math.round(amount * 1.15)}, ${Math.round(amount * 0.15)}, ${amount}, ${now}, ${now})`;
  }

  // [unit, category, description, sen, day, paid by]
  const bills = [
    [U.share, 'electricity', 'TNB electricity', 60195, 28, 'owner'], [U.share, 'water', 'Air Selangor water', 4979, 28, 'owner'], [U.share, 'internet', 'Unifi internet', 10495, 5, 'owner'],
    [U.share, 'sewerage', 'Indah Water', 800, 28, 'owner'],
    ...Array.from({ length: 8 }, (_, k) => [U.share, 'cleaning', 'Basic cleaning', 8000, 2 + k * 3, 'owner']),
    [U.min, 'electricity', 'TNB electricity', 31200, 28, 'owner'], [U.min, 'water', 'Air Selangor water', 3200, 28, 'owner'], [U.min, 'internet', 'Unifi internet', 10495, 5, 'owner'],
    ...Array.from({ length: 3 }, (_, k) => [U.min, 'cleaning', 'Basic cleaning', 7500, 8 + k * 8, 'owner']),
    [U.min, 'maintenance', 'Replace shower head', 2105, 14, 'owner'],
    [U.grr, 'electricity', 'TNB electricity', 42000, 28, 'the_conts'], [U.grr, 'maintenance', 'Aircon repair', 45000, 17, 'the_conts'],
    [U.grr, 'cleaning', 'Deep cleaning', 13800, 25, 'the_conts'],
  ];
  for (const [i, [unit, category, description, amount, day, payer]] of bills.entries()) {
    await tx`INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, charge_to, created_at)
      VALUES (${`${PREFIX}exp-${i + 1}`}, ${unit}, ${category}, ${'[Demo] ' + description}, ${amount}, 'MYR', ${d(Math.min(day, lastDay))}, ${payer}, ${now})`;
  }

  // Owner credits and charges: a water refund to the owner, a maintenance fee charged to them.
  const credits = [
    [`${PREFIX}adj-water`, U.share, 'credit', 3830, 'Water overcharge refunded', 8],
    [`${PREFIX}adj-maint`, U.grr, 'charge', -22385, 'Maintenance fee charged to owner', 20],
  ];
  for (const [id, unit, kind, amount, description, day] of credits) {
    await tx`INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, state, source, created_at, updated_at)
      VALUES (${id}, ${OWNER}, ${unit}, ${kind}, ${amount}, ${'[Demo] ' + description}, ${d(day)}, 'open', 'manual', ${now}, ${now})
      ON CONFLICT (id) DO NOTHING`;
  }

  // Utility account numbers, so the monthly bills screen has lines to fill.
  const accounts = [
    [U.share, 'electricity', '220011223344', 'TNB'], [U.share, 'water', '880011223344', 'Air Selangor'], [U.share, 'internet', '1-DEMO4608', 'Unifi'], [U.share, 'sewerage', 'IWK-DEMO-4608', 'Indah Water'],
    [U.min, 'electricity', '220055667788', 'TNB'], [U.min, 'water', '880055667788', 'Air Selangor'], [U.min, 'internet', '1-DEMO1505', 'Unifi'],
    [U.grr, 'electricity', '220099001122', 'TNB'], [U.grr, 'water', '880099001122', 'Air Selangor'],
  ];
  for (const [unit, kind, no, provider] of accounts) {
    await tx`INSERT INTO unit_utility_accounts (id, unit_id, kind, account_no, provider, created_at, updated_at)
      VALUES (${`${PREFIX}acct-${unit.slice(PREFIX.length + 5)}-${kind}`}, ${unit}, ${kind}, ${no}, ${provider}, ${now}, ${now})
      ON CONFLICT (id) DO UPDATE SET account_no = EXCLUDED.account_no, provider = EXCLUDED.provider, updated_at = EXCLUDED.updated_at`;
  }
});

const counts = (await sql`SELECT
  (SELECT COUNT(*) FROM units WHERE id LIKE ${PREFIX + '%'})::int AS units,
  (SELECT COUNT(*) FROM reservations WHERE id LIKE ${PREFIX + '%'})::int AS bookings,
  (SELECT COUNT(*) FROM expenses WHERE id LIKE ${PREFIX + '%'})::int AS expenses,
  (SELECT COUNT(*) FROM owner_adjustments WHERE id LIKE ${PREFIX + '%'})::int AS credits`)[0];
console.log(`demo owner "[Demo] Tan Mei Ling" ready for ${month}: ${counts.units} units, ${counts.bookings} bookings, ${counts.expenses} expenses, ${counts.credits} credits and charges.`);
console.log('Open Owners and search "Demo". Generate the month on Finance, Statements to see the statement and the report. Remove with --clean.');
await sql.end();
