import { color, radius, text } from '../theme';

/** Undesigned destinations state the reason and offer the next action — they are
 *  never dead links. See copy.md section 12. */
export default function NotDesignedPage() {
  return (
    <div style={{ maxWidth: 460, background: '#FFFFFF', border: `1px solid ${color.border}`, borderRadius: radius.card, padding: 28, display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ fontSize: text.cardTitle, fontWeight: 600 }}>Not designed yet</div>
      <div style={{ fontSize: 13, color: color.textMuted }}>This module is specified in BUTTONS.md and api.md but has no screen yet.</div>
      <a href="#/" style={{ alignSelf: 'flex-start', marginTop: 4, height: 36, display: 'flex', alignItems: 'center', padding: '0 14px', borderRadius: radius.control, background: color.black, color: '#FFFFFF', fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
        Dashboard
      </a>
    </div>
  );
}
