import { ApiFailure } from './api';

/**
 * Runs one existing endpoint per ticked row, a few at a time, for bulk actions that have no bulk endpoint of their
 * own. Every row still goes through its endpoint's own role checks and audit. Returns what worked and, for the rest,
 * the reason each endpoint gave.
 */
export async function runEach<T>(items: T[], fn: (item: T) => Promise<unknown>, label: (item: T) => string, concurrency = 4) {
  const failed: { label: string; reason: string }[] = [];
  let ok = 0, next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      try { await fn(item); ok++; }
      catch (e) { failed.push({ label: label(item), reason: e instanceof ApiFailure ? e.message : 'Failed.' }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { ok, failed };
}

/** "3 left alone: A-12 (already finished), B-3 (…) …" for a toast body. */
export function skippedNote(failed: { label: string; reason: string }[]) {
  if (!failed.length) return '';
  const shown = failed.slice(0, 3).map(f => `${f.label} (${f.reason.replace(/\.$/, '').toLowerCase()})`).join(', ');
  return `${failed.length} left alone: ${shown}${failed.length > 3 ? ' …' : ''}.`;
}
