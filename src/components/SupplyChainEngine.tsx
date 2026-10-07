import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { api, ApiFailure } from '../lib/api';
import { color } from '../theme';

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The supply chain engine's screen for the current menu item, shown inside this app. The server signs
 *  the person into the engine once; after that the frame stays loaded and is told where to go as the
 *  menu changes, so moving between supply chain screens does not reload it. */
export default function SupplyChainEngine({ enginePath }: { enginePath: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const site = useRef('');
  const wanted = useRef(enginePath);
  wanted.current = enginePath;

  useEffect(() => {
    let live = true;
    setError(null);
    api.post<{ site: string; token: string; sessionPass: string | null }>('/supply-chain/engine-session')
      .then(r => {
        if (!live) return;
        site.current = r.site;
        // In the fragment: never sent to a server, and the engine removes it as soon as it has read it.
        setSrc(`${r.site}/#conts=${b64url(JSON.stringify({ t: r.token, sp: r.sessionPass ?? undefined, p: wanted.current }))}`);
      })
      .catch(e => { if (live) setError(e instanceof ApiFailure ? e.message : 'The supply chain screens could not be opened.'); });
    return () => { live = false; };
  }, [attempt]);

  const steer = () => { if (site.current) frame.current?.contentWindow?.postMessage({ type: 'conts:navigate', path: wanted.current }, site.current); };
  useEffect(steer, [enginePath, src]);
  useEffect(() => {
    // The engine says when it has started, in case a menu click arrived before it was listening.
    const onMessage = (e: MessageEvent) => { if (e.origin === site.current && e.data?.type === 'conts:ready') steer(); };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (error) {
    return (
      <div style={{ padding: '24px 28px', display: 'flex', alignItems: 'center', gap: 12, fontSize: 13.5 }}>
        <span style={{ color: 'var(--color-critical-fg)' }}>{error}</span>
        <Button size="sm" variant="secondary" onClick={() => setAttempt(n => n + 1)}>Try again</Button>
      </div>
    );
  }
  if (!src) return <div style={{ padding: '24px 28px', fontSize: 13.5, color: color.textMuted }}>Opening supply chain…</div>;
  return <iframe ref={frame} src={src} title="Supply chain" style={{ flex: 1, width: '100%', minHeight: 0, border: 'none', display: 'block', background: color.page }} />;
}
