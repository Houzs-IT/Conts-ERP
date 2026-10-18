import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import Icon from './Icon';
import { Button } from './Button';
import { cx } from '../lib/design-tokens';
import { statusOf, statusOptions, normTone, TONE_STYLE, type AnyTone, type StatusEntity } from '../lib/status';

type Size = 'sm' | 'md';
type BadgeProps =
  | { entity: StatusEntity; value: string | null | undefined; size?: Size; dot?: boolean; className?: string; title?: string }
  | { tone: AnyTone; label?: ReactNode; children?: ReactNode; size?: Size; dot?: boolean; outline?: boolean; className?: string; title?: string };

/**
 * The only status pill. Either a stored status (`entity` + `value`, words and colour from lib/status.ts)
 * or a one-off flag (`tone` + `label`, e.g. "Missing ID"). Colour is never the only signal: the words are always shown.
 */
export function StatusBadge(props: BadgeProps) {
  const { size = 'md', className, title } = props;
  let tone, label: ReactNode, outline = false, dot: boolean;
  if ('entity' in props) {
    const s = statusOf(props.entity, props.value);
    tone = s.tone; label = s.label; outline = !!s.outline; dot = props.dot ?? true;
  } else {
    tone = normTone(props.tone); label = props.label ?? props.children; outline = !!props.outline; dot = props.dot ?? false;
  }
  const t = TONE_STYLE[tone];
  return (
    <span title={title}
      className={cx('inline-flex items-center gap-[6px] rounded-pill font-medium border border-solid leading-[1.35] max-w-full',
        className?.includes('whitespace-normal') ? 'text-left' : 'whitespace-nowrap',
        size === 'sm' ? 'px-[9px] py-[2px] text-caption' : 'px-[10px] py-[3px] text-meta', className)}
      style={{ background: outline ? 'transparent' : t.bg, color: t.fg, borderColor: outline ? t.line : 'transparent' }}>
      {dot && <span aria-hidden className="w-[6px] h-[6px] rounded-full flex-none" style={{ background: t.line }} />}
      <span className={cx("min-w-0", !className?.includes("whitespace-normal") && "overflow-hidden text-ellipsis")}>{label}</span>
    </span>
  );
}

/** A status dot beside words that already say the status (lists, trees). Never used alone. */
export function StatusDot({ tone, entity, value, live }: { tone?: AnyTone; entity?: StatusEntity; value?: string; live?: boolean }) {
  const t = TONE_STYLE[entity ? statusOf(entity, value).tone : normTone(tone ?? 'neutral')];
  return <span aria-hidden className={cx('w-[6px] h-[6px] rounded-full flex-none', live && 'animate-live')} style={{ background: t.line }} />;
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true); };
  }, [open]);
  return { open, setOpen, ref };
}

export interface StatusOption {
  /** The stored value this option moves to. */
  value: string;
  /** What the option says; defaults to the target status's label. */
  label?: string;
  /** One line under the label: what happens, or why it is not possible. */
  hint?: string;
  disabled?: boolean;
  /** Lucide icon name. */
  icon?: string;
  /** Destructive moves (cancel, no-show) read in red. */
  danger?: boolean;
}

/**
 * The current status as a pill; clicking it lists the moves offered, each with a line on what it does or why it is
 * not possible. `options === null` means still loading; an empty list means the status is final (shown as Locked).
 */
