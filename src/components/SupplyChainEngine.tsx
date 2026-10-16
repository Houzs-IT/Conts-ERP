import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from './Button';
import { api, errorMessage } from '../lib/api';
import { menuPathFor } from '../lib/scmEngine';
import { color } from '../theme';

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The supply chain engine's screen for the current menu item, shown inside this app. The server signs
 *  the person into the engine once; after that the frame stays loaded and is told where to go as the
 *  menu changes, so moving between supply chain screens does not reload it. */
export default function SupplyChainEngine({ enginePath }: { enginePath: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [started, setStarted] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const site = useRef('');
  const wanted = useRef(enginePath);
  wanted.current = enginePath;
  const location = useLocation();
  const navigate = useNavigate();
  const here = useRef(location.pathname);
  here.current = location.pathname;
  // The menu address the frame moved to by itself: following it must not steer the frame back to the list.
  const followed = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    setStarted(false);
    api.post<{ site: string; token: string; sessionPass: string | null }>('/supply-chain/engine-session')
      .then(r => {
        if (!live) return;
        site.current = r.site;
        // In the fragment: never sent to a server, and the engine removes it as soon as it has read it.
        setSrc(`${r.site}/#conts=${b64url(JSON.stringify({ t: r.token, sp: r.sessionPass ?? undefined, p: wanted.current }))}`);
      })
      .catch(e => { if (live) setError(errorMessage(e, 'The supply chain screens could not be opened.')); });
    return () => { live = false; };
  }, [attempt]);

  // Never a loading message for good: an engine that does not say it is showing (an older build) is revealed anyway.
  useEffect(() => {
    if (!src) return;
    const t = window.setTimeout(() => setStarted(true), 20000);
    return () => window.clearTimeout(t);
  }, [src]);

  const steer = () => { if (site.current) frame.current?.contentWindow?.postMessage({ type: 'conts:navigate', path: wanted.current }, site.current); };
  // On every menu click, the item already open included (location.key changes), so it leaves a record. The path is
  // watched too: an address typed or changed in the bar twice in a row keeps the same key ("default").
  useEffect(() => {
    if (followed.current === location.pathname) { followed.current = null; return; }
    steer();
  }, [location.key, location.pathname, src]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== site.current || e.source !== frame.current?.contentWindow) return;
      // The engine says when it has started, in case a menu click arrived before it was listening.
      if (e.data?.type === 'conts:ready') steer();
      if (e.data?.type === 'conts:shown') setStarted(true);
      // A link inside the frame moved it: the address and the menu follow, without a new history entry.
      if (e.data?.type === 'conts:location' && typeof e.data.path === 'string') {
        const to = menuPathFor(e.data.path);
        if (to && to !== here.current) { followed.current = to; navigate(to, { replace: true }); }
      }
    };
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
  const opening = <div style={{ padding: '24px 28px', fontSize: 13.5, color: color.textMuted }}>Opening supply chain…</div>;
  if (!src) return opening;
  // The frame loads underneath; the message stays over it until the engine shows a screen.
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <iframe ref={frame} src={src} title="Supply chain"
        style={{ flex: 1, width: '100%', minHeight: 0, border: 'none', display: 'block', background: color.page }} />
      {!started && <div style={{ position: 'absolute', inset: 0, background: color.page }}>{opening}</div>}
    </div>
  );
}
