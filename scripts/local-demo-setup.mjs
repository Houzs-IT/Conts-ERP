// Loads the fake demo data into a LOCAL Postgres for development and for
// scripts/check-*.mjs, and gives every demo login the same known password.
//
//   DATABASE_URL=postgresql://pos_app:...@127.0.0.1:PORT/db node scripts/local-demo-setup.mjs
//
// Refuses any database that is not on this machine. Never run this against Supabase:
// the accounts it creates have a public, well-known password.
// RE-RUN: safe (upserts, and the base seed is loaded only when the tables are empty).
import { readFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import postgres from 'postgres';

const url = process.env.DATABASE_URL ?? '';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) { console.error('Refusing: DATABASE_URL must point at localhost.'); process.exit(1); }
const PW = process.env.DEMO_PASSWORD ?? 'LocalTest1';

const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PW), 'PBKDF2', false, ['deriveBits']);
const hash = `pbkdf2$100000$${hex(salt)}$${hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256)))}`;

const sql = postgres(url, { max: 1, prepare: false });
const [{ n }] = await sql`select count(*)::int as n from users`;
if (n === 0) {
  for (const f of ['demo-data-1.sql', 'demo-data-2.sql']) await sql.unsafe(readFileSync(`scripts/${f}`, 'utf8'));
  console.log('base demo data loaded');
}
// The owner seed defines its own August statement for the same owners; drop the base
// ones first (SQLite used to replace them silently, Postgres rightly refuses a duplicate).
await sql`delete from payouts where id like 'demo-pay-%'`;
await sql`delete from statement_lines where id like 'demo-line-%'`;
await sql`delete from owner_statements where id like 'demo-stmt-%'`;
await sql`delete from maintenance_issues where id like 'demo-mnt-%'`; // the owner seed has its own pending quote
await sql.unsafe(readFileSync('scripts/seed-owner-demo.sql', 'utf8').replaceAll('REPLACE_WITH_HASH', hash));
// A technician for the field app's repair screens (the base seed has none).
await sql`insert into users (id, email, full_name, phone, password_hash, role, must_change_password, created_at, updated_at)
  values ('11111111-1111-4111-8111-000000000006', 'hafiz@theconts.com', 'Hafiz Rahman', '+60123456706', ${hash}, 'technician', 0, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')
  on conflict (id) do nothing`;
// The demo accounts arrive after every migration ran, so 0146 never placed them: run it again (each step only touches
// accounts with no department, or roles not yet retired) to give them a department and position.
await sql.begin(tx => tx.unsafe(readFileSync('migrations-pg/0146_retire_office_roles.sql', 'utf8')));
await sql`update users set password_hash = ${hash}`;
console.log(`demo logins ready, password: ${PW}`);
await sql.end();
