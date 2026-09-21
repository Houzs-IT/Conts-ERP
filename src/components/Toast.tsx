import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { TONE } from '../lib/vocabulary';
import type { Tone } from '../lib/types';

interface Toast { id: number; tone: Tone; title: string; body?: string }

const Ctx = createContext<{ push: (t: Omit<Toast, 'id'>) => void } | null>(null);

/** A toast is never the only record of something the user must revisit. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems(xs => [...xs, { ...t, id }]);
    setTimeout(() => setItems(xs => xs.filter(x => x.id !== id)), 5200);
  }, []);

  useEffect(() => {
    const onFail = (e: Event) => push({ tone: 'critical', title: 'That change was not saved.', body: String((e as CustomEvent).detail ?? 'Try again in a moment.') });
    window.addEventListener('conts:save-failed', onFail);
    return () => window.removeEventListener('conts:save-failed', onFail);
  }, [push]);

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div
        aria-live="polite"
        style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 70, display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'flex-end' }}
      >
        {items.map(t => (
          <div
            key={t.id}
            style={{
              display: 'flex', flexDirection: 'column', gap: 4, minWidth: 290, maxWidth: 390,
              padding: '13px 15px', borderRadius: 'var(--radius-card)',
              background: 'var(--color-surface-card)', border: '1px solid var(--color-border-default)',
              borderLeft: `3px solid ${TONE[t.tone].fg}`, boxShadow: 'var(--shadow-overlay)',
              animation: 'toast-in var(--motion-standard) var(--ease-out) both',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: TONE[t.tone].fg }}>{t.title}</span>
              <button
                onClick={() => setItems(xs => xs.filter(x => x.id !== t.id))}
                aria-label="Dismiss"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex' }}
              >
                <X size={14} strokeWidth={1.75} />
              </button>
            </div>
            {t.body && <span style={{ fontSize: 12, color: 'var(--color-text-muted)', textWrap: 'pretty' }}>{t.body}</span>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx.push;
}
