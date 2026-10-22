import { useState } from 'react';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';
import { color, radius } from '../theme';
import Icon from './Icon';

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Light / Dark. Saved per browser. Light is the default. */
export function ThemeToggle({ onDark = false }: { onDark?: boolean }) {
  const [pref, setPref] = useState<ThemePref>(getThemePref());
  const pick = (v: ThemePref) => { setPref(v); setThemePref(v); };
  return (
    <div role="radiogroup" aria-label="Appearance"
      className={`flex p-1 rounded-lg gap-1 ${onDark ? 'bg-charcoal' : 'bg-muted'}`}>
      {OPTIONS.map(o => {
        const on = pref === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => pick(o.value)}
            className={`flex-1 h-8 px-3 rounded-md border-none cursor-pointer font-sans text-meta font-semibold ${
              on ? (onDark ? 'bg-black text-card' : 'bg-card text-ink shadow-sm')
                 : (onDark ? 'bg-transparent text-faint' : 'bg-transparent text-muted-ink')}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** The top bar's one-tap switch beside the bell: a moon in light mode, a sun in dark. */
export function ThemeButton({ size }: { size: number }) {
  const [pref, setPref] = useState<ThemePref>(getThemePref());
  const next: ThemePref = pref === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'Switch to dark mode' : 'Switch to light mode';
  return (
    <button type="button" aria-label={label} title={label} onClick={() => { setPref(next); setThemePref(next); }}
      style={{ width: size, height: size, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, border: `1px solid ${color.border}`, borderRadius: radius.control, background: color.card, color: color.ink, cursor: 'pointer' }}>
      <Icon name={pref === 'dark' ? 'Sun' : 'Moon'} size="nav" />
    </button>
  );
}
