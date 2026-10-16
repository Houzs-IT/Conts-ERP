/** Each Supply chain menu destination here (service cases and projects included) and the screen it opens
 *  in the supply chain engine (Houzs's screens, see engine/). Keep in step with the SUPPLY CHAIN group in
 *  navigation.ts. */
export const ENGINE_PATH: Record<string, string> = {
  '/service/cases': '/assr?view=cases',
  '/service/metrics': '/assr?view=metrics',
  '/service/maintenance': '/assr?view=settings',
  '/service/my-cases': '/my-cases',
  '/projects/list': '/projects?view=list',
  // Project monitor was dropped (owner, 11 Oct 2026: the Schedule covers it); old links open the Schedule.
  '/projects/monitor': '/projects?view=calendar',
  '/projects/calendar': '/projects?view=calendar',
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
};

/** The menu destination an engine address sits under (its screen or a record on it), longest match first;
 *  null when none does. On a tie the later entry wins, so the Schedule, not the old Project monitor address. */
export function menuPathFor(enginePath: string): string | null {
  let best: string | null = null;
  let len = 0;
  for (const [menu, eng] of Object.entries(ENGINE_PATH)) {
    if (!enginePath.startsWith(eng) || eng.length < len) continue;
    const next = enginePath.charAt(eng.length);
    if (next === '' || (eng.includes('?') ? next === '&' : next === '/' || next === '?')) { best = menu; len = eng.length; }
  }
  return best;
}
