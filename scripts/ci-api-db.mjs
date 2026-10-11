// Builds a throwaway local Postgres into the database the role checks expect (scripts/api-checks/role-access.mjs,
// rbac-matrix.mjs): every migration, the demo data, and the accounts those checks sign in as. Used by the
// rbac job in .github/workflows/ci.yml; runs the same on a local Postgres 16.
//
//   CI_DB_URL=postgres://postgres@127.0.0.1:5432/ci node scripts/ci-api-db.mjs
//
// Refuses any database that is not on this machine: the demo accounts it creates have a public password.
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';

const url = process.env.CI_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) { console.error('Refusing: CI_DB_URL must point at localhost.'); process.exit(1); }
const admin = postgres(url, { max: 1, onnotice: () => {} });

// What Supabase provides before the first migration runs: its API roles (migrations grant and revoke on them) and
// the extensions schema (0044 puts pg_trgm there).
for (const role of ['anon', 'authenticated', 'service_role']) {
  await admin.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`);
}
await admin`create schema if not exists extensions`;

const run = (script, env) => execFileSync('node', [script], { stdio: 'inherit', env: { ...process.env, ...env } });
// No POS_APP_PASSWORD: the role's password is shared by every database on the server, and trust auth ignores it.
run('scripts/migrate-pg.mjs', { DATABASE_URL: url, POS_APP_PASSWORD: '' });
run('scripts/local-demo-setup.mjs', { DATABASE_URL: url.replace(/\/\/[^@]*@/, '//pos_app:local@') });

// The demo data has no operations staff account; harness.mjs signs in as this one.
await admin.unsafe(`insert into pos.users (id, email, full_name, password_hash, role, must_change_password, locale, is_active, created_at, updated_at)
  select '11111111-1111-4111-8111-000000000004', 'weiwen@theconts.com', 'Chan Wei Wen', password_hash, 'operations_staff', 0, 'en-MY', 1, now(), now()
  from pos.users where id = '11111111-1111-4111-8111-000000000002'
  on conflict (id) do nothing`);
// rbac-matrix links two owners that have final statements to its own owner accounts; the demo owner logins hold them.
await admin.unsafe(`update pos.owners set user_id = null
  where user_id in (select id from pos.users where role = 'owner' and email not like 'rbac.%')`);
console.log('ci database ready');
await admin.end();
