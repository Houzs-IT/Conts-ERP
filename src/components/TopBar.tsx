import { color, radius, text, shell, motion } from '../theme';
import { findNav } from '../lib/navigation';
import Icon from './Icon';

export default function TopBar({ path, action }: { path: string; action?: { label: string; onClick: () => void } }) {
  const nav = findNav(path);
  return (
    <div style={{ flex: 'none', background: '#FFFFFF', borderBottom: `1px solid ${color.border}`, padding: '16px 28px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      {/* Crumbs truncate inside their own box; the actions cluster never shrinks. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '0 1 auto', overflow: 'hidden' }}>
        <span style={{ fontSize: text.small, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nav?.group ?? 'Workspace'}</span>
        <span style={{ fontSize: text.small, color: color.borderStrong, flex: 'none' }}>/</span>
        <span style={{ fontSize: text.small, fontWeight: 600, color: color.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nav?.label ?? 'Dashboard'}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: '1 1 auto', justifyContent: 'flex-end', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: shell.controlSm, padding: '0 12px', border: `1px solid ${color.border}`, borderRadius: radius.control, color: color.textMuted, flex: '0 1 210px', minWidth: 44, overflow: 'hidden', cursor: 'text' }}>
          <Icon name="Search" size="sm" />
          <span style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Search</span>
          <span style={{ marginLeft: 'auto', fontSize: text.micro, color: color.faint, flex: 'none' }}>/</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: shell.controlSm, flex: 'none', padding: '0 12px', border: `1px solid ${color.border}`, borderRadius: radius.control, fontSize: text.small, whiteSpace: 'nowrap', color: color.textMuted }}>
          <span className="animate-live" style={{ width: 6, height: 6, borderRadius: radius.pill, background: '#16845B' }} />
          <span>Airbnb synced 14:06</span>
        </div>

        <button aria-label="Notifications" style={{ position: 'relative', width: shell.controlSm, height: shell.controlSm, flex: 'none', display: 'grid', placeItems: 'center', border: `1px solid ${color.border}`, borderRadius: radius.control, background: '#FFFFFF', color: color.ink, cursor: 'pointer' }}>
          <Icon name="Bell" size="nav" />
          <span style={{ position: 'absolute', top: 6, right: 7, width: 6, height: 6, borderRadius: radius.pill, background: '#C2413B' }} />
        </button>

        {action && (
          <button onClick={action.onClick}
            style={{ height: shell.controlSm, flex: 'none', display: 'flex', alignItems: 'center', gap: 7, padding: '0 14px', borderRadius: radius.control, background: color.black, color: '#FFFFFF', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', border: 'none', cursor: 'pointer', transition: `background ${motion.fast} ease-out` }}>
            <Icon name="Plus" size="sm" />
            <span style={{ whiteSpace: 'nowrap' }}>{action.label}</span>
          </button>
        )}
      </div>
    </div>
  );
}
