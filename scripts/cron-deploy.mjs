// Puts the scheduled worker (theconts-cron, wrangler.cron.toml) live. GitHub runs it on merge (deploy-cron.yml);
// it can also be run by hand from the repository:
//   npx wrangler login                 sign in to the "Conts ERP" Cloudflare account (the one theconts-os is in)
//   node scripts/cron-deploy.mjs       checks, then deploys
//   node scripts/cron-deploy.mjs --secrets   also asks for CHANNEX_API_KEY (typed at wrangler's prompt, never shown)
//
// Before sending anything it checks:
//   1. wrangler.cron.toml names worker theconts-cron and the same production database (Hyperdrive id) as wrangler.toml
//   2. the signed-in Cloudflare account is the one the theconts-os Pages project lives in (so it is not a personal account)
//   3. the code typechecks
// After deploying it lists which secrets the worker has, and says which are still missing.
// Nothing here prints a secret.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'wrangler.cron.toml');
const say = (...a) => console.log(...a);
const stop = (m) => { console.error(`\nSTOPPED: ${m}\nNothing was deployed.`); process.exit(1); };

function wrangler(args, { inherit = false } = {}) {
  const bin = path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js');
  if (!fs.existsSync(bin)) stop('wrangler is not installed here. Run npm ci first.');
  const r = spawnSync(process.execPath, [bin, ...args], { cwd: ROOT, encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe' });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// 1. the config
const cron = fs.readFileSync(CONFIG, 'utf8');
const pages = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
if (!/^name = "theconts-cron"\r?$/m.test(cron)) stop('wrangler.cron.toml does not name the worker theconts-cron.');
const prodHyperdrive = pages.split('[env.')[0].match(/\[\[hyperdrive\]\][^[]*?id = "([0-9a-f]+)"/)?.[1];
const cronHyperdrive = cron.match(/\[\[hyperdrive\]\][^[]*?id = "([0-9a-f]+)"/)?.[1];
if (!prodHyperdrive || cronHyperdrive !== prodHyperdrive) stop('wrangler.cron.toml does not use the production database of wrangler.toml.');
say('1. wrangler.cron.toml: worker theconts-cron, production database. OK');

// 2. the account
const who = wrangler(['whoami']);
if (!who.ok || /not authenticated/i.test(who.out)) stop('Not signed in to Cloudflare. Run: npx wrangler login');
const projects = wrangler(['pages', 'project', 'list']);
if (!projects.ok || !/\btheconts-os\b/.test(projects.out)) {
  stop('The signed-in Cloudflare account does not have the theconts-os Pages project, so it is not the Conts ERP account.\n' +
    'Run `npx wrangler logout`, then `npx wrangler login` with the Conts ERP account, and try again.');
}
say('2. Cloudflare account has theconts-os: it is the Conts ERP account. OK');

// 3. typecheck
const tsc = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', '.'], { cwd: ROOT, encoding: 'utf8' });
if (tsc.status !== 0) stop(`The code does not typecheck:\n${tsc.stdout}${tsc.stderr}`);
say('3. Typecheck. OK');

// deploy
say('\nDeploying theconts-cron ...');
if (!wrangler(['deploy', '--config', 'wrangler.cron.toml'], { inherit: true }).ok) stop('wrangler deploy failed (see above).');

if (process.argv.includes('--secrets')) {
  say('\nCHANNEX_API_KEY: paste the production Channex key at the prompt (it is not shown).');
  wrangler(['secret', 'put', 'CHANNEX_API_KEY', '--config', 'wrangler.cron.toml'], { inherit: true });
} else if (process.env.CRON_CHANNEX_API_KEY) {
  // From GitHub (deploy-cron.yml): the key comes from the repository secret and is handed to wrangler on its input.
  const bin = path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js');
  const r = spawnSync(process.execPath, [bin, 'secret', 'put', 'CHANNEX_API_KEY', '--config', 'wrangler.cron.toml'],
    { cwd: ROOT, encoding: 'utf8', input: process.env.CRON_CHANNEX_API_KEY });
  say(r.status === 0 ? '\nCHANNEX_API_KEY stored from the GitHub secret.' : '\nCHANNEX_API_KEY was NOT stored (wrangler refused).');
}

const list = wrangler(['secret', 'list', '--config', 'wrangler.cron.toml']);
const has = (k) => new RegExp(`"name":\\s*"${k}"`).test(list.out);
say('\nSecrets on theconts-cron:');
for (const [k, need] of [['CHANNEX_API_KEY', 'needed for the Channex outbox'], ['MAIL_API_KEY', 'optional, email copies'], ['WHATSAPP_TOKEN', 'optional, WhatsApp copies'], ['WHATSAPP_PHONE_ID', 'optional, WhatsApp copies']]) {
  say(`  ${has(k) ? 'set    ' : 'missing'}  ${k}  (${need})${has(k) ? '' : `  ->  npx wrangler secret put ${k} --config wrangler.cron.toml`}`);
}
say('\nDone. The jobs start on their next minute. Check them in Cloudflare > Workers > theconts-cron > Logs, or in System health.');
