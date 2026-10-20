import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { ROLE_LABEL } from '../lib/vocabulary';
import { useSession } from '../lib/session';
import { useToast } from './Toast';
import Icon from './Icon';

interface Account { id: string; fullName: string; email: string; role: string; hasUnit?: boolean }
interface State { enabled: boolean; me?: { id: string; fullName: string }; viewing?: Account | null; users?: Account[]; roles?: string[] }

const roleName = (role: string) => ROLE_LABEL[role] ?? role.replace(/_/g, ' ');
// Each role's test account (functions/api/auth/view-as.ts) is reached from "By role", so it is left out of "By person".
const isTest = (u: Account) => u.email.endsWith('@staging.invalid');
const MIN_KEY = 'tc.viewAs.min';

/** Staging only: lets management look at the system as a role or as any other account. The server answers
 *  `enabled: false` everywhere else, and this then renders nothing (functions/api/auth/view-as.ts).
 *  It floats over every shell, so it is still there while viewing as an owner or a field account. */
export default function ViewAs() {
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [min, setMin] = useState(() => { try { return localStorage.getItem(MIN_KEY) === '1'; } catch { return false; } });
  const toast = useToast();
  const userId = useSession().user?.id;

  // Asked again on sign-in and sign-out, so it appears without a page refresh.
  useEffect(() => { api.get<State>('/auth/view-as').then(setState).catch(() => setState(null)); }, [userId]);
  if (!state?.enabled || !state.me) return null;

  const minimise = (on: boolean) => {
    setMin(on); setOpen(false);
    try { localStorage.setItem(MIN_KEY, on ? '1' : '0'); } catch { /* the choice just is not remembered */ }
  };
  const go = async (to: { userId: string } | { role: string }) => {
    setBusy(true);
    try {
      const res = await api.post<{ home: string }>('/auth/view-as', to);
      // A full reload: every screen and the menu must be rebuilt for the other account.
      window.location.hash = res.home;
      window.location.reload();
    } catch (e) {
      setBusy(false);
      toast({ tone: 'critical', title: 'Could not switch account.', body: errorMessage(e, 'Try again in a moment.') });
    }
  };

  const viewing = state.viewing;
  const label = viewing ? `Viewing as: ${roleName(viewing.role)} (${viewing.fullName})` : 'View as: Me';
  const people = (state.users ?? []).filter(u => u.id !== state.me!.id && !isTest(u));
  const owners = people.filter(u => u.role === 'owner' && u.hasUnit);
  const roles = [...new Set(people.map(u => u.role))];
  const pill = 'inline-flex items-center gap-1.5 h-8 rounded-full border border-solid cursor-pointer [font-family:inherit] text-[12px] font-semibold [box-shadow:var(--shadow-overlay)]';
  const warn = { background: 'var(--color-warning)', color: 'var(--color-warning-fg)', borderColor: 'var(--color-warning-line)' };
  const row = 'block w-full text-left px-3 py-1.5 bg-transparent border-none cursor-pointer [font:inherit] disabled:opacity-50 disabled:cursor-default hover:bg-muted';
  const heading = 'px-3 pt-2 pb-1 text-caption font-semibold tracking-[0.08em] uppercase text-muted-ink';

  return (
    // z-[45]: above the phone tab bar (40) and the page, under every dialog and drawer (50 and up), so it never
    // sits on a dialog's buttons. On phones (under 600px, deviceClass.ts) it sits above the 64px bottom tab bar.
    <div className="fixed right-3 bottom-3 max-[600px]:bottom-[calc(76px+env(safe-area-inset-bottom))] z-[45] flex flex-col items-end [font-family:inherit] text-meta">
      {open && !min && (
        <div className="mb-2 w-[300px] max-w-[calc(100vw-24px)] max-h-[60vh] overflow-y-auto bg-card rounded-card border border-solid border-line [box-shadow:var(--shadow-overlay)]">
          <div className="px-3 py-2 text-[11px] text-muted-ink [border-bottom:1px_solid_var(--color-line-soft)]">
            Staging only. Opens the system exactly as that role or account sees it.
          </div>
          <button type="button" disabled={busy || !viewing} onClick={() => go({ userId: state.me!.id })} className={`${row} py-2 font-semibold`}>
            Me, {state.me.fullName}
          </button>

          <div className={heading}>By role</div>
          {(state.roles ?? []).map(role => (
            <button key={role} type="button" disabled={busy} onClick={() => go({ role })} className={row}>
              <span className="font-medium">{roleName(role)}</span>
              <span className="block text-[11px] text-muted-ink">Test account, not a real person</span>
            </button>
          ))}
          <div className="px-3 pt-1.5 pb-1 font-medium">Owner <span className="text-[11px] font-normal text-muted-ink">(pick an owner)</span></div>
          {owners.length ? owners.map(u => (
            <button key={u.id} type="button" disabled={busy || viewing?.id === u.id} onClick={() => go({ userId: u.id })} className={`${row} pl-6`}>
              {u.fullName}
            </button>
          )) : (
            <div className="px-3 pl-6 pb-1.5 text-[11px] text-muted-ink">No owner on staging has a portal login and a unit yet. Invite one from Owners.</div>
          )}

          <div className={`${heading} mt-1 [border-top:1px_solid_var(--color-line-soft)]`}>By person</div>
          {roles.map(role => (
            <div key={role}>
              <div className="px-3 pt-1.5 pb-0.5 text-[11px] font-semibold text-muted-ink">{roleName(role)}</div>
              {people.filter(u => u.role === role).map(u => (
                <button key={u.id} type="button" disabled={busy || viewing?.id === u.id} onClick={() => go({ userId: u.id })} className={row}>
                  <span className="font-medium">{u.fullName}</span>
                  <span className="block text-[11px] text-muted-ink overflow-hidden text-ellipsis whitespace-nowrap">{u.email}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {min ? (
        <button type="button" onClick={() => minimise(false)} title={label} aria-label={`${label}. Show the View as switch.`}
          className={`${pill} justify-center w-8 px-0`} style={warn}>
          <Icon name="Eye" size="sm" />
        </button>
      ) : (
        <div className="flex items-center gap-1.5">
          {viewing && (
            <button type="button" disabled={busy} onClick={() => go({ userId: state.me!.id })} className={`${pill} px-3 bg-card text-ink border-line`}>
              Back to me
            </button>
          )}
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
            className={`${pill} px-3 max-w-[min(420px,calc(100vw-180px))]`} style={warn}>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{label}</span> {open ? '▴' : '▾'}
          </button>
          <button type="button" onClick={() => minimise(true)} title="Shrink to an icon" aria-label="Shrink the View as switch to an icon"
            className={`${pill} justify-center w-8 px-0`} style={warn}>
            <Icon name="Minus" size="sm" />
          </button>
        </div>
      )}
    </div>
  );
}
