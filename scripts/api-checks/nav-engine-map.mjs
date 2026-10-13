// The Property OS menu against the engine screen map (src/lib/navigation.ts, src/lib/scmEngine.ts):
// every engine-only entry opens an engine screen, Quotations opens the engine's renovation quotations
// list under the Sales order area, and engine-only entries are hidden where the engine is not set up.
// Pure code check, no server: node scripts/api-checks/nav-engine-map.mjs
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = await build({
  stdin: { contents: `export * from './src/lib/navigation.ts';\nexport * from './src/lib/scmEngine.ts';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
});
const tmp = mkdtempSync(join(tmpdir(), 'nav-check-'));
writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
const M = await import(pathToFileURL(join(tmp, 'm.mjs')).href);

let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' :: ' + extra}`); };
const paths = (groups) => groups.flatMap((g) => g.items.flatMap((i) => [i.path, ...(i.children ?? []).map((c) => c.path)])).filter(Boolean);

const all = paths(M.navFor('management', true));
check('Quotations is on the menu with the engine', all.includes('/sales/quotations'), all.join(' '));
check('Quotations opens the engine renovation quotations list', M.ENGINE_PATH['/sales/quotations'] === '/scm/renovation/quotations', M.ENGINE_PATH['/sales/quotations']);
check('Quotations belongs to the Sales order area (the engine guards it with scm.sales.orders)', M.areaOfPath('/sales/quotations') === 'scSales', M.areaOfPath('/sales/quotations'));
check('Quotations is under Supply chain > Sales order', M.findNav('/sales/quotations')?.group === 'Sales order', JSON.stringify(M.findNav('/sales/quotations')));
check('Quotations is hidden where the engine is not set up', !paths(M.navFor('management', false)).includes('/sales/quotations'));
check('a role with no Sales order access does not see it', !paths(M.navFor('operations_staff', true, { scSales: 'none' })).includes('/sales/quotations'));
// IT Support is a Property OS screen in the supply chain menu, not an engine one.
const unmapped = paths(M.navFor('management', true)).filter((p) => !M.ENGINE_PATH[p] && p !== '/supply/it-support' && (M.workspaceOf(p) === 'supply'));
check('every supply chain menu entry opens an engine screen', unmapped.length === 0, unmapped.join(' '));
check('Project list and Schedule open the engine views that switch to renovation by themselves',
  M.ENGINE_PATH['/projects/list'] === '/projects?view=list' && M.ENGINE_PATH['/projects/calendar'] === '/projects?view=calendar');

check('Project monitor is on the menu and opens the engine monitor view',
  paths(M.navFor('management', true)).includes('/projects/monitor') && M.ENGINE_PATH['/projects/monitor'] === '/projects?view=monitor', M.ENGINE_PATH['/projects/monitor']);
check('Project monitor is hidden where the engine is not set up', !paths(M.navFor('management', false)).includes('/projects/monitor'));

// Consignment is switched off for Conts (owner, 11 Oct 2026): off every menu, its addresses open Home.
const consignment = ['/consignment/order', '/sales/consignment-notes', '/consignment/return', '/procurement/consignment', '/consignment/purchase-receive', '/consignment/purchase-return'];
check('consignment is on no menu', !paths(M.navFor('management', true)).some((p) => consignment.includes(p)) && !paths(M.navFor('management', false)).some((p) => consignment.includes(p)));
check('consignment addresses are switched off, sales orders are not', consignment.every((p) => M.switchedOff(p)) && !M.switchedOff('/sales/orders') && !M.switchedOff('/accounting/credit-notes'));

// IT Support in the supply chain menu: the same screen as System > IT Support, kept in the supply chain workspace.
const supply = (groups) => paths(groups.filter((g) => g.workspace === 'supply'));
check('IT Support is in the supply chain menu', supply(M.navFor('management', true)).includes('/supply/it-support'));
check('IT Support is still in the rental menu', paths(M.navFor('management', true).filter((g) => g.workspace === 'rental')).includes('/system/it-support'));
check('the supply chain IT Support address keeps the supply chain sidebar', M.workspaceOf('/supply/it-support') === 'supply', M.workspaceOf('/supply/it-support'));
check('the supply chain IT Support address is not an engine screen', !M.ENGINE_PATH['/supply/it-support']);
const noSupply = Object.fromEntries(['serviceCases', 'projects', 'scSales', 'scConsignment', 'scProcurement', 'scTransportPlan', 'scWarehouse', 'scInvoices'].map((a) => [a, 'none']));
check('IT Support alone does not open the supply chain workspace', supply(M.navFor('operations_staff', true, noSupply)).length === 0, supply(M.navFor('operations_staff', true, noSupply)).join(' '));
check('a field role gets no supply chain IT Support', !supply(M.navFor('housekeeper', true)).includes('/supply/it-support'));

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
