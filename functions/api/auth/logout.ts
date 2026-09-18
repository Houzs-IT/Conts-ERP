import { type Env } from '../../_lib/db';
import { clearCookie } from '../../_lib/auth';

export const onRequestPost: PagesFunction<Env> = async ({ request }) =>
  new Response(null, { status: 204, headers: { 'set-cookie': clearCookie(request) } });