export function StatusMenu({ entity, value, options, busy, onPick, align = 'right', label = 'Change status', shown }: {
  entity: StatusEntity; value: string; options: StatusOption[] | null; busy?: boolean;
  onPick: (o: StatusOption) => void; align?: 'left' | 'right'; label?: string;
  /** What the pill reads when it differs from the stored value (a reservation shows its date-based status). */
  shown?: { entity: StatusEntity; value: string };
}) {
  const { open, setOpen, ref } = usePopover();
  const locked = options !== null && options.length === 0;
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => !locked && options && setOpen(o => !o)} disabled={busy || !options} aria-haspopup="menu" aria-expanded={open}
        title={locked ? 'No further status changes' : label}
        className={cx('inline-flex items-center gap-1 p-0 bg-transparent border-none [font:inherit]', locked || !options ? 'cursor-default' : 'cursor-pointer')}>
        <StatusBadge entity={shown?.entity ?? entity} value={shown?.value ?? value} />
        {busy ? <span className="text-meta text-muted-ink">Saving…</span>
          : locked ? <span className="inline-flex items-center gap-1 text-meta text-muted-ink"><Icon name="Lock" size="sm" />Locked</span>
          : options ? <Icon name="ChevronDown" size="sm" color="var(--color-text-muted)" /> : null}
      </button>
      {open && options && (
        <div role="menu" aria-label={label}
          className={cx('absolute z-[60] top-full mt-1 w-[300px] max-w-[calc(100vw-48px)] p-1 bg-card border border-solid border-line rounded-card shadow-[var(--shadow-overlay)]', align === 'right' ? 'right-0' : 'left-0')}>
          {options.map((o, i) => {
            const target = statusOf(entity, o.value);
            return (
              <Fragment key={o.value + (o.label ?? '')}>
              {o.danger && i > 0 && !options[i - 1].danger && <div role="separator" className="my-1 mx-1 h-px bg-line-soft" />}
              <button type="button" role="menuitem" disabled={o.disabled}
                onClick={() => { setOpen(false); onPick(o); }}
                className={cx('w-full text-left flex gap-[10px] items-start px-[10px] py-[9px] rounded-control border-none bg-transparent [font:inherit]',
                  o.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted')}>
                <span className="mt-[1px]" style={{ color: TONE_STYLE[target.tone].fg }}><Icon name={o.icon ?? 'ArrowRight'} size="sm" /></span>
                <span className="flex flex-col gap-[2px] min-w-0">
                  <span className={cx('text-copy font-semibold', o.danger ? 'text-danger' : 'text-ink')}>{o.label ?? target.label}</span>
                  {o.hint && <span className="text-meta text-muted-ink leading-[1.4]">{o.hint}</span>}
                </span>
              </button>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * A filter by status: a button that opens a checklist of the entity's statuses. `off` holds the ones hidden.
 * `values` limits and orders the list (defaults to every status of the entity).
 */
export function StatusFilterMenu({ entity, values, off, onChange, title = 'Status' }: {
  entity: StatusEntity; values?: string[]; off: Record<string, boolean>;
  onChange: (fn: (o: Record<string, boolean>) => Record<string, boolean>) => void; title?: string;
}) {
  const { open, setOpen, ref } = usePopover();
  const list = (values ?? statusOptions(entity).map(o => o.value)).map(v => ({ value: v, ...statusOf(entity, v) }));
  const shown = list.filter(s => !off[s.value]);
  const summary = shown.length === list.length ? 'All' : shown.length === 0 ? 'None' : `${shown.length} of ${list.length}`;
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 h-10 md:h-9 px-2.5 rounded-control border border-solid border-line bg-card cursor-pointer font-sans text-copy text-ink">
        <span className="text-muted-ink">{title}</span>
        <span className="font-semibold">{summary}</span>
        <Icon name="ChevronDown" size="sm" style={{ width: 14, height: 14 }} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full mt-1 z-30 min-w-[200px] p-1 bg-card border border-solid border-line rounded-control shadow-[var(--shadow-overlay)]">
          {list.map(s => {
            const on = !off[s.value];
            return (
              <button key={s.value} type="button" role="menuitemcheckbox" aria-checked={on}
                onClick={() => onChange(o => ({ ...o, [s.value]: on }))}
                className="w-full flex items-center gap-2.5 h-10 md:h-8 px-2 rounded-[6px] bg-transparent hover:bg-muted border-none cursor-pointer font-sans text-copy text-ink text-left">
                <span className={cx('w-4 h-4 flex-none rounded-[4px] grid place-items-center box-border border border-solid', on ? 'bg-black border-black text-white' : 'bg-card border-line-strong')}>
                  {on && <Icon name="Check" size="sm" style={{ width: 12, height: 12 }} />}
                </span>
                <span className="w-2 h-2 rounded-full flex-none" style={{ background: TONE_STYLE[s.tone].line }} />
                {s.label}
              </button>
            );
          })}
          <div className="mt-1 pt-1 border-0 border-t border-solid border-line-soft flex items-center justify-between px-1">
            <button type="button" onClick={() => onChange(() => ({}))} className="h-7 px-1 bg-transparent border-none cursor-pointer font-sans text-meta font-medium text-accent">Show all</button>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Done</Button>
          </div>
        </div>
      )}
    </div>
  );
}
