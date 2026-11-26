import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { color, radius } from '../theme';
import { findNav } from '../lib/navigation';
import { close, pageOf, readTabs, visit, writeTabs, type PageTab } from '../lib/pageTabs';
import { RESUME } from '../lib/enginePlaces';
import Icon from './Icon';
import { LOOKS, sidebarLookKey, useDarkTheme } from './Sidebar';

/** The name a page goes by on its tab: the top bar's page name ("Payment requests"; a record under a list reads
 *  "Units · Unit"), else the last part of its address. */
export function tabTitle(path: string): string {
  const nav = findNav(pageOf(path));
  if (nav) return nav.page ? `${nav.label} · ${nav.page}` : nav.label;
  if (pageOf(path) === '/account') return 'My account';
  if (pageOf(path) === '/notifications') return 'Notifications';
  const last = pageOf(path).split('/').filter(Boolean).at(-1) ?? 'Home';
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, ' ');
}

/** The pages open in this browser tab, one tab each, under the top bar (chew, 20 Nov 2026). A tab is a real link: a
 *  click opens the page where it was left (its filter or tab), a right click or middle click opens it in a new browser
 *  tab. The x closes it; closing the open one goes to its neighbour. Desk and tablet only. */
export default function PageTabs({ navigate, dreamCrafter = false }: { navigate: (p: string) => void; dreamCrafter?: boolean }) {
  const look = LOOKS[sidebarLookKey(true, useDarkTheme())];
  const loc = useLocation();
  const here = `${loc.pathname}${loc.search}`;
  const [tabs, setTabs] = useState<PageTab[]>(readTabs);
  const row = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Another browser tab never shares this row: sessionStorage is per tab, so re-reading it is safe here.
    const next = visit(readTabs(), here, tabTitle(here), Date.now());
    writeTabs(next);
    setTabs(next);
  }, [here]);

  // The open tab stays in view when the row is wider than the screen.
  useEffect(() => {
    row.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tabs, here]);

  const shut = (e: MouseEvent, t: PageTab) => {
    e.preventDefault();
    e.stopPropagation();
    const r = close(readTabs(), t.path, here);
    writeTabs(r.tabs);
    setTabs(r.tabs);
    if (r.go) navigate(r.go);
  };

  if (tabs.length < 2) return null;
  const open = pageOf(here);
  return (
    <div ref={row} data-print-hide role="navigation" aria-label="Open pages" style={{
      flex: 'none', display: 'flex', overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'thin',
      ...(dreamCrafter
        ? { gap: 6, padding: '2px 24px 6px', background: 'transparent' }
        : { gap: 2, padding: '6px 20px 0', background: color.card, borderBottom: `1px solid ${color.border}` }),
    }}>
      {tabs.map(t => {
        const on = pageOf(t.path) === open;
        return (
          <span key={pageOf(t.path)} data-on={on || undefined} style={{
            flex: 'none', display: 'inline-flex', alignItems: 'center', maxWidth: 230,
            ...(dreamCrafter
              ? { height: 30, borderRadius: radius.pill, border: `1px solid ${on ? look.tabOnBorder : 'transparent'}`, background: on ? look.tabOnBg : look.wash, boxShadow: on ? look.tabOnShadow : undefined }
              : { height: 32, borderRadius: `${radius.sm}px ${radius.sm}px 0 0`, border: `1px solid ${on ? color.border : 'transparent'}`, borderBottom: 'none', marginBottom: -1, background: on ? color.page : 'transparent' }),
          }}>
            <Link to={t.path} state={RESUME} aria-current={on ? 'page' : undefined} title={t.title} style={{
              minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 4px 0 12px', lineHeight: dreamCrafter ? '28px' : '32px',
              color: dreamCrafter ? (on ? look.tabOnInk : look.text) : on ? color.ink : color.textMuted, fontSize: 13, fontWeight: on ? 600 : 500, textDecoration: 'none',
            }}>{t.title}</Link>
            <button type="button" aria-label={`Close ${t.title}`} title="Close" onClick={e => shut(e, t)}
              style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, margin: '0 4px 0 0', padding: 0,
                border: 'none', borderRadius: radius.xs, background: 'transparent', color: dreamCrafter ? look.muted : color.faint, cursor: 'pointer' }}>
              <Icon name="X" size="sm" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
