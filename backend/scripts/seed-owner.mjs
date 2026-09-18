// One-time: give an existing Supabase Auth user the Owner role, so there is a
// first account that can invite everyone else from the UI.
//
//   node scripts/seed-owner.mjs you@company.com
//
// The login must already exist in Supabase Auth (invite yourself from the
// Supabase dashboard first). Reads DATABASE_URL, SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY from .dev.vars or the environment.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!email) {
  console.error('Usage: node scripts/seed-owner.mjs <email>');
  process.exit(1);
}

const vars = (() => {
  try {
    return readFileSync('.dev.vars', 'utf8');
  } catch {
    return '';
  }
})();
const read = (name) => process.env[name] ?? vars.match(new RegExp(`${name}="([^"]+)"`))?.[1];

const url = read('DATABASE_URL');
const supabaseUrl = read('SUPABASE_URL');
const serviceKey = read('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !supabaseUrl || !serviceKey) {
  console.error('Need DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
console.log(`Target database: ${url.match(/postgres\.([a-z0-9]{20})/)?.[1] ?? 'unknown'}`);

const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=200`, {
  headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
});
if (!res.ok) {
  console.error(`Supabase said: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const { users } = await res.json();
const user = users.find((u) => (u.email ?? '').toLowerCase() === email);
if (!user) {
  console.error(`No Supabase Auth user with email ${email}. Invite that address in the Supabase dashboard first.`);
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, ssl: url.includes('localhost') ? undefined : 'require' });

const [role] = await sql`select id from app.roles where code = 'owner'`;
if (!role) {
  console.error('No owner role found. Run the migration first.');
  await sql.end();
  process.exit(1);
}

await sql`
  insert into app.profiles (id, email, full_name)
  values (${user.id}, ${email}, ${user.user_metadata?.full_name ?? email})
  on conflict (id) do update set email = excluded.email, is_active = true
`;
await sql`insert into app.user_roles (user_id, role_id) values (${user.id}, ${role.id}) on conflict do nothing`;
await sql`
  insert into app.audit_log (actor_id, action, entity, entity_id, after)
  values (${user.id}, 'owner.seed', 'profile', ${user.id}, ${sql.json({ email })})
`;

const perms = await sql`select count(*)::int as n from app.user_permissions(${user.id})`;
console.log(`${email} is now Owner with ${perms[0].n} permissions.`);
await sql.end();
