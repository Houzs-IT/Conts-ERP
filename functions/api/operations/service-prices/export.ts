import { type Env, all, fail, mytToday } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { csvCell } from '../../../_lib/csv';
import { hasServicePrices, loadPrices, sheetRows, SHEET_COLUMNS, DOMAINS } from '../../../_lib/servicePrices';

/** GET /api/operations/service-prices/export?domain= — the item list with today's prices as a CSV for Excel: one row per
 *  item, or per item and layout for an item priced by layout. The same columns come back in through import. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Only the office sees service prices.', 403);
  if (!(await hasServicePrices(env))) return fail('NOT_CONFIGURED', 'Service prices need a database update (migration 0127) that is not applied yet.', 501);
  const domain = new URL(request.url).searchParams.get('domain');
  const scoped = !!domain && (DOMAINS as readonly string[]).includes(domain);
  const items = await all<any>(env, `SELECT * FROM service_items ${scoped ? 'WHERE domain = ?' : ''} ORDER BY domain, code`, ...(scoped ? [domain] : []));
  const today = mytToday();
  const lines = [SHEET_COLUMNS.map(csvCell).join(','), ...sheetRows(items, await loadPrices(env), today).map(r => r.map(csvCell).join(','))];
  // A BOM so Excel reads the file as UTF-8.
  return new Response('﻿' + lines.join('\r\n') + '\r\n', { headers: {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="service-prices-${scoped ? `${domain}-` : ''}${today}.csv"`,
  } });
};
