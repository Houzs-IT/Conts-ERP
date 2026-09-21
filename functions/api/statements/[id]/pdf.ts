import type { Env } from '../../../_lib/db';
import { onRequestGet as printable } from '../pdf';

/** GET /api/statements/:id/pdf — the same print-ready document as /api/statements/pdf?id=. */
export const onRequestGet: PagesFunction<Env> = (ctx) => {
  const url = new URL(ctx.request.url);
  url.searchParams.set('id', String(ctx.params.id));
  return printable({ ...ctx, request: new Request(url.toString(), ctx.request) } as Parameters<typeof printable>[0]);
};
