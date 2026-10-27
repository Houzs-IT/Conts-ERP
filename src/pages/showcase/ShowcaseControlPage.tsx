import { useEffect, useState, type MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { NumberInput } from '../../components/inputs';
import { Segmented } from '../../components/ops/OpsUi';
import { useApi } from '../../lib/useApi';
import { useSession } from '../../lib/session';
import { cx } from '../../lib/design-tokens';
import { SECTIONS, META, LEAD_KEYS, fmtFigure, activeCount, type FigureKey, type ShowcaseData } from './model';
import { useOverrides } from './useOverrides';

type Tab = 'fields' | 'visual';

/** Showcase control (CONTS-0006): replace any portfolio figure the Owner Showcase shows, by typing it here or by
 *  clicking it on a live copy of the showcase (Visual editor), and switch each one back to live. One company-wide
 *  copy (functions/api/showcase/overrides.ts); writing needs Edit on Performance. */
export default function ShowcaseControlPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'visual' ? 'visual' : 'fields';
  const { user } = useSession();
  const level = user?.access?.performance;
  const canEdit = user?.role === 'management' || level === 'edit' || level === 'full';
  const main = useApi<ShowcaseData>('/showcase');
  const ovs = useOverrides(main.data?.overrides);
  const ov = ovs.ov;
  const n = activeCount(ov);
  const [menu, setMenu] = useState<{ k: FigureKey; x: number; y: number } | null>(null);
  const live = main.data?.live;
  const ready = main.data?.overridesReady !== false;
  const locked = !canEdit || !ready;

  const leadTotal = LEAD_KEYS.reduce((s, k) => s + (ov[k]?.active ? ov[k]!.value : live?.[k] ?? 0), 0);

  return (
    <div className="flex flex-col gap-5 min-w-0">
      <PageHeader title="Showcase control panel"
        sub="Override any figure shown in Owner Showcase. A filled value replaces live Airbnb data instantly; switch back to live at any time."
        badge={<StatusBadge tone={n ? 'warning' : 'success'} label={n ? `${n} ${n === 1 ? 'override' : 'overrides'} active` : 'All figures live'} />}
        actions={<Button variant="secondary" disabled={locked || !n} disabledReason={!canEdit ? 'Your access to Performance is view only.' : 'Every figure is already live.'} onClick={() => void ovs.resetAll()}>Reset all to live</Button>}
        primary={<Button variant="primary" onClick={() => navigate('/performance/showcase')}>Open showcase</Button>} />

      {!ready && <Card><div className="p-4 text-copy text-warning">Showcase control is not set up on this database yet (migration 0164). The showcase shows live figures only.</div></Card>}
      {ready && !canEdit && <Card><div className="p-4 text-copy text-muted-ink">Your access to Performance is view only, so the figures below cannot be changed here.</div></Card>}

      <Segmented label="Control panel view" value={tab} onChange={v => setParams(p => { const x = new URLSearchParams(p); if (v === 'visual') x.set('tab', 'visual'); else x.delete('tab'); return x; }, { replace: true })}
        options={[{ value: 'fields', label: 'Data fields' }, { value: 'visual', label: 'Visual editor' }]} />

      {tab === 'fields' ? (
        <div className="flex flex-col gap-5 max-w-[1100px]">
          {main.error && <Card><div className="p-4 text-copy text-danger">{main.error}</div></Card>}
          {SECTIONS.map(sec => (
            <Card key={sec.title}>
              <div className="flex items-center justify-between gap-3 px-[22px] py-4 border-b border-line">
                <div><div className="text-heading font-semibold">{sec.title}</div><div className="text-meta text-muted-ink">{sec.where}</div></div>
                {sec.title === 'Booking lead time' && live && (
                  <div className={cx('text-meta font-semibold', Math.abs(leadTotal - 100) < 0.05 ? 'text-success' : 'text-danger')}>Distribution total: {Math.round(leadTotal * 10) / 10}%</div>
                )}
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[640px]">
                  <div className="grid grid-cols-[minmax(160px,1.6fr)_minmax(90px,0.7fr)_minmax(110px,1fr)_auto_minmax(44px,auto)] gap-4 px-[22px] py-[10px] text-caption font-semibold text-muted-ink uppercase tracking-[0.05em] border-b border-line">
                    <div>Metric</div><div>Live (Airbnb)</div><div>Override value</div><div>Showing</div><div />
                  </div>
                  {sec.rows.map(r => (
                    <FigureRow key={r.key} k={r.key} live={live?.[r.key] ?? null} stored={ov[r.key]} locked={locked}
                      onApply={v => ovs.apply(r.key, v)} onActive={a => ovs.setActive(r.key, a)} onClear={() => ovs.clear(r.key)}
                      onMenu={(e: MouseEvent) => { e.preventDefault(); setMenu({ k: r.key, x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 130) }); }} />
                  ))}
                </div>
              </div>
            </Card>
          ))}
          {/* vocab-ok: quotes the showcase's own "All properties" label, which keeps the design pack's words */}
          <div className="text-meta text-muted-ink">Tip: right-click any row to switch it back to live or re-apply its override. Overrides apply to portfolio-level figures ("All properties"). Page views and search impressions have no live source: the showcase shows them only once they are typed here.</div>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap gap-x-[18px] gap-y-1 px-5 py-[10px] bg-warning-bg text-warning text-copy font-medium">
            <span><b>Click</b> any underlined number to edit it</span><span><b>Right-click</b> for Back to live / Apply override</span><span className="ml-auto">Solid amber underline = override in use</span>
          </div>
          <iframe title="Owner Showcase, edit mode" src="/performance/showcase?edit=1" className="block w-full border-0 h-[calc(100dvh-280px)] min-h-[560px]" />
        </Card>
      )}

      {menu && (
        <>
          <div className="fixed inset-0 z-[120]" onClick={() => setMenu(null)} onContextMenu={e => { e.preventDefault(); setMenu(null); }} />
          <div role="menu" className="fixed z-[121] w-[230px] bg-card border border-line rounded-card shadow-[var(--shadow-dropdown)] p-[6px] flex flex-col" style={{ left: menu.x, top: menu.y }}>
            <div className="px-[10px] pt-2 pb-[6px] text-meta font-semibold text-muted-ink">{META[menu.k].label}</div>
            <button type="button" role="menuitem" disabled={locked} className="h-9 rounded-control text-left px-[10px] text-copy font-semibold text-info hover:bg-muted cursor-pointer disabled:cursor-default disabled:opacity-50"
              onClick={() => { if (ov[menu.k]) void ovs.setActive(menu.k, false); setMenu(null); }}>↺ Back to live · {fmtFigure(menu.k, live?.[menu.k] ?? null)}</button>
            {ov[menu.k] && (
              <button type="button" role="menuitem" disabled={locked} className="h-9 rounded-control text-left px-[10px] text-copy font-semibold text-warning hover:bg-muted cursor-pointer disabled:cursor-default disabled:opacity-50"
                onClick={() => { void ovs.setActive(menu.k, true); setMenu(null); }}>Apply override · {fmtFigure(menu.k, ov[menu.k]!.value)}</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FigureRow({ k, live, stored, locked, onApply, onActive, onClear, onMenu }: {
  k: FigureKey; live: number | null; stored?: { value: number; active: boolean }; locked: boolean;
  onApply: (v: number) => Promise<boolean>; onActive: (a: boolean) => Promise<boolean>; onClear: () => Promise<boolean>; onMenu: (e: MouseEvent) => void;
}) {
  const decimals = META[k].decimals;
  const [draft, setDraft] = useState<number | null>(stored?.value ?? null);
  useEffect(() => { setDraft(stored?.value ?? null); }, [stored?.value]);
  const active = !!stored?.active;
  const commit = () => {
    if (locked || draft === (stored?.value ?? null)) return;
    if (draft === null) void onClear(); else void onApply(draft);
  };
  return (
    <div onContextMenu={onMenu} className={cx('grid grid-cols-[minmax(160px,1.6fr)_minmax(90px,0.7fr)_minmax(110px,1fr)_auto_minmax(44px,auto)] gap-4 items-center px-[22px] py-3 border-b border-line last:border-b-0', active ? 'bg-warning-bg' : '')}>
      <div className="text-copy font-semibold">{META[k].label}</div>
      <div className="flex items-center gap-2 text-copy font-semibold [font-variant-numeric:tabular-nums]">
        {live === null ? <span className="text-muted-ink font-normal">No live source</span> : <><span className="w-[6px] h-[6px] rounded-full bg-success-line flex-none" />{fmtFigure(k, live)}</>}
      </div>
      <NumberInput aria-label={`${META[k].label}, override value`} value={draft} onChange={setDraft} decimals={decimals} min={0} placeholder="-" disabled={locked}
        onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        style={active ? { borderColor: 'var(--color-warning-line)' } : undefined} />
      <div className="inline-flex gap-[2px] p-[3px] bg-muted rounded-pill w-max" role="group" aria-label={`${META[k].label}: showing`}>
        <button type="button" aria-pressed={!active} disabled={locked || !active} onClick={() => void onActive(false)}
          className={cx('px-3 py-[6px] rounded-pill text-meta font-semibold', !active ? 'bg-card text-ink shadow-[var(--shadow-card)]' : 'text-muted-ink cursor-pointer')}>Live</button>
        <button type="button" aria-pressed={active} disabled={locked || !stored || active} onClick={() => void onActive(true)}
          className={cx('px-3 py-[6px] rounded-pill text-meta font-semibold', active ? 'bg-warning-line text-white' : stored ? 'text-ink cursor-pointer' : 'text-faint')}>Override</button>
      </div>
      <button type="button" disabled={locked} onClick={() => void onClear()} className={cx('text-meta font-semibold text-muted-ink text-right cursor-pointer hover:text-ink', stored ? '' : 'invisible')}>Clear</button>
    </div>
  );
}
