import { useEffect, useState } from 'react';

/** Subscribes to a media query and re-renders when it flips (window resize, rotation). */
export function useMedia(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Re-renders every `ms` so countdowns age with the clock. */
export function useNow(ms = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
