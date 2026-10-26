import { useCallback, useEffect, useRef, useState } from 'react';
import { api, notifyFailure } from '../../lib/api';
import { refreshNavCounts } from '../../lib/navBadges';
import { OVERRIDES_CHANNEL, type FigureKey, type Overrides } from './model';

type Change = { key: FigureKey; value?: number | null; active?: boolean };

/** The company's showcase overrides: read once, saved through PUT /api/showcase/overrides, shared at once with
 *  other tabs and the visual editor's frame (BroadcastChannel), and re-read every 30 seconds so a showcase open on
 *  another device follows the control panel (polling is the realtime mechanism here, no sockets). */
export function useOverrides(initial: Overrides | undefined) {
  const [ov, setOv] = useState<Overrides>(initial ?? {});
  const channel = useRef<BroadcastChannel | null>(null);
  const seeded = useRef(false);

  useEffect(() => { if (initial && !seeded.current) { seeded.current = true; setOv(initial); } }, [initial]);

  const refresh = useCallback(() => {
    api.get<{ overrides: Overrides }>('/showcase/overrides').then(r => setOv(r.overrides)).catch(() => { /* the next poll tries again */ });
  }, []);

  useEffect(() => {
    const bc = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(OVERRIDES_CHANNEL);
    channel.current = bc;
    if (bc) bc.onmessage = e => { if (e.data && typeof e.data === 'object') { setOv(e.data as Overrides); void refreshNavCounts(); } };
    const t = window.setInterval(refresh, 30_000);
    return () => { window.clearInterval(t); bc?.close(); channel.current = null; };
  }, [refresh]);

  const send = useCallback(async (body: { changes: Change[] } | { resetAll: true }) => {
    try {
      const r = await api.put<{ overrides: Overrides }>('/showcase/overrides', body);
      setOv(r.overrides);
      channel.current?.postMessage(r.overrides);
      void refreshNavCounts();
      return true;
    } catch (e) { notifyFailure(e); refresh(); return false; }
  }, [refresh]);

  return {
    ov,
    /** Store a typed value and show it. */
    apply: (key: FigureKey, value: number) => send({ changes: [{ key, value, active: true }] }),
    /** Switch between the live figure and the stored override. */
    setActive: (key: FigureKey, active: boolean) => send({ changes: [{ key, active }] }),
    /** Forget the typed value: back to live for good. */
    clear: (key: FigureKey) => send({ changes: [{ key, value: null }] }),
    resetAll: () => send({ resetAll: true }),
  };
}
