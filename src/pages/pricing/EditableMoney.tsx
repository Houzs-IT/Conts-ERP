import { useState } from 'react';
import { MoneyInput } from '../../components/inputs';
import Icon from '../../components/Icon';
import { color } from '../../theme';
import { rm } from '../../lib/format';
import { TONE, cx } from '../../lib/design-tokens';

const INPUT_CLASS = 'box-border h-[34px] px-[10px] py-0 text-ink bg-card border border-solid rounded-control outline-none [font-family:inherit] [font-size:inherit] [font-variant-numeric:tabular-nums]';

/** Click-to-edit money value. Commits on Enter or blur, discards on Escape. Money is integer sen; the input only
 *  handles RM at the very edge. With `clearable`, an emptied field (or RM 0) commits null: the level then falls back. */
export function EditableMoney({ sen, onCommit, ariaLabel, tone, minSen = 0, clearable = false, muted = false, emptyLabel }: {
  sen: number | null; onCommit: (sen: number | null) => void; ariaLabel: string; tone?: 'floor' | 'warn'; minSen?: number;
  clearable?: boolean; muted?: boolean; emptyLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number | null>(null);
  const clearing = clearable && (draft == null || draft === 0);
  const tooLow = !clearing && draft != null && draft < minSen;

  function begin() { setDraft(sen); setEditing(true); }
  // Enter on a value below the minimum keeps the field open with its message; blur or Escape discards it.
  function commit(keepOpenIfBad: boolean) {
    if (clearing) { if (sen != null) onCommit(null); setEditing(false); return; }
    if (draft == null || tooLow) { if (!keepOpenIfBad) setEditing(false); return; }
    if (draft !== sen) onCommit(draft);
    setEditing(false);
  }

  if (editing) {
    return (
      <MoneyInput
        autoFocus valueSen={draft} onChangeSen={setDraft} aria-label={ariaLabel} minSen={clearable ? 0 : minSen}
        error={tooLow ? `Must be at least ${rm(minSen)}.` : undefined}
        help={clearable ? 'Empty it to use the price below.' : undefined}
        onBlur={() => commit(false)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(true); }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
        }}
        className={cx(INPUT_CLASS, 'w-full max-w-[120px] ml-auto border-line-strong')}
      />
    );
  }
  return (
    <button
      type="button" onClick={begin} aria-label={`Edit ${ariaLabel}`}
      className={cx(
        'inline-flex items-center gap-1.5 ml-auto py-[3px] px-1.5 rounded-[6px] border border-solid border-transparent bg-transparent cursor-pointer [font-family:inherit] text-copy font-medium [font-variant-numeric:tabular-nums] whitespace-nowrap',
        tone === 'warn' ? TONE.warning.text : tone === 'floor' || muted ? 'text-muted-ink' : 'text-ink',
      )}
      onMouseEnter={e => { e.currentTarget.style.borderColor = color.border; e.currentTarget.style.background = color.muted; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
    >
      {sen == null ? <span className="text-faint font-normal">{emptyLabel ?? 'Not set'}</span> : rm(sen, { cents: false })}
      <Icon name="Pencil" size="sm" color={color.faint} />
    </button>
  );
}
