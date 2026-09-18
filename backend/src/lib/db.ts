import postgres from 'postgres';
import type { Env } from './types';

/**
 * One connection per request. In the Worker the connection comes from
 * Hyperdrive (which pools and keeps the link warm); locally it comes from
 * DATABASE_URL in .dev.vars, which must point at STAGING, never production.
 */
export function getDb(env: Env) {
  const viaHyperdrive = env.HYPERDRIVE?.connectionString;
  const url = viaHyperdrive ?? env.DATABASE_URL;
  if (!url) throw new Error('No database connection: set DATABASE_URL (.dev.vars) or bind HYPERDRIVE');

  return postgres(url, {
    max: 5,
    prepare: false,
    fetch_types: false,
    // Hyperdrive terminates TLS itself; a direct connection must require it.
    ssl: viaHyperdrive ? undefined : 'require',
  });
}
