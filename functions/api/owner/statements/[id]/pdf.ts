import type { Env } from '../../../../_lib/db';
import { onRequestGet as printable } from '../../../statements/pdf';

/** GET /api/owner/statements/:id/pdf — the owner-safe print view (the handler itself checks it is their statement and final). */
export const onRequestGet: PagesFunction<Env> = (ctx) => {
  const url = new URL(ctx.request.url);
  url.searchParams.set('id', String(ctx.params.id));
  return printable({ ...ctx, request: new Request(url.toString(), ctx.request) } as Parameters<typeof printable>[0]);
};
