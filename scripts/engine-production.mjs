// Puts the supply chain engine (engine/) on PRODUCTION, one step at a time. Run by the owner:
//   node scripts/engine-production.mjs <step>
// Steps, in order:  prepare  storage  secrets  deploy  seed  screens  switch-on
// Each step says what it did and what comes next. Passwords and keys are read from, and written to, the
// gitignored files in C:/dev/Conts-ERP-deploy; none is ever printed. Every step that touches Cloudflare or
// the database first checks that it is pointed at Conts's production and nothing else.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRETS = 'C:/dev/Conts-ERP-deploy';
const PROD_REF = 'cweomoenhsjvsxfsmiiw';
const DB_VARS = `${SECRETS}/.dev.vars.production`;
const ENGINE_VARS = `${SECRETS}/.dev.vars.engine-production`;   // the engine worker's secrets
const SSO_VARS = `${SECRETS}/.dev.vars.scm-sso-production`;      // the same sign-on secret, for Property OS
const BACKEND = path.join(ROOT, 'engine/backend');
const FRONTEND = path.join(ROOT, 'engine/frontend');
const CONFIG = path.join(BACKEND, 'wrangler.production.toml');
const WORKER = 'conts-scm-engine', KV = 'conts-scm-session', BUCKET = 'theconts-scm', HYPERDRIVE = 'conts-scm-engine-prod', SITE = 'theconts-scm-live';

const say = (...a) => console.log(...a);
const stop = (m) => { console.error(`\nSTOPPED: ${m}\nNothing further was done.`); process.exit(1); };
const read = (file, key) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').match(new RegExp(`^${key}="([^"]*)"`, 'm'))?.[1] ?? null;
const put = (file, key, value) => {
  let s = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const line = `${key}="${value}"`;
  s = new RegExp(`^${key}=`, 'm').test(s) ? s.replace(new RegExp(`^${key}=.*$`, 'm'), line) : s.replace(/\s*$/, '') + (s.trim() ? '\n' : '') + line + '\n';
  fs.writeFileSync(file, s);
};
const random = () => crypto.randomBytes(32).toString('base64url');

/** Runs wrangler from a folder without a shell, so nothing in an argument is re-read by one. */
function wrangler(cwd, args, { quiet = false } = {}) {
  const bin = path.join(cwd, 'node_modules/wrangler/bin/wrangler.js');
  if (!fs.existsSync(bin)) stop(`wrangler is not installed in ${cwd} (run npm install there).`);
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', stdio: quiet ? 'pipe' : ['inherit', 'pipe', 'pipe'] });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (!quiet) process.stdout.write(out);
  return { ok: r.status === 0, out };
}

function adminUrl() {
  const url = read(DB_VARS, 'DATABASE_URL');
  if (!url) stop(`DATABASE_URL is not in ${DB_VARS}.`);
  if (!url.includes(PROD_REF)) stop('The database in .dev.vars.production is not the Conts production project.');
  return url;
}

