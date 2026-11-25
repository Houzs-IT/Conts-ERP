import { type Env, fail } from '../../_lib/db';
import { verifyExport } from '../../_lib/mcpActions';

/**
 * GET /api/mcp/export?k&e&s: a PDF the AI Connector made for a person (get_pdf), downloaded from the link it gave them.
 * Public in the session middleware, because the link is opened from the AI app's chat; the link itself is the
 * credential: an HMAC over the file's key and its expiry (signed with SESSION_SECRET, 15 minutes), made only after
 * the person's own read of the document succeeded (functions/_lib/mcpActionTools.ts). Only files under mcp-exports/.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const u = new URL(request.url);
  const key = u.searchParams.get('k') ?? '', exp = u.searchParams.get('e') ?? '', sig = u.searchParams.get('s') ?? '';
  const v = await verifyExport(env.SESSION_SECRET, key, exp, sig, Date.now());
  if (v === 'expired') return fail('EXPIRED', 'This download link has expired. Ask the AI for the PDF again.', 410);
  if (v !== 'ok') return fail('NOT_FOUND', 'That download link is not valid.', 404);
  const obj = env.MEDIA ? await env.MEDIA.get(key) : null;
  if (!obj) return fail('NOT_FOUND', 'That file is no longer there. Ask the AI for the PDF again.', 404);
  const name = key.split('/').pop() || 'document.pdf';
  return new Response(obj.body, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
};
