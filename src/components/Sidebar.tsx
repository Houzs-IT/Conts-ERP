import { type CSSProperties, useState } from 'react';
import { color, shell, radius, motion, text } from '../theme';
import { navFor, NAV } from '../lib/navigation';
import { useSession } from '../lib/session';
import Icon, { toPascal } from './Icon';
import { Logo } from './Logo';

interface Props { path: string; navigate: (p: string) => void; open: boolean; onToggle: () => void }

function parentOf(path: string) {
  for (const g of NAV) for (const it of g.items)
    if (it.children?.some(c => c.path === path)) return it.key;
  return null;
}

export default function Sidebar({ path, navigate, open, onToggle }: Props) {
  const { user, logout } = useSession();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [profileOpen, setProfileOpen] = useState(false);
  const activeParent = parentOf(path);
  const groups = navFor(user!.role);

  const badge = (on: boolean): CSSProperties => ({
    fontSize: text.micro, fontWeight: 600, padding: '1px 6px', borderRadius: radius.pill, flex: 'none',
    background: on ? 'rgba(200,164,106,0.18)' : 'rgba(255,255,255,0.08)',
    color: on ? color.gold : color.dim,
  });

  return (
    <div style={{
      width: open ? shell.sidebar : shell.sidebarCollapsed, flex: 'none', height: '100vh',
      display: 'flex', flexDirection: 'column', background: color.black, color: '#FFFFFF',
      transition: `width ${motion.standard} ${motion.ease}`,
    }}>
      <div style={{ padding: '18px 16px', display: 'flex', alignItems: 'center', gap: 11, borderBottom: `1px solid ${color.charcoal}` }}>
{open
          ? <div style={{ flex: 1, minWidth: 0 }}><Logo variant="full" size="sm" onDark /></div>
          : <Logo variant="mark" size="sm" onDark />}
        <button onClick={onToggle} aria-label={open ? 'Collapse navigation' : 'Expand navigation'}
          style={{ width: 26, height: 26, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: radius.sm, color: color.dim, background: 'none', border: 'none', cursor: 'pointer' }}>
          <Icon name={open ? 'ChevronsLeft' : 'ChevronsRight'} size="sm" />
        </button>
      </div>

      {/* Own scroller: the sidebar never rides the page scroll. */}
      <nav style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', scrollbarWidth: 'thin', padding: '12px 10px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {groups.map(g => (
          <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {open && <div style={{ padding: '6px 8px 4px', fontSize: text.micro, fontWeight: 600, letterSpacing: '0.13em', color: color.dim }}>{g.label}</div>}
            {g.items.map(it => {
              const isOpen = open && (expanded[it.key] ?? activeParent === it.key);
              const selfActive = it.path === path || (!!it.children && activeParent === it.key && !isOpen);
              return (
                <div key={it.key} style={{ display: 'flex', flexDirection: 'column' }}>
                  <button
                    title={it.label}
                    onClick={() => {
                      if (it.children) {
                        const willOpen = !(expanded[it.key] ?? activeParent === it.key);
                        setExpanded(e => ({ ...e, [it.key]: willOpen }));
                        if (willOpen && activeParent !== it.key) navigate(it.children[0].path);
                      } else if (it.path) navigate(it.path);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, height: shell.navItem,
                      padding: open ? '0 9px' : 0, justifyContent: open ? 'flex-start' : 'center',
                      borderRadius: radius.control, cursor: 'pointer', border: 'none', width: '100%',
                      font: 'inherit', textAlign: 'left',
                      transition: `background ${motion.fast} ease-out`,
                      color: selfActive ? '#FFFFFF' : color.onDark,
                      background: selfActive ? color.charcoal : 'transparent',
                      boxShadow: selfActive ? `inset 2px 0 0 ${color.gold}` : 'none',
                    }}
                  >
                    <Icon name={toPascal(it.icon)} size="nav" />
                    {open && <span style={{ flex: 1, minWidth: 0, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>}
                    {open && it.badge && <span style={badge(selfActive)}>{it.badge}</span>}
                    {open && it.children && (
                      <span style={{ display: 'flex', opacity: 0.6, transition: `transform 180ms ${motion.ease}`, transform: `rotate(${isOpen ? 90 : 0}deg)` }}>
                        <Icon name="ChevronRight" size="sm" />
                      </span>
                    )}
                  </button>

                  {isOpen && it.children && (
                    <div style={{ margin: '2px 0 4px 20px', paddingLeft: 12, borderLeft: '1px solid rgba(255,255,255,0.12)', display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {it.children.map(c => {
                        const on = c.path === path;
                        return (
                          <button key={c.key} onClick={() => navigate(c.path)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8, height: shell.navItemL3,
                              padding: '0 9px', borderRadius: 7, cursor: 'pointer', border: 'none', width: '100%',
                              font: 'inherit', textAlign: 'left',
                              color: on ? '#FFFFFF' : color.faint,
                              background: on ? 'rgba(200,164,106,0.14)' : 'transparent',
                              fontWeight: on ? 500 : 400,
                            }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
                            {c.badge && <span style={badge(on)}>{c.badge}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      <div style={{ padding: 10, borderTop: `1px solid ${color.charcoal}`, position: 'relative' }}>
        {profileOpen && (
          <div style={{ position: 'absolute', left: 10, right: 10, bottom: 62, zIndex: 30, background: '#FFFFFF', border: `1px solid ${color.border}`, borderRadius: radius.card, boxShadow: '0 12px 32px rgba(21,21,21,0.24)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: text.body, fontWeight: 600, color: color.ink }}>{user!.fullName}</span>
              <span style={{ fontSize: text.small, color: color.textMuted }}>{user!.email}</span>
            </div>
            {[
              // BUTTONS §2: each routes to its destination. /profile and
              // /profile/notifications are the spec routes (rendered by the
              // catch-all NotDesignedPage until built); Security and sessions
              // has no dedicated page, so it lands on the Settings → Security
              // section per the task's fallback ruling.
              { label: 'Personal profile', icon: 'User', go: () => { setProfileOpen(false); navigate('/profile'); } },
              { label: 'Notification settings', icon: 'Bell', go: () => { setProfileOpen(false); navigate('/profile/notifications'); } },
              { label: 'Security and sessions', icon: 'ShieldCheck', go: () => { setProfileOpen(false); navigate('/system/settings'); } },
              { label: 'Log out', icon: 'LogOut', danger: true, go: logout },
            ].map(m => (
              <button key={m.label} onClick={m.go}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', width: '100%', border: 'none', borderBottom: `1px solid ${color.borderMuted}`, background: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left', color: m.danger ? '#A8352F' : color.ink }}>
                <Icon name={m.icon} size="sm" />
                <span style={{ fontSize: 13 }}>{m.label}</span>
              </button>
            ))}
          </div>
        )}
        <button onClick={() => setProfileOpen(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: radius.control, cursor: 'pointer', width: '100%', border: 'none', font: 'inherit', textAlign: 'left', justifyContent: open ? 'flex-start' : 'center', background: profileOpen ? 'rgba(255,255,255,0.06)' : 'transparent', color: '#FFFFFF' }}>
          <span style={{ width: 30, height: 30, flex: 'none', borderRadius: radius.pill, background: color.charcoal, color: color.gold, display: 'grid', placeItems: 'center', fontSize: text.micro, fontWeight: 600 }}>
            {user!.fullName.split(' ').map(n => n[0]).slice(0, 2).join('')}
          </span>
          {open && (
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user!.fullName}</span>
              <span style={{ fontSize: text.micro, color: color.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user!.role.replace(/_/g, ' ')}</span>
            </span>
          )}
          {open && <Icon name="ChevronUp" size="sm" color={color.dim} />}
        </button>
      </div>
    </div>
  );
}
