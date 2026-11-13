import { useCallback, useEffect, useRef } from 'react';
import { SeedGate } from './seedGate';

/**
 * Fills an edit form from `data` once per record `id`: the first answer for that id calls `seed`; later answers for
 * the same id (the fresh copy after the kept one, a timed re-read) leave the form as it is being typed. A new id fills
 * it again. Returns `reseed`: call it after a save, before reloading, so the record read back fills the form once more.
 */
export function useSeedOnce<D>(data: D | null | undefined, id: string, seed: (data: D) => void): () => void {
  const gate = useRef<SeedGate | null>(null);
  gate.current ??= new SeedGate();
  const latest = useRef(seed);
  latest.current = seed;
  useEffect(() => {
    if (data != null && gate.current!.due(id, true)) latest.current(data);
  }, [data, id]);
  return useCallback(() => gate.current!.again(), []);
}
