/** The company ledger's screens in the engine (finance phase 1), in the Finance group of both sidebars at
 *  /finance/<slug> and /supply/finance/<slug>, under the Ledger permission area. */
export interface LedgerScreen { slug: string; label: string; enginePath: string }
export const LEDGER_SCREENS: readonly LedgerScreen[] = [
  { slug: 'payment-vouchers', label: 'Payment vouchers', enginePath: '/scm/payment-vouchers' },
  { slug: 'money-received', label: 'Money received', enginePath: '/scm/receipts' },
  { slug: 'bank-reconciliation', label: 'Bank reconciliation', enginePath: '/scm/bank-recon' },
  { slug: 'journal-entries', label: 'Journal entries', enginePath: '/scm/accounting?tab=je' },
  { slug: 'general-ledger', label: 'General ledger', enginePath: '/scm/accounting?tab=gl' },
  { slug: 'trial-balance', label: 'Trial balance', enginePath: '/scm/accounting?tab=tb' },
  { slug: 'profit-and-loss', label: 'Profit and loss', enginePath: '/scm/accounting?tab=pnl' },
  { slug: 'balance-sheet', label: 'Balance sheet', enginePath: '/scm/accounting?tab=bs' },
  { slug: 'debtor-ageing', label: 'Debtor ageing', enginePath: '/scm/accounting?tab=ar' },
  { slug: 'creditor-ageing', label: 'Creditor ageing', enginePath: '/scm/accounting?tab=ap' },
  { slug: 'chart-of-accounts', label: 'Chart of accounts', enginePath: '/scm/chart-of-accounts' },
  { slug: 'item-group-accounts', label: 'Item group accounts', enginePath: '/scm/accounting?tab=groups' },
  // The day the books start and the fiscal year end (finance phase 1, PR 6).
  { slug: 'ledger-setup', label: 'Ledger setup', enginePath: '/scm/ledger-setup' },
  // Every other finance screen in the engine (chew, 2 Nov 2026: Payment requests could not be found; the menu lacked them).
  { slug: 'payment-requests', label: 'Payment requests', enginePath: '/scm/payment-requests' },
  { slug: 'limit-requests', label: 'Limit requests', enginePath: '/scm/limit-requests' },
  { slug: 'petty-cash', label: 'Petty cash', enginePath: '/scm/petty-cash' },
  { slug: 'ap-invoices', label: 'AP invoices', enginePath: '/scm/ap-invoices' },
  { slug: 'supplier-ledger', label: 'Supplier ledger', enginePath: '/scm/party-ledger?kind=creditor' },
  { slug: 'deposit-invoices', label: 'Deposit invoices', enginePath: '/scm/deposit-invoices' },
  { slug: 'other-debtors', label: 'Other debtors', enginePath: '/scm/other-debtors' },
  { slug: 'credit-debit-notes', label: 'Credit / debit notes', enginePath: '/scm/credit-notes' },
  { slug: 'not-yet-billed', label: 'Not yet billed', enginePath: '/scm/unbilled-deliveries' },
  { slug: 'e-invoice', label: 'E-invoice', enginePath: '/scm/einvoice' },
  { slug: 'official-receipts', label: 'Official receipts', enginePath: '/scm/official-receipts' },
  { slug: 'debtors', label: 'Debtors', enginePath: '/scm/debtors' },
  { slug: 'customer-ledger', label: 'Customer ledger', enginePath: '/scm/party-ledger?kind=debtor' },
  { slug: 'outstanding', label: 'Outstanding', enginePath: '/scm/outstanding' },
  { slug: 'daily-bank', label: 'Daily bank', enginePath: '/scm/daily-bank' },
  { slug: 'merchant-recon', label: 'Merchant recon', enginePath: '/scm/merchant-recon' },
  { slug: 'rental-unit-costs', label: 'Rental unit costs', enginePath: '/scm/rental-unit-costs' },
  { slug: 'department-spend', label: 'Spending by department', enginePath: '/scm/department-spend' },
  { slug: 'renovation-projects', label: 'Renovation projects', enginePath: '/scm/reno-projects' },
  // What the AI bill reader costs and how often it answers (TODO item 19, Houzs AI Usage).
  { slug: 'ai-usage', label: 'AI usage', enginePath: '/scm/ai-usage' },
];

function ledgerPaths(prefix: string): Record<string, string> {
  return Object.fromEntries(LEDGER_SCREENS.map(s => [`${prefix}/${s.slug}`, s.enginePath]));
}

