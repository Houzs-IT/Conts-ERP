// One-off: adds the two-step sign-in key (TOTP_ENC_KEY) to the Pages project theconts-os, once for the
// live site and once for staging, each with its own random key. The keys are never printed; a copy of each
// is kept in C:/dev/Conts-ERP-deploy so it can be put back if the Cloudflare project is ever rebuilt.
// A key that already exists is left alone: replacing it would stop every enrolled authenticator working.
//   node scripts/add-two-step-key.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRETS = 'C:/dev/Conts-ERP-deploy';
const wrangler = (args) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), ...args], { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

for (const [label, file, env] of [['live site', '.dev.vars.totp-production', []], ['staging', '.dev.vars.totp-preview', ['--env', 'preview']]]) {
  const list = wrangler(['pages', 'secret', 'list', '--project-name=theconts-os', ...env]);
  if (!list.ok) { console.log(`${label}: could not read the existing secrets, nothing changed. ${list.out.trim().split('\n').pop()}`); continue; }
  if (/TOTP_ENC_KEY/.test(list.out)) { console.log(`${label}: the key is already there. Left alone.`); continue; }
  const keep = `${SECRETS}/${file}`;
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, `TOTP_ENC_KEY="${crypto.randomBytes(32).toString('base64')}"\n`);
  const put = wrangler(['pages', 'secret', 'bulk', keep, '--project-name=theconts-os', ...env]);
  console.log(put.ok ? `${label}: key added. Copy kept in ${keep}` : `${label}: NOT added. ${put.out.trim().split('\n').pop()}`);
}
console.log('\nA new key takes effect at that site\'s next publish.');
