import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from './Toast';

interface Account { id: string; fullName: string; email: string; role: string }
interface State { enabled: boolean; me?: { id: string; fullName: string }; viewing?: Account | null; users?: Account[] }

/** Staging only: lets management look at the system as any other account. The server answers
 *  `enabled: false` everywhere else, and this then renders nothing (functions/api/auth/view-as.ts).
 *  It floats over every shell, so it is still there while viewing as an owner or a field account. */
export default function ViewAs() {
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => { api.get<State>('/auth/view-as').then(setState).catch(() => setState(null)); }, []);
  if (!state?.enabled || !state.me) return null;

  const go = async (userId: string) => {
    setBusy(true);
    try {
      const res = await api.post<{ home: string }>('/auth/view-as', { userId });
      // A full reload: every screen and the menu must be rebuilt for the other account.
      window.location.hash = res.home;
      window.location.reload();
    } catch (e) {
      setBusy(false);
      toast({ tone: 'critical', title: 'Could not switch account.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    }
  };

  const viewing = state.viewing;
  const roles = [...new Set((state.users ?? []).map(u => u.role))];
  return (
    <div className="fixed right-3 bottom-3 z-[70] flex flex-col items-end [font:inherit] text-meta">
      {open && (
        <div className="mb-2 w-[300px] max-h-[60vh] overflow-y-auto bg-card rounded-card border border-solid border-line [box-shadow:var(--shadow-overlay)]">
          <div className="px-3 py-2 text-[11px] text-muted-ink [border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]">
            Staging only. Opens the system exactly as that account sees it.
          </div>
          <button type="button" disabled={busy || !viewing} onClick={() => go(state.me!.id)}
            className="block w-full text-left px-3 py-2 bg-transparent border-none cursor-pointer [font:inherit] font-semibold disabled:opacity-50 disabled:cursor-default hover:bg-muted">
            Me — {state.me.fullName}
          </button>
          {roles.map(role => (
            <div key={role}>
              <div className="px-3 pt-2 pb-1 text-caption font-semibold tracking-[0.08em] uppercase text-muted-ink">{role.replace(/_/g, ' ')}</div>
              {(state.users ?? []).filter(u => u.role === role && u.id !== state.me!.id).map(u => (
                <button key={u.id} type="button" disabled={busy || viewing?.id === u.id} onClick={() => go(u.id)}
                  className="block w-full text-left px-3 py-1.5 bg-transparent border-none cursor-pointer [font:inherit] disabled:opacity-50 disabled:cursor-default hover:bg-muted">
                  <span className="font-medium">{u.fullName}</span>
                  <span className="block text-[11px] text-muted-ink overflow-hidden text-ellipsis whitespace-nowrap">{u.email}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full border border-solid cursor-pointer [font:inherit] font-semibold [box-shadow:var(--shadow-overlay)]"
        style={{ background: 'var(--color-warning, #FBEFD5)', color: 'var(--color-warning-fg, #8A5A12)', borderColor: 'var(--color-warning-line, #B7791F)' }}>
        View as: {viewing ? `${viewing.fullName} (${viewing.role.replace(/_/g, ' ')})` : 'Me'} {open ? '▴' : '▾'}
      </button>
    </div>
  );
}