/** Each Supply chain menu destination here (service cases and projects included) and the screen it opens
 *  in the supply chain engine (Houzs's screens, see engine/). Keep in step with the SUPPLY CHAIN group in
 *  navigation.ts. */
export const ENGINE_PATH: Record<string, string> = {
  '/service/cases': '/assr?view=cases',
  '/service/metrics': '/assr?view=metrics',
  '/service/maintenance': '/assr?view=settings',
  '/service/my-cases': '/my-cases',
  // The renovation project list and calendar (Beta's Home and Calendar until 3 Nov 2026) at the old Project list and
  // Schedule addresses, so old links open them. Project monitor's old links move to the Calendar (App.tsx).
  '/projects/list': '/beta/projects',
  '/projects/calendar': '/beta/calendar',
  '/projects/finances': '/projects?view=finances',
  '/projects/maintenance': '/projects?view=maintenance',
  '/sales/quotations': '/scm/renovation/quotations',
  '/sales/orders': '/scm/sales-orders',
  '/sales/amendments': '/scm/amendments',
  '/sales/delivery-orders': '/scm/delivery-orders',
  '/sales/invoices': '/scm/sales-invoices',
  '/sales/returns': '/scm/delivery-returns',
  '/consignment/order': '/scm/consignment-orders',
  '/sales/consignment-notes': '/scm/consignment-notes',
  '/consignment/return': '/scm/consignment-returns',
  '/procurement/consignment': '/scm/purchase-consignment-orders',
  '/consignment/purchase-receive': '/scm/purchase-consignment-receives',
  '/consignment/purchase-return': '/scm/purchase-consignment-returns',
  '/procurement/products': '/scm/products',
  '/procurement/suppliers': '/scm/suppliers',
  '/procurement/mrp': '/scm/mrp',
  '/procurement/purchase-orders': '/scm/purchase-orders',
  '/production/production-orders': '/scm/production-orders',
  '/production/sku-composition': '/scm/sku-composition',
  '/production/draft-delivery': '/scm/draft-delivery',
  '/procurement/po-amendments': '/scm/po-amendments',
  '/procurement/cancellations': '/scm/cancel-requests',
  '/procurement/goods-received': '/scm/grns',
  '/procurement/purchase-invoices': '/scm/purchase-invoices',
  '/procurement/purchase-returns': '/scm/purchase-returns',
  '/transport/planning': '/scm/delivery-planning',
  '/transport/dp-orders': '/scm/dp-orders',
  '/transport/delivery-dates': '/scm/auto-schedule',
  '/transport/delivery-times': '/scm/trips',
  '/transport/last-mile': '/scm/fleet-day',
  '/procurement/loading-list': '/scm/loading-list',
  '/procurement/warehouses': '/scm/warehouses',
  '/procurement/racks': '/scm/warehouses/racks',
  '/procurement/stock': '/scm/inventory',
  '/procurement/adjustments': '/scm/stock-adjustments',
  '/procurement/stock-transfers': '/scm/stock-transfers',
  '/procurement/stock-takes': '/scm/stock-takes',
  '/accounting/credit-notes': '/scm/credit-notes',
  '/mail': '/mail-center',
  '/mail/mailboxes': '/team?tab=mail2',
  ...ledgerPaths('/finance'),
  ...ledgerPaths('/supply/finance'),
};

/** Of the engine addresses above, only the Rental Finance group's sit in the rental sidebar. */
const inRental = (menu: string) => menu.startsWith('/finance/');

/** The menu destination an engine address sits under (its screen or a record on it), longest match first;
 *  null when none does. On a tie (one engine screen with a menu address in both sidebars) the address open now
 *  wins, then the one on the same side as it, so the sidebar never jumps; otherwise the later entry. */
export function menuPathFor(enginePath: string, current?: string | null): string | null {
  let tied: string[] = [];
  let len = 0;
  for (const [menu, eng] of Object.entries(ENGINE_PATH)) {
    if (!enginePath.startsWith(eng) || eng.length < len) continue;
    const next = enginePath.charAt(eng.length);
    if (!(next === '' || (eng.includes('?') ? next === '&' : next === '/' || next === '?'))) continue;
    if (eng.length > len) { tied = []; len = eng.length; }
    tied.push(menu);
  }
  if (tied.length === 0) return null;
  if (current && tied.includes(current)) return current;
  const sameSide = current ? tied.filter(m => inRental(m) === inRental(current)) : [];
  return (sameSide.length ? sameSide : tied)[(sameSide.length ? sameSide : tied).length - 1];
}
