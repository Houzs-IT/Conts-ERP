// npm run check: every standards check in one go (docs/UI-STANDARDS.md). Exits 1 if any fails.
// CHECK_QUIET=1 prints only the per-check totals.
import { runCheck } from './_lib.mjs';
import { def as formatting } from './formatting.mjs';
import { def as colours } from './colours.mjs';
import { def as dialogs } from './no-browser-dialogs.mjs';
import { cjk, emoji } from './english-only.mjs';
import { def as pills } from './status-pills.mjs';
import { def as session } from './require-session.mjs';
import { def as audit } from './require-audit.mjs';
import { def as rawInputs } from './no-raw-inputs.mjs';
import { def as mytDates } from './myt-dates.mjs';
import { def as csvFormula } from './csv-formula.mjs';
import { def as permission, extraSelfTest as permissionSelfTest } from './require-permission.mjs';

const checks = [formatting, colours, dialogs, cjk, emoji, pills, session, audit, rawInputs, mytDates, csvFormula, permission];
let total = 0;
for (const p of permissionSelfTest()) { console.log(`FAIL require-permission self-test: ${p}`); total++; }
for (const c of checks) total += runCheck(c);
console.log(total ? `\n${total} violation${total === 1 ? '' : 's'} across ${checks.length} checks.` : `\nAll ${checks.length} checks pass.`);
process.exit(total ? 1 : 0);
