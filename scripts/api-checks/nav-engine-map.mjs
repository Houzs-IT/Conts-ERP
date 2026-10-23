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
// Property OS screens in the supply chain menu, not engine ones: IT Support and finance's own desk screens.
const PROPERTY_OS_SUPPLY = ['/supply/it-support', '/supply/finance/payables', '/supply/finance/utility-bills', '/supply/finance/approvals'];
const unmapped = paths(M.navFor('management', true)).filter((p) => !M.ENGINE_PATH[p] && !PROPERTY_OS_SUPPLY.includes(p) && (M.workspaceOf(p) === 'supply'));
check('every supply chain menu entry opens an engine screen', unmapped.length === 0, unmapped.join(' '));
check('Project list and Schedule open the engine views that switch to renovation by themselves',
  M.ENGINE_PATH['/projects/list'] === '/projects?view=list' && M.ENGINE_PATH['/projects/calendar'] === '/projects?view=calendar');

// Project monitor was dropped (owner, 11 Oct 2026): off the menu, and not an engine address, so an engine screen
// never resolves to it; its old links open the Schedule (App.tsx).
check('Project monitor is on no menu', !paths(M.navFor('management', true)).includes('/projects/monitor'));
check('Project monitor is not an engine address', !('/projects/monitor' in M.ENGINE_PATH), M.ENGINE_PATH['/projects/monitor']);

// Finance in both sidebars (finance phase 1, PR 3): the ledger screens open the engine, under the Ledger area.
const rentalPaths = (groups) => paths(groups.filter((g) => g.workspace === 'rental'));
const supplyPaths = (groups) => paths(groups.filter((g) => g.workspace === 'supply'));
check('there are ledger screens', Array.isArray(M.LEDGER_SCREENS) && M.LEDGER_SCREENS.length >= 12);
check('Ledger setup is one of them, opening its engine page (finance phase 1, PR 6)', M.LEDGER_SCREENS?.some((x) => x.slug === 'ledger-setup' && x.enginePath === '/scm/ledger-setup'));
for (const s of M.LEDGER_SCREENS ?? []) {
  for (const [menu, side] of [[`/finance/${s.slug}`, 'rental'], [`/supply/finance/${s.slug}`, 'supply']]) {
    check(`${s.label} is in the ${side} Finance menu, under the Ledger area, opening ${s.enginePath}`,
      (side === 'rental' ? rentalPaths : supplyPaths)(M.navFor('management', true)).includes(menu)
        && M.areaOfPath(menu) === 'ledger' && M.ENGINE_PATH[menu] === s.enginePath && M.workspaceOf(menu) === side,
      `${M.areaOfPath(menu)} ${M.ENGINE_PATH[menu]} ${M.workspaceOf(menu)}`);
  }
}
const ledgerMenus = (groups) => paths(groups).filter((p) => M.areaOfPath(p) === 'ledger');
check('the ledger screens are hidden where the engine is not set up', ledgerMenus(M.navFor('management', false)).length === 0);
check('an operations manager does not see the ledger screens', ledgerMenus(M.navFor('operations_manager', true)).length === 0);
check('a role with Ledger None does not see them', ledgerMenus(M.navFor('finance_admin', true, { ledger: 'none' })).length === 0);
const ledgerOnly = M.navFor('finance_admin', true, { finance: 'none', ledger: 'view' });
check('a role with only the Ledger sees them without the rest of Finance',
  ledgerMenus(ledgerOnly).length > 0 && !paths(ledgerOnly).includes('/finance/payables'));
for (const p of ['/supply/finance/payables', '/supply/finance/utility-bills', '/supply/finance/approvals']) {
  check(`${p} is in the supply chain Finance menu, keeps the supply chain sidebar, under the Finance area`,
    supplyPaths(M.navFor('management', true)).includes(p) && M.workspaceOf(p) === 'supply' && M.areaOfPath(p) === 'finance' && !M.ENGINE_PATH[p]);
}
check('the old payment vouchers and payables pages are off the supply chain map',
  M.workspaceOf('/procurement/payment-vouchers') === null && M.workspaceOf('/accounting') !== 'supply');

