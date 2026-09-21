import { type Env, fail } from '../_lib/db';

/** Any /api path with no handler: a real 404, never the SPA page with a 200. */
export const onRequest: PagesFunction<Env> = () => fail('NOT_FOUND', 'That endpoint does not exist.', 404);
