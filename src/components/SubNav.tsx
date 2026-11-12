import { useEffect, useMemo, useRef } from 'react';
import { navFor, subTabsFor, type BadgeKey } from '../lib/navigation';
import { useSession } from '../lib/session';
import { useNavCounts } from '../lib/navBadges';
import { count as countLabel } from '../lib/format';
import { opensInPlace } from '../lib/linkClick';

/**
 * The sub-tabs above a page whose menu entry holds several screens (Unit report, Units, Owners, Settings; owner,
 * 12 Nov 2026): one line with the gold underline (`.ds-subnav`, components.css) that scrolls sideways when it does
 * not fit, never wraps. Each tab is a link to its own address, so it opens in a new tab, keeps its place in the
 * history and follows its own permission area: a tab the person cannot open is not drawn, and with fewer than two
 * left there is no bar. Drawn by AppShell, so pages do not draw it themselves.
 */
export default function SubNav({ path, navigate, phone }: { path: string; navigate: (p: string) => void; phone: boolean }) {
  const { user } = useSession();
  // The engine-only areas never hold sub-tabs, so the menu is read without asking whether the engine is set up.
  const groups = useMemo(() => (user ? navFor(user.role, false, user.access) : []), [user]);
  const found = subTabsFor(groups, path, phone);
  const counts = useNavCounts(path);
  const bar = useRef<HTMLElement>(null);
  // The open tab scrolls into view on a narrow screen (the last Owners tab is off the right edge on a phone).
  useEffect(() => {
    bar.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [found?.current]);
  if (!found) return null;
  const n = (b?: BadgeKey) => (b ? Number(counts?.[b] ?? 0) : 0);
  return (
    <nav ref={bar} aria-label={`${found.item.label} sections`} data-print-hide
      className="ds-subnav flex-none max-md:-mx-4 max-md:px-4 -mb-1 md:-mb-2">
      {found.tabs.map(t => {
        const on = t.key === found.current;
        return (
          <a key={t.key} href={t.path} aria-current={on ? 'page' : undefined}
            onClick={e => { if (!opensInPlace(e)) return; e.preventDefault(); if (!on || path !== t.path) navigate(t.path); }}
            className="inline-flex items-center gap-1.5 min-h-11 md:min-h-0">
            {t.label}
            {n(t.badge) > 0 && (
              <span className="min-w-5 h-5 px-1.5 rounded-pill grid place-items-center text-[11px] font-semibold tabular-nums bg-gold-tint text-gold-ink">{countLabel(n(t.badge))}</span>
            )}
          </a>
        );
      })}
    </nav>
  );
}
