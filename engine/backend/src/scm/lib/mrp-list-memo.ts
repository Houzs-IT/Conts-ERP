/* The list screens' status chips run the whole MRP on every open, about 1.5 s each, to say the same thing they said a
   moment ago. They may lag it by a few seconds; the MRP page, the SO drill-down and every write still compute fresh.
   Results only, never a promise: a Worker refuses to wait on I/O begun by another request. */

const TTL_MS = 20_000;
const held = new Map<string, { at: number; value: unknown }>();

export async function withListMemo<T>(key: string, compute: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const hit = held.get(key);
  if (hit && now() - hit.at < TTL_MS) return hit.value as T;
  const value = await compute();
  held.set(key, { at: now(), value });
  return value;
}

export function clearListMemo(): void {
  held.clear();
}