// An engine screen with a menu address on both sides stays on the side it was opened from (Task 6).
const stays = (engine, current, want) => check(`${engine} opened from ${current} resolves to ${want}`, M.menuPathFor(engine, current) === want, M.menuPathFor(engine, current));
stays('/scm/payment-vouchers/abc', '/supply/finance/payment-vouchers', '/supply/finance/payment-vouchers');
stays('/scm/payment-vouchers/abc', '/finance/payment-vouchers', '/finance/payment-vouchers');
stays('/scm/accounting?tab=tb', '/supply/finance/trial-balance', '/supply/finance/trial-balance');
stays('/scm/sales-orders/1', '/finance/payment-vouchers', '/sales/orders');
// Moving inside the engine between two ledger screens keeps the side too: the P&L's drill-down into the general
// ledger (report-layout.ts), a receipt opened from a payment voucher.
stays('/scm/accounting?tab=gl&accounts=310-0010&from=2026-08-01&to=2026-08-31', '/finance/profit-and-loss', '/finance/general-ledger');
stays('/scm/receipts/abc', '/finance/payment-vouchers', '/finance/money-received');
stays('/scm/accounting?tab=gl', '/supply/finance/trial-balance', '/supply/finance/general-ledger');
stays('/scm/receipts/abc', '/sales/orders', '/supply/finance/money-received');

// Approvals are off unless Settings turns them on (owner, 11 Oct 2026): hidden in both Finance groups.
const offPaths = M.withoutOffItems ? paths(M.withoutOffItems(M.navFor('management', true), false)) : ['(withoutOffItems missing)'];
check('switched-off Approvals is hidden in both sidebars', !offPaths.includes('/finance/approvals') && !offPaths.includes('/supply/finance/approvals'), offPaths.filter((p) => p.endsWith('approvals')).join(' '));
check('switched-on Approvals shows in both sidebars', M.withoutOffItems
  && ['/finance/approvals', '/supply/finance/approvals'].every((p) => paths(M.withoutOffItems(M.navFor('management', true), true)).includes(p)));
check('the old Payment vouchers and Payables & receivables addresses are off the menu map',
  M.areaOfPath('/procurement/payment-vouchers') === null && M.areaOfPath('/accounting') === null);

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

// The supply chain Finance group is the rental one again: like IT Support, it alone opens no supply chain workspace.
check('Finance alone does not open the supply chain workspace, and stays in Rental',
  supplyPaths(M.navFor('finance_admin', true, noSupply)).length === 0 && rentalPaths(M.navFor('finance_admin', true, noSupply)).includes('/finance/general-ledger'),
  supplyPaths(M.navFor('finance_admin', true, noSupply)).join(' '));
check('with supply chain work, Finance is in both sidebars', supplyPaths(M.navFor('management', true)).includes('/supply/finance/general-ledger'));

// Beta (owner, 23 Oct 2026): on the menu only where the engine answer says beta (staging), and it opens the engine's page.
check('Beta is off the menu unless beta is on', !paths(M.navFor('management', true)).includes('/beta/projects'));
check('Beta needs the engine as well', !paths(M.navFor('management', false, undefined, true)).includes('/beta/projects'));
check('Beta is on the menu with the engine and beta on', paths(M.navFor('management', true, undefined, true)).includes('/beta/projects'));
check('Beta follows the Projects area', !paths(M.navFor('operations_staff', true, { projects: 'none' }, true)).includes('/beta/projects'));
check('Beta opens the engine Beta list', M.ENGINE_PATH['/beta/projects'] === '/beta/projects');
check('an engine Beta workspace keeps Beta highlighted', M.menuPathFor('/beta/projects/12?tab=defects') === '/beta/projects', M.menuPathFor('/beta/projects/12?tab=defects'));

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
