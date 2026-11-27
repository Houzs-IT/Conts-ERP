import { type Env, fail } from '../../_lib/db';
import { verifyExport } from '../../_lib/mcpActions';
import { XLSX_TYPE } from '../../_lib/mcpXlsx';

/**
 * GET /api/mcp/export?k&e&s: a PDF (get_pdf), an Excel file (export_excel) or an annotated screenshot (show_me) the AI
 * Connector made for a person,
 * downloaded from the link it gave them.
 * Public in the session middleware, because the link is opened from the AI app's chat; the link itself is the
 * credential: an HMAC over the file's key and its expiry (signed with SESSION_SECRET, 15 minutes), made only after
 * the person's own read of the document succeeded (functions/_lib/mcpActionTools.ts). Only files under mcp-exports/.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const u = new URL(request.url);
  const key = u.searchParams.get('k') ?? '', exp = u.searchParams.get('e') ?? '', sig = u.searchParams.get('s') ?? '';
  const v = await verifyExport(env.SESSION_SECRET, key, exp, sig, Date.now());
  if (v === 'expired') return fail('EXPIRED', 'This download link has expired. Ask the AI for the file again.', 410);
  if (v !== 'ok') return fail('NOT_FOUND', 'That download link is not valid.', 404);
  const obj = env.MEDIA ? await env.MEDIA.get(key) : null;
  if (!obj) return fail('NOT_FOUND', 'That file is no longer there. Ask the AI for the file again.', 404);
  const name = key.split('/').pop() || 'document.pdf';
  // show_me's annotated screenshot (functions/_lib/mcpShowMe.ts): a page of our own making, shown in the browser, with
  // nothing able to run or load in it (the picture is inline).
  if (name.toLowerCase().endsWith('.html')) {
    return new Response(obj.body, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'",
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }
  const type = name.toLowerCase().endsWith('.xlsx') ? XLSX_TYPE : 'application/pdf';
  return new Response(obj.body, {
    headers: {
      'content-type': type,
      'content-disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
};