/** The config must name only Conts's production things. Checked before anything is sent to Cloudflare. */
function checkConfig({ needIds = true } = {}) {
  const t = fs.readFileSync(CONFIG, 'utf8');
  const bad = [];
  if (!new RegExp(`^name = "${WORKER}"$`, 'm').test(t)) bad.push(`the worker is not named ${WORKER}`);
  for (const b of t.matchAll(/bucket_name = "([^"]+)"/g)) if (b[1] !== BUCKET) bad.push(`storage bucket ${b[1]} is not ${BUCKET}`);
  if (/^\s*(route|routes|workers_dev\s*=\s*false|\[triggers\]|\[\[queues|\[\[services|\[\[d1_databases|\[\[analytics_engine|\[\[durable_objects|account_id)/m.test(t)) bad.push('it has routes, scheduled jobs, queues or another account, which this instance must not have');
  if (!/AUTOCOUNT_SYNC_DISABLED = "true"/.test(t) || !/AUTOCOUNT_API_URL = "https:\/\/autocount\.invalid\/"/.test(t)) bad.push('AutoCount is not switched off');
  if (/^\s*BETA_ENABLED\s*=/m.test(t)) bad.push('it switches Beta on, which is for staging only');
  if (/houzs(?!_OWNS_2990)/i.test(t.replace(/HOUZS_OWNS_2990/g, ''))) bad.push('it mentions Houzs');
  if (needIds && /FILL_/.test(t)) bad.push('the storage step has not filled in the ids yet (run: storage)');
  if (bad.length) stop(`engine/backend/wrangler.production.toml is not safe to use: ${bad.join('; ')}.`);
  return t;
}

const steps = {
  /** Database password for the engine's own role, then the five pending migrations. */
  async prepare() {
    adminUrl();
    if (!read(DB_VARS, 'SCM_ENGINE_PASSWORD')) { put(DB_VARS, 'SCM_ENGINE_PASSWORD', random()); say('Created a password for the engine\'s database role (saved in .dev.vars.production, not shown).'); }
    else say('The engine\'s database password already exists.');
    say('\nNEXT, run these two yourself (preview, then apply). The preview must show the production database');
    say(`(${PROD_REF}) and only migrations 0044 to 0048 pending:\n`);
    say('  node scripts/migrate-pg.mjs --env-file=C:/dev/Conts-ERP-deploy/.dev.vars.production --dry-run');
    say('  node scripts/migrate-pg.mjs --env-file=C:/dev/Conts-ERP-deploy/.dev.vars.production');
    say('\nThe apply must end with "scm_engine password set." and "Applied 5." Then run: storage');
  },

  /** Storage bucket, session store and database connection on Cloudflare; their ids go into the config. */
  async storage() {
    checkConfig({ needIds: false });
    const admin = adminUrl();
    const pw = read(DB_VARS, 'SCM_ENGINE_PASSWORD');
    if (!pw) stop('Run the prepare step first.');
    const conn = admin.replace(/postgres\.([a-z0-9]{20}):[^@]+@/, (_, ref) => `scm_engine.${ref}:${encodeURIComponent(pw)}@`);
    if (conn === admin || !conn.includes(`scm_engine.${PROD_REF}`)) stop('Could not build the engine\'s database connection from .dev.vars.production (expected the pooler form postgres.<project>:...@).');

    // These account-level commands run with the newer wrangler at the repo root: the engine's own older copy
    // is refused when it lists session stores.
    say(`Storage bucket ${BUCKET} ...`);
    const b = wrangler(ROOT, ['r2', 'bucket', 'create', BUCKET], { quiet: true });
    say(b.ok ? '  created.' : /already exists|10004/i.test(b.out) ? '  already exists.' : '  ' + b.out.trim().split('\n').pop());
    if (!b.ok && !/already exists|10004/i.test(b.out)) stop('The storage bucket could not be created.');

    say(`Session store ${KV} ...`);
    let list = wrangler(ROOT, ['kv', 'namespace', 'list'], { quiet: true });
    const kvIdOf = (out) => { try { return JSON.parse(out.slice(out.indexOf('['))).find((n) => n.title === KV)?.id ?? null; } catch { return null; } };
    let kvId = kvIdOf(list.out);
    if (!kvId) {
      const c = wrangler(ROOT, ['kv', 'namespace', 'create', KV], { quiet: true });
      kvId = c.out.match(/id\s*[=:]\s*"([0-9a-f]{32})"/)?.[1] ?? kvIdOf(wrangler(ROOT, ['kv', 'namespace', 'list'], { quiet: true }).out);
      if (!kvId) stop('The session store could not be created: ' + c.out.trim().split('\n').pop());
      say('  created.');
    } else say('  already exists.');

    say(`Database connection ${HYPERDRIVE} ...`);
    const hdIdOf = () => wrangler(ROOT, ['hyperdrive', 'list'], { quiet: true }).out.split('\n').find((l) => l.includes(HYPERDRIVE))?.match(/[0-9a-f]{32}/)?.[0] ?? null;
    let hdId = hdIdOf();
    if (!hdId) {
      const c = wrangler(ROOT, ['hyperdrive', 'create', HYPERDRIVE, `--connection-string=${conn}`, '--caching-disabled'], { quiet: true });
      hdId = c.out.match(/"?id"?\s*[=:]\s*"([0-9a-f]{32})"/)?.[1] ?? hdIdOf();
      // The output is not echoed: on failure it can repeat the connection string.
      if (!hdId) stop('The database connection could not be created. Check that the prepare step\'s migrations were applied (the role scm_engine must exist with its password), then run this step again.');
      say('  created.');
    } else say('  already exists.');

    let t = fs.readFileSync(CONFIG, 'utf8');
    t = t.replace(/(\[\[hyperdrive\]\]\s*\nbinding = "HYPERDRIVE"\s*\nid = ")[^"]*(")/, `$1${hdId}$2`).replace(/(binding = "SESSION_CACHE"\s*\nid = ")[^"]*(")/, `$1${kvId}$2`);
    fs.writeFileSync(CONFIG, t);
    checkConfig();
    say('\nThe two ids are written into engine/backend/wrangler.production.toml (they are not secrets).');
    say('NEXT: run: secrets');
  },

  /** The engine's secrets file, then its upload. Two keys come from the Supabase dashboard, pasted by the owner. */
  async secrets() {
    checkConfig();
    const fresh = !fs.existsSync(ENGINE_VARS);
    if (fresh) {
      const sso = random();
      for (const [k, v] of [['SUPABASE_URL', `https://${PROD_REF}.supabase.co`], ['SUPABASE_SERVICE_ROLE_KEY', 'PASTE_SERVICE_ROLE_KEY_HERE'], ['SUPABASE_ANON_KEY', 'PASTE_ANON_KEY_HERE'],
        ['SESSION_SIGNING_KEY', random()], ['DASHBOARD_API_KEY', random()], ['CONNECT_SERVICE_TOKEN', random()], ['AUTOCOUNT_API_KEY', random()], ['CONTS_SSO_SECRET', sso]]) put(ENGINE_VARS, k, v);
      put(SSO_VARS, 'SCM_ENGINE_SSO_SECRET', sso);
    }
    const service = read(ENGINE_VARS, 'SUPABASE_SERVICE_ROLE_KEY'), anon = read(ENGINE_VARS, 'SUPABASE_ANON_KEY');
    if (!service || !anon || /PASTE_/.test(service + anon)) {
      say(`${fresh ? 'Created' : 'Found'} ${ENGINE_VARS} with new random secrets.`);
      say('\nTwo values must come from Supabase, and only you can copy them:');
      say(`  1. Open https://supabase.com/dashboard/project/${PROD_REF}/settings/api-keys`);
      say('  2. Open the file above in Notepad.');
      say('  3. Replace PASTE_SERVICE_ROLE_KEY_HERE with the "service_role" key, and PASTE_ANON_KEY_HERE with the "anon" key.');
      say('     Keep the quotes around them. Save. Do not paste them in chat.');
      say(`  4. In the same Supabase project: Settings > Data API > Exposed schemas: add "scm", then Save.`);
      say('\nThen run this step again: secrets');
      return;
    }
    // A Supabase key names its project inside it; refuse a key from the staging project.
    for (const [name, key] of [['service_role', service], ['anon', anon]]) {
      try { const ref = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).ref; if (ref && ref !== PROD_REF) stop(`The ${name} key in the file belongs to another Supabase project (${ref}), not production.`); } catch { /* a newer key format carries no project: nothing to check */ }
    }
    const tmp = path.join(BACKEND, '.secrets-upload.json');
    const all = Object.fromEntries(fs.readFileSync(ENGINE_VARS, 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_0-9]+)="(.*)"$/)).filter(Boolean).map((m) => [m[1], m[2]]));
    fs.writeFileSync(tmp, JSON.stringify(all));
    const r = wrangler(BACKEND, ['secret', 'bulk', tmp, '--config', CONFIG, '--name', WORKER], { quiet: true });
    fs.rmSync(tmp, { force: true });
    if (!r.ok) {
      if (/not found|does not exist|10007/i.test(r.out)) { say('The worker does not exist yet, so its secrets cannot be stored before the first deploy.\nNEXT: run: deploy   (then run: secrets once more)'); return; }
      stop('Cloudflare did not take the secrets: ' + r.out.trim().split('\n').filter((l) => !/eyJ|sb_/.test(l)).pop());
    }
    say(`${Object.keys(all).length} secrets stored on ${WORKER}.`);
    say('NEXT: run: deploy   (if you have already deployed, run: seed)');
  },

  /** The engine's server. */
  async deploy() {
    checkConfig();
    say(`Deploying ${WORKER} to the Conts ERP account ...\n`);
    const r = wrangler(BACKEND, ['deploy', '--config', CONFIG]);
    if (!r.ok) stop('The deploy failed (see above).');
    const url = r.out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/)?.[0];
    say(`\nDeployed${url ? ' at ' + url : ''}.`);
    if (url && url !== `https://${WORKER}.conts-erp.workers.dev`) say(`NOTE: the address is not the expected https://${WORKER}.conts-erp.workers.dev. Tell Claude before going on.`);
    say('NEXT: run: secrets   (to store or refresh the secrets on it), then: seed');
  },

  /** The starter lists the forms need (Malaysian localities, dropdown options, and so on). Rehearses unless --apply. */
  async seed() {
    const { default: postgres } = await import('postgres');
    const APPLY = process.argv.includes('--apply');
    const body = fs.readFileSync(path.join(BACKEND, 'scripts/scm-schema/seed-scm-reference-data.sql'), 'utf8')
      .replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '')
      .replace(/ON CONFLICT \([^)]*\) DO NOTHING/g, 'ON CONFLICT DO NOTHING')
      .replace(/INSERT INTO scm\.so_settings \(key, enabled, label\)\s*VALUES \('pos_product_remark', true, '([^']*)'\)/,
        "INSERT INTO scm.so_settings (key, enabled, label, company_id) VALUES ('pos_product_remark', true, '$1', (SELECT id FROM public.companies ORDER BY id LIMIT 1))");
    const sql = postgres(adminUrl(), { max: 1, prepare: false, ssl: 'require', onnotice: () => {} });
    const counts = (tx) => tx`select (select count(*)::int from scm.my_localities) localities, (select count(*)::int from scm.so_dropdown_options) dropdowns,
      (select count(*)::int from scm.categories) categories, (select count(*)::int from scm.size_library) sizes, (select count(*)::int from scm.accounts) accounts`;
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        say(APPLY ? 'Loaded:' : 'Rehearsal (nothing kept):', JSON.stringify((await counts(tx))[0]));
        if (!APPLY) throw new Error('ROLLBACK_ON_PURPOSE');
      });
      say('NEXT: run: screens');
    } catch (e) {
      if (e.message === 'ROLLBACK_ON_PURPOSE') say('That was only a rehearsal. If the numbers look right (about 2,900 localities), run: seed --apply');
      else { await sql.end(); stop('The starter lists did not load: ' + e.message); }
    }
    await sql.end();
  },

  /** The engine's screens, as their own Pages project pointed at the production server. */
  async screens() {
    if (!fs.existsSync(path.join(FRONTEND, 'dist/index.html'))) stop('The screens are not built. In engine/frontend run: npm run build   then this step again.');
    const stage = path.join(FRONTEND, '.deploy-live');
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage);
    fs.cpSync(path.join(FRONTEND, 'dist'), path.join(stage, 'dist'), { recursive: true });
    fs.cpSync(path.join(FRONTEND, 'functions'), path.join(stage, 'functions'), { recursive: true });
    fs.writeFileSync(path.join(stage, 'wrangler.toml'), `name = "${SITE}"\ncompatibility_date = "2024-12-01"\npages_build_output_dir = "./dist"\n\n[vars]\nAPI_ORIGIN = "https://${WORKER}.conts-erp.workers.dev"\n`);
    const c = wrangler(FRONTEND, ['pages', 'project', 'create', SITE, '--production-branch', 'main'], { quiet: true });
    say(c.ok ? `Site ${SITE} created.` : /already exists|8000002/i.test(c.out) ? `Site ${SITE} already exists.` : c.out.trim().split('\n').pop());
    // wrangler is run from engine/frontend (where it is installed) against the staged copy.
    const bin = path.join(FRONTEND, 'node_modules/wrangler/bin/wrangler.js');
    const r = spawnSync(process.execPath, [bin, 'pages', 'deploy', '--branch', 'main', '--commit-dirty=true'], { cwd: stage, encoding: 'utf8' });
    process.stdout.write(`${r.stdout ?? ''}${r.stderr ?? ''}`);
    fs.rmSync(stage, { recursive: true, force: true });
    if (r.status !== 0) stop('The screens were not published (see above).');
    say(`\nPublished. The screens should answer at https://${SITE}.pages.dev within a minute.`);
    say('NEXT: run: switch-on');
  },

  /** The sign-on secret on the live Property OS project. The engine is used once the change that names it is merged. */
  async 'switch-on'() {
    if (!read(SSO_VARS, 'SCM_ENGINE_SSO_SECRET')) stop('Run the secrets step first.');
    const r = wrangler(ROOT, ['pages', 'secret', 'bulk', SSO_VARS, '--project-name=theconts-os'], { quiet: true });
    if (!r.ok) stop('The sign-on secret was not stored: ' + r.out.trim().split('\n').pop());
    say('The sign-on secret is stored on the live Property OS project (it takes effect at the next deploy).');
    say('\nLAST STEP: tell Claude it is done. After a check that the engine answers, you merge the pull request');
    say('that names the engine for the live site; that deploy is what switches supply chain over.');
  },
};

const step = process.argv[2];
if (!steps[step]) { say('Usage: node scripts/engine-production.mjs <step>\nSteps, in order: ' + Object.keys(steps).join('  ')); process.exit(step ? 1 : 0); }
await steps[step]();
