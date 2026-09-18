#!/usr/bin/env node
/**
 * One command from clone to running: npm run setup
 *
 * Creates the D1 database, applies every migration, generates an admin password,
 * seeds demo data, and writes .dev.vars. Safe to re-run — each step checks first
 * and skips what already exists.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const DB = 'theconts-prod';
const run = (cmd, quiet = false) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' }); }
  catch (e) { return null; }
};
const say = (s) => console.log(s);
const step = (n, s) => console.log(`\n\u001b[1m${n}.\u001b[0m ${s}`);

async function hash(password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `pbkdf2$100000$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}

const randomSecret = () =>
  [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');

say('\n\u001b[1mThe Conts Property OS \u2014 local setup\u001b[0m');

// 1. Database
step(1, 'Database');
const list = run(`npx wrangler d1 list --json`, true) ?? '[]';
const exists = list.includes(DB);
if (exists) {
  say(`   ${DB} already exists, skipping.`);
} else {
  say(`   Creating ${DB}\u2026`);
  const out = run(`npx wrangler d1 create ${DB}`, true);
  const id = out?.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
  if (id) {
    // Both configs bind the same database: the Pages app and the cron Worker.
    // Patching only one leaves the other on the placeholder and its deploy fails.
    for (const file of ['wrangler.toml', 'wrangler.cron.toml']) {
      let toml = readFileSync(file, 'utf8');
      toml = toml.replaceAll('REPLACE_ME_PROD_D1_ID', id);
      writeFileSync(file, toml);
    }
    say(`   Wrote database_id into wrangler.toml and wrangler.cron.toml.`);
  } else {
    say(`   \u001b[33mCreated, but could not read the id. Paste it into both wrangler.toml and wrangler.cron.toml.\u001b[0m`);
  }
}

// 2. Migrations
step(2, 'Migrations');
run(`npx wrangler d1 migrations apply ${DB} --local`);

// 3. Admin account
step(3, 'Admin account');
const rl = createInterface({ input: process.stdin, output: process.stdout });
const email = (await rl.question('   Admin email [aina@theconts.com]: ')).trim() || 'aina@theconts.com';
const password = (await rl.question('   Admin password [Password1]: ')).trim() || 'Password1';
rl.close();

if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
  say('   \u001b[31mPassword must be 8+ characters with an uppercase letter and a digit.\u001b[0m');
  process.exit(1);
}

const pwHash = await hash(password);
const now = new Date().toISOString();
const adminSql = `
INSERT OR REPLACE INTO users (id, email, full_name, password_hash, role, must_change_password, locale, is_active, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000001', '${email}', 'Administrator', '${pwHash}', 'management', 0, 'en-MY', 1, '${now}', '${now}');
`;
writeFileSync('.setup-admin.sql', adminSql);
run(`npx wrangler d1 execute ${DB} --local --file=./.setup-admin.sql`);
run('rm -f .setup-admin.sql');

// 4. Demo data
step(4, 'Demo data');
let seed = readFileSync('scripts/seed-d1.sql', 'utf8');
seed = seed.replaceAll('REPLACE_WITH_HASH', pwHash);
writeFileSync('.setup-seed.sql', seed);
run(`npx wrangler d1 execute ${DB} --local --file=./.setup-seed.sql`);
run('rm -f .setup-seed.sql');
say('   Demo accounts use the same password as the admin.');

// 5. Local secrets
step(5, 'Local secrets');
if (existsSync('.dev.vars')) {
  say('   .dev.vars already exists, leaving it alone.');
} else {
  writeFileSync('.dev.vars', `SESSION_SECRET="${randomSecret()}"\n`);
  say('   Wrote .dev.vars with a fresh SESSION_SECRET.');
  say('   Mail and WhatsApp keys are optional \u2014 without them, sends record as queued.');
}

say(`
\u001b[1mReady.\u001b[0m

  npm run dev        \u2192  http://localhost:8788
  Sign in as         \u2192  ${email}

Before deploying:
  npx wrangler d1 migrations apply ${DB} --remote
  npx wrangler secret put SESSION_SECRET
  npm run deploy
`);
