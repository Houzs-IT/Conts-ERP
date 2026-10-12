import { useState } from 'react';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';

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
