import { api } from '../../lib/api';

export interface BulkChange { unitId: string; channel: string; nights: number; oldMin: number; oldMax: number; newMin: number; newMax: number }
export interface BulkBody {
  unitIds: string[]; channels: string[]; weekdays: number[] | null;
  lines: { from: string; to: string; baseRate?: number; weekendRate?: number; adjustPct?: number; minStay?: number | null; stopSell?: boolean }[];
}
export interface BulkResult { written: number; nights: number; skipped: Record<string, number>; syncFailed: number; changes: BulkChange[]; done: string[] }

/** Price rows per request. The server takes up to 20,000 (functions/api/rates/bulk.ts MAX_ROWS); a smaller slice
 *  keeps each request well inside one Worker's CPU time and lets the screen show progress. */
const ROWS_PER_REQUEST = 6000;
const MAX_UNITS_PER_REQUEST = 25;

/** The units split into requests of at most ROWS_PER_REQUEST price rows each. */
export function chunkUnits(unitIds: string[], nights: number, channels: number): string[][] {
  const perUnit = Math.max(1, nights * Math.max(1, channels));
  const size = Math.max(1, Math.min(MAX_UNITS_PER_REQUEST, Math.floor(ROWS_PER_REQUEST / perUnit)));
  const out: string[][] = [];
  for (let i = 0; i < unitIds.length; i += size) out.push(unitIds.slice(i, i + size));
  return out;
}

/**
 * POST /rates/bulk a few units at a time, one request after another. `skip` names units already saved by an
 * earlier attempt, so a retry after a failure never applies a percentage twice. On a failure the units saved so
 * far are in the thrown error's `done`.
 */
export async function runBulk(body: BulkBody, opts: { dryRun: boolean; nights: number; batch: string; skip?: Set<string>; onProgress?: (done: number, total: number) => void }): Promise<BulkResult> {
  const todo = body.unitIds.filter(id => !opts.skip?.has(id));
  const chunks = chunkUnits(todo, opts.nights, body.channels.length);
  const res: BulkResult = { written: 0, nights: 0, skipped: {}, syncFailed: 0, changes: [], done: [] };
  opts.onProgress?.(0, todo.length);
  for (const unitIds of chunks) {
    try {
      const r = await api.post<{ written?: number; rows?: number; nights?: number; skipped?: Record<string, number>; syncFailed?: number; changes?: BulkChange[] }>(
        '/rates/bulk', { ...body, unitIds, ...(opts.dryRun ? { dryRun: true } : { batch: opts.batch }) });
      res.written += (opts.dryRun ? r?.rows : r?.written) ?? 0;
      res.nights = r?.nights ?? res.nights;
      for (const [c, n] of Object.entries(r?.skipped ?? {})) res.skipped[c] = (res.skipped[c] ?? 0) + n;
      res.syncFailed += r?.syncFailed ?? 0;
      res.changes.push(...(r?.changes ?? []));
      res.done.push(...unitIds);
      opts.onProgress?.(res.done.length, todo.length);
    } catch (e) {
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { done: res.done });
    }
  }
  return res;
}
