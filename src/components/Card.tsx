import { type ReactNode, type CSSProperties } from 'react';
import { color, radius, text, shadow } from '../theme';

export function Card({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <div className={className} style={{
      background: color.card, border: `1px solid ${color.borderMuted}`, borderRadius: radius.card, overflow: 'hidden',
      boxShadow: shadow.card,
      // `main` (AppShell) is a column flexbox with overflowY: auto, so it scrolls once its content is
      // taller than the viewport — but a flex item with overflow != visible gets an automatic min-height
      // of 0 (CSS flexbox spec), so without this a long card gets squeezed to fit main's height instead
      // of pushing it taller, silently clipping rows with no scrollbar in sight. flexShrink: 0 keeps the
      // card at its real content height so main is the thing that grows and scrolls, as intended.
      flexShrink: 0,
      ...style,
    }}>
      {children}
    </div>
  );
}

export function CardHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div style={{ padding: '20px 20px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: text.heading, fontWeight: 700, letterSpacing: '-0.005em' }}>{title}</span>
      {right}
    </div>
  );
}

export function LinkAction({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="hit-target" style={{ font: 'inherit', fontSize: text.small, fontWeight: 600, color: color.goldInk, background: 'none', border: 'none', cursor: 'pointer' }}>
      {children}
    </button>
  );
}

/* ---- One copy of the small layout pieces that used to be re-typed in every page (owner, 3 Nov 2026) ---- */

/** A labelled value in a record's header: "DO NUMBER / DO-2611-004". `mono` for document numbers. */
export function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] uppercase tracking-[0.08em] text-muted-ink">{label}</span>
      <span className={`text-[13.5px] break-words${mono ? ' [font-family:var(--font-mono,ui-monospace,monospace)]' : ''}`}>{value}</span>
    </div>
  );
}

/** A group of fields in a create / edit form: a small caps title (and an optional hint on the right) over a
 *  two-column grid, one column on phones. Sections that follow each other are parted by a dashed rule (Conts DS v2). */
export function FormSection({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="ds-fs">
      <div className="ds-fs-h"><b>{title}</b>{hint && <span>{hint}</span>}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </section>
  );
}

/** A report block on its own card: a title, an optional note under it or an action on the right, then the content. */
export function SectionCard({ title, note, right, children }: { title: string; note?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-card border border-solid border-line bg-card p-4 sm:p-5 flex flex-col gap-3 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0"><h2 className="m-0 text-[15px] font-semibold">{title}</h2>{note && <p className="m-0 text-meta text-muted-ink">{note}</p>}</div>
        {right}
      </div>
      {children}
    </section>
  );
}
