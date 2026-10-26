import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export interface Curtain { from: string; to: string; sub: string }

/** The hand-off between the Owner Showcase (Portfolio) and the sample owner portal (Owner): the icon turns and the
 *  word rolls (420 ms), a dark curtain rises (from 460 ms), the other view opens (1220 ms) and lifts its own curtain
 *  on arrival. The curtain travels in the navigation state, so the address stays clean. */
export function useSwitch(target: string, curtain: Curtain) {
  const navigate = useNavigate();
  const location = useLocation();
  const arrived = (location.state as { switched?: Curtain } | null)?.switched ?? null;
  const [rolled, setRolled] = useState(false);
  const [closing, setClosing] = useState<Curtain | null>(null);
  const [opening, setOpening] = useState<Curtain | null>(arrived);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!arrived) return;
    const t = window.setTimeout(() => setOpening(null), 900);
    // Forget the curtain, so a reload or Back does not play it again.
    navigate(location.pathname + location.search, { replace: true, state: null });
    return () => window.clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);

  const go = () => {
    if (rolled) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setRolled(true);
    timers.current.push(window.setTimeout(() => setClosing(curtain), reduced ? 0 : 460));
    // Replace, not push: the two views are one place, so Exit (one step back) always returns to the ERP page.
    timers.current.push(window.setTimeout(() => navigate(target, { replace: true, state: { switched: curtain } }), reduced ? 300 : 1220));
  };
  return { go, rolled, curtain: closing ? { c: closing, dir: 'in' as const } : opening ? { c: opening, dir: 'out' as const } : null };
}

/** Leaves the showcase (either view) for the ERP page it was opened from, else Showcase control. Inside the visual
 *  editor's frame it asks the control panel instead. */
export function useExit() {
  const navigate = useNavigate();
  return () => {
    if (window.parent !== window) { window.parent.postMessage('tc-exit', window.location.origin); return; }
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1); else navigate('/performance/showcase-control');
  };
}

export function SwitchButton({ current, next, rolled, onClick }: { current: string; next: string; rolled: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`sc-switch${rolled ? ' rolled' : ''}`} onClick={onClick} aria-label={`Switch to the ${next} view`}>
      <span className="sc-switch-icon" aria-hidden>⇄</span>
      <span className="sc-switch-label" style={{ color: 'var(--sc-muted)', fontWeight: 600 }}>Switch</span>
      <span className="sc-switch-roll" aria-hidden><span><span>{current}</span><span style={{ color: 'var(--sc-teal)' }}>{next}</span></span></span>
    </button>
  );
}

export function CurtainLayer({ curtain }: { curtain: { c: Curtain; dir: 'in' | 'out' } | null }) {
  if (!curtain) return null;
  return (
    <div className={`sc-curtain ${curtain.dir}`} role="status" aria-live="polite">
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', color: 'var(--sc-teal-eyebrow)' }}>SWITCHING VIEW</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 'clamp(30px, 6vw, 44px)', fontWeight: 800, letterSpacing: '-0.03em' }}>
        <span style={{ color: 'var(--sc-muted)' }}>{curtain.c.from}</span>
        <span className="sc-nudge">→</span>
        <span className="sc-curtain-to">{curtain.c.to}</span>
      </div>
      <div className="sc-curtain-sub">{curtain.c.sub}</div>
    </div>
  );
}
