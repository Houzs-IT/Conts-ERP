import { useEffect, useRef, useState } from 'react';
import { rm, rmShort, dateShort, monthLabel, weekdayDate, nights as nightsLabel } from '../../lib/format';
import { addDays, daysBetween } from './model';
import { Photo } from './parts';
import { at, useChat, CaseTrail } from './portalParts';
import { monthShift, occupancy, stayStatus, STATUS_WORD, UNITS, OWNER, MANAGER, GUARANTEE, type Sample, type SampleStay, type SampleStatement } from './sampleOwner';

const ICON = {
  home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
  cal: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4',
  cases: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  pay: 'M3 6h18v12H3zM3 10h18M7 15h4',
  chat: 'M4 5h16v11H9l-5 4z',
} as const;
type Tab = keyof typeof ICON;
const TABS: [Tab, string][] = [['home', 'Home'], ['cal', 'Calendar'], ['cases', 'Cases'], ['pay', 'Payments'], ['chat', 'Chat']];
const TITLE: Record<Tab, string> = { home: 'Home', cal: 'Calendar', cases: 'Service cases', pay: 'Payments', chat: 'Support' };
const PROFILE: [string, string][] = [['name', 'Full name'], ['email', 'Email'], ['phone', 'Phone'], ['password', 'Password'], ['bank', 'Payout bank account'], ['address', 'Mailing address']];
type Sub = { type: 'stay'; s: SampleStay } | { type: 'case'; id: string } | { type: 'bill'; m: SampleStatement } | { type: 'profile' };

const Svg = ({ d, size = 22 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);

/** The owner app on a phone, iOS or Android, with its own state (CONTS-0006 part 2, sample owner). */
export function OwnerPhone({ platform, data, today }: { platform: 'ios' | 'android'; data: Sample; today: string }) {
  const ios = platform === 'ios';
  const [tab, setTab] = useState<Tab>('home');
  const [sub, setSub] = useState<Sub | null>(null);
  const [unit, setUnit] = useState(0);
  const [photo, setPhoto] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState('');
  const { chat, send } = useChat(data.chat);
  const scroll = useRef<HTMLDivElement>(null);
  const fr = ios
    ? { sb: 50, sbPad: 30, sbFont: 15, camTop: 11, camW: 118, camH: 32, titlePad: 10, titleSize: 26, navPad: '8px 4px 0', homeH: 26, homeW: 130 }
    : { sb: 34, sbPad: 20, sbFont: 13, camTop: 9, camW: 14, camH: 14, titlePad: 14, titleSize: 22, navPad: '10px 4px 6px', homeH: 18, homeW: 100 };

  useEffect(() => { const el = scroll.current; if (el) el.scrollTop = tab === 'chat' ? el.scrollHeight : 0; }, [tab]);
  useEffect(() => { const el = scroll.current; if (el && tab === 'chat') el.scrollTop = el.scrollHeight; }, [chat, tab]);

  const go = (t: Tab) => { setTab(t); setSub(null); };
  const u = UNITS[unit];
  const latest = data.statements[0];
  const monthStartOf = (m: string) => `${m}-01`;
  const kase = sub?.type === 'case' ? data.cases.find(c => c.id === sub.id)! : null;

  return (
    <div className={`sc-phone ${platform}`}>
      <div style={{ height: fr.sb, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${fr.sbPad}px`, fontSize: fr.sbFont, fontWeight: 700, background: 'var(--sc-page)', position: 'relative' }}>
        <span>9:41</span>
        <span style={{ position: 'absolute', left: '50%', top: fr.camTop, transform: 'translateX(-50%)', width: fr.camW, height: fr.camH, borderRadius: 999, background: 'var(--sc-camera)' }} />
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}><span style={{ width: 15, height: 9, borderRadius: 2, background: 'var(--sc-ink)' }} /><span style={{ width: 20, height: 10, borderRadius: 3, border: '1.5px solid var(--sc-ink)' }} /></span>
      </div>

      <div ref={scroll} className="sc-phone-scroll">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: fr.titlePad }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--sc-teal-tint)', color: 'var(--sc-teal-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Svg d={ICON[tab]} size={18} /></span>
          <div style={{ fontSize: fr.titleSize, fontWeight: 800, letterSpacing: '-0.01em', flex: 1 }}>{TITLE[tab]}</div>
          {tab === 'home' && <button type="button" aria-label="My profile" onClick={() => setSub({ type: 'profile' })} style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', background: 'var(--sc-tint-4)', fontSize: 13, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>{OWNER.initials}</button>}
        </div>

        {tab === 'cal' && (
          <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--sc-page)', margin: '-8px -18px 0', padding: '8px 18px 0', borderBottom: '1px solid var(--sc-seg)' }}>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 10 }}>
              {UNITS.map((x, k) => <button key={x.id} type="button" className="sc-chip sm" style={{ flexShrink: 0 }} aria-pressed={unit === k} onClick={() => setUnit(k)}>{x.unit}</button>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', paddingBottom: 6 }}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--sc-faint)' }}>{d}</div>)}</div>
          </div>
        )}

        {tab === 'home' && (
          <>
            <div style={{ background: 'var(--sc-dark)', color: 'var(--sc-surface)', borderRadius: 22, padding: 22 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sc-teal-eyebrow)', letterSpacing: '0.06em' }}>NEXT PAYOUT · {dateShort(`${monthShift(today, 1)}-07`).toUpperCase()}</div>
              <div className="num" style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 8 }}>{rmShort(latest.payout)}</div>
              <div style={{ fontSize: 12, color: 'var(--sc-dark-soft)', marginTop: 4, lineHeight: 1.5 }}>{monthLabel(latest.month, { long: true }).split(' ')[0]} statement · guaranteed {rmShort(GUARANTEE)} / month</div>
              <button type="button" onClick={() => go('pay')} style={{ marginTop: 16, height: 36, padding: '0 16px', border: 'none', borderRadius: 999, background: 'var(--sc-surface)', color: 'var(--sc-ink)', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>View statements</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[[`${occupancy(data.stays, UNITS.map(x => x.id), monthStartOf(today.slice(0, 7)), addDays(today, 1))}%`, `occupancy · ${monthLabel(today).slice(0, 3)}`, ''], ['4.86 ★', 'guest rating', ''], ['1.4%', 'cancellation rate', 'var(--sc-teal)'], ['11.2 d', 'booking lead time', '']].map(([v, l, c]) => (
                <div key={l} className="sc-phone-card"><div className="num" style={{ fontSize: 24, fontWeight: 800, color: c || undefined }}>{v}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)', marginTop: 2 }}>{l}</div></div>
              ))}
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4 }}>My units</div>
            <div style={{ display: 'flex', gap: 14, overflowX: 'auto', scrollbarWidth: 'none', margin: '-8px -18px 0', padding: '0 18px' }}>
              {UNITS.map(x => (
                <div key={x.id} style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Photo label="listing photo" style={{ width: '100%', height: 140, borderRadius: 16 }} />
                  <div className="ellipsis" style={{ fontSize: 14, fontWeight: 700 }}>{x.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--sc-muted)', marginTop: -4 }}>{x.unit} · {occupancy(data.stays, [x.id], monthStartOf(today.slice(0, 7)), addDays(monthStartOf(monthShift(today, 1)), 0))}% in {monthLabel(today).slice(0, 3)}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4 }}>Recent 5-star reviews</div>
            {data.reviews.slice(0, 3).map((r, k) => (
              <div key={k} className="sc-phone-card" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: -8 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><div className="sc-avatar" style={{ width: 34, height: 34, fontSize: 12, background: `var(--sc-tint-${k})` }}>{r.guest[0]}</div><div><div style={{ fontSize: 14, fontWeight: 700 }}>{r.guest}</div><div style={{ fontSize: 11, color: 'var(--sc-muted)' }}>{dateShort(r.from)} – {dateShort(r.to)} · {UNITS.find(x => x.id === r.unitId)!.unit}</div></div></div>
                <div style={{ color: 'var(--sc-star)', fontSize: 12, letterSpacing: 2 }}>★★★★★</div>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>{r.text}</div>
              </div>
            ))}
          </>
        )}

        {tab === 'cal' && [today.slice(0, 7), monthShift(today, 1)].map(m => <PhoneMonth key={`${m}-${u.id}`} month={m} unitId={u.id} base={u.base} stays={data.stays} today={today} onOpen={s => setSub({ type: 'stay', s })} />)}

        {tab === 'cases' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[[data.cases.length, 'cases this month'], [12, 'linen changes'], ['2h 41m', 'avg time to fix'], [data.cases.filter(c => !c.done).length, 'open now']].map(([v, l]) => <div key={String(l)} className="sc-phone-card"><div className="num" style={{ fontSize: 22, fontWeight: 800 }}>{v}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)', marginTop: 2 }}>{l}</div></div>)}
            </div>
            {data.cases.slice(0, 4).map(c => (
              <button key={c.id} type="button" className="sc-phone-card" onClick={() => setSub({ type: 'case', id: c.id })} style={{ display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer', textAlign: 'left', marginTop: -6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}><span style={{ fontSize: 12, fontWeight: 700, color: 'var(--sc-muted)' }}>{c.id} · {at(c.trail[0].at)}</span><span className={`sc-status ${c.done ? 'ok' : 'open'}`} style={{ fontSize: 11, padding: '3px 9px' }}>{c.done ? 'Resolved' : 'In progress'}</span></div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{c.title}</div>
                <div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{UNITS.find(x => x.id === c.unitId)!.unit} · {c.cat}</div>
              </button>
            ))}
          </>
        )}

        {tab === 'pay' && (
          <>
            <div style={{ background: 'var(--sc-dark)', color: 'var(--sc-surface)', borderRadius: 22, padding: 22 }}><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sc-teal-eyebrow)', letterSpacing: '0.06em' }}>GUARANTEED RETURN</div><div className="num" style={{ fontSize: 30, fontWeight: 800, marginTop: 8 }}>{rmShort(GUARANTEE)}<span style={{ fontSize: 14, color: 'var(--sc-dark-muted)' }}> / month</span></div><div style={{ fontSize: 12, color: 'var(--sc-dark-soft)', marginTop: 4 }}>Topped up when bookings fall short</div></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="sc-phone-card"><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>Total paid out</div><div className="num" style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{rmShort(latest.acc)}</div></div>
              <div className="sc-phone-card"><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>Income {today.slice(0, 4)}</div><div className="num" style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{rmShort(data.statements.filter(s => s.month.startsWith(today.slice(0, 4))).reduce((n, s) => n + s.payout, 0))}</div></div>
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4 }}>Monthly statements</div>
            <div style={{ background: 'var(--sc-surface)', border: '1px solid var(--sc-line)', borderRadius: 18, overflow: 'hidden', marginTop: -8 }}>
              {data.statements.map(m => (
                <button key={m.month} type="button" onClick={() => setSub({ type: 'bill', m })} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '15px 16px', border: 'none', borderBottom: '1px solid var(--sc-subtle)', background: 'var(--sc-surface)', cursor: 'pointer', textAlign: 'left' }}>
                  <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700 }}>{monthLabel(m.month, { long: true })}</div><div style={{ fontSize: 11, color: 'var(--sc-muted)' }}>{m.nights} nights · top-up {m.topup ? rmShort(m.topup) : '-'}</div></div>
                  <div style={{ textAlign: 'right' }}><div className="num" style={{ fontSize: 14, fontWeight: 800 }}>{rmShort(m.payout)}</div><div style={{ fontSize: 11, fontWeight: 700, color: m.processing ? 'var(--sc-amber-ink)' : 'var(--sc-green-ink)' }}>{m.processing ? 'Processing' : 'Paid'}</div></div>
                  <span style={{ color: 'var(--sc-faint)' }}>›</span>
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'chat' && (
          <>
            <div className="sc-phone-card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}><div className="sc-avatar" style={{ width: 38, height: 38, fontSize: 13, background: 'var(--sc-tint-1)' }}>{MANAGER.initials}</div><div><div style={{ fontSize: 14, fontWeight: 800 }}>{MANAGER.name}</div><div style={{ fontSize: 11, color: 'var(--sc-green-ink)', fontWeight: 700 }}>Online · replies in ~5 min</div></div></div>
            {chat.map((m, k) => (
              <div key={k} style={{ display: 'flex', justifyContent: m.me ? 'flex-end' : 'flex-start', marginTop: -6 }}>
                <div style={{ maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 3, alignItems: m.me ? 'flex-end' : 'flex-start' }}>
                  <div className={`sc-bubble ${m.me ? 'me' : 'them'}`} style={{ padding: '10px 14px', fontSize: 13, lineHeight: 1.45 }}>{m.text}</div>
                  <div style={{ fontSize: 10, color: 'var(--sc-faint)' }}>{m.me ? 'You' : 'Aina'} · {dateShort(m.at.slice(0, 10))}</div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {tab === 'chat' && (
        <div style={{ flexShrink: 0, display: 'flex', gap: 8, padding: '10px 12px', background: 'var(--sc-surface)', borderTop: '1px solid var(--sc-line)' }}>
          <input className="sc-input" style={{ height: 42, padding: '0 16px' }} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { send(draft); setDraft(''); } }} placeholder="Message The Conts..." aria-label="Message" />
          <button type="button" className="sc-btn-dark" style={{ height: 42, padding: '0 16px', fontSize: 13 }} onClick={() => { send(draft); setDraft(''); }}>Send</button>
        </div>
      )}

      <nav className="sc-phone-tabs" style={{ padding: fr.navPad }} aria-label="Owner app">
        {TABS.map(([k, l]) => <button key={k} type="button" className="sc-phone-tab" aria-current={tab === k ? 'page' : undefined} onClick={() => go(k)}><span className="icon"><Svg d={ICON[k]} /></span>{l}</button>)}
      </nav>
      <div className="sc-phone-home" style={{ height: fr.homeH }}><span style={{ width: fr.homeW, height: 5, borderRadius: 3, background: 'var(--sc-ink)' }} /></div>

      {sub && (
        <div className="sc-phone-sub" style={{ top: fr.sb }}>
          <div style={{ height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
            <button type="button" onClick={() => setSub(null)} style={{ border: 'none', background: 'transparent', fontSize: 15, fontWeight: 700, color: 'var(--sc-teal)', cursor: 'pointer', padding: 0 }}>‹ {TITLE[tab]}</button>
            <div style={{ fontSize: 14, fontWeight: 800 }}>{sub.type === 'stay' ? 'Reservation' : sub.type === 'case' ? sub.id : sub.type === 'bill' ? 'Statement' : 'My profile'}</div>
            <span style={{ width: 60 }} />
          </div>
          <div className="sc-phone-scroll" style={{ padding: '4px 16px 100px', gap: 14, background: 'var(--sc-past)' }}>
            {sub.type === 'stay' && <StayPage s={sub.s} today={today} />}
            {kase && (
              <>
                <div style={{ padding: '8px 0 4px' }}><div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>{kase.title}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)', marginTop: 2 }}>{UNITS.find(x => x.id === kase.unitId)!.unit} · {kase.cat}</div></div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {[['Status', kase.done ? 'Resolved' : 'In progress', kase.done ? 'var(--sc-green-ink)' : 'var(--sc-amber-ink)'], ['Time to fix', kase.ttf, ''], ['Operator', kase.operator.split(' (')[0], '']].map(([l, v, c]) => <div key={l} style={{ background: 'var(--sc-surface)', borderRadius: 14, padding: 12 }}><div style={{ fontSize: 10, color: 'var(--sc-muted)' }}>{l}</div><div style={{ fontSize: 13, fontWeight: 800, color: c || undefined }}>{v}</div></div>)}
                </div>
                <div className="sc-phone-white"><div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>Audit trail</div><CaseTrail c={kase} small /></div>
                <div className="sc-phone-white"><div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>Photos</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>{kase.photos.map(p => <button key={p} type="button" className="sc-photo" onClick={() => setPhoto(p)} style={{ aspectRatio: '1', border: 'none', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'flex-end', padding: 6 }}><span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'var(--sc-surface)', position: 'relative' }}>{p}</span></button>)}</div>
                </div>
              </>
            )}
            {sub.type === 'bill' && (
              <>
                <div style={{ padding: '8px 0 4px' }}><div style={{ fontSize: 12, fontWeight: 700, color: 'var(--sc-muted)', letterSpacing: '0.05em' }}>OWNER STATEMENT</div><div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>{monthLabel(sub.m.month, { long: true })}</div></div>
                <div className="sc-phone-white" style={{ padding: '6px 18px' }}>
                  {[['Gross revenue', rm(sub.m.gross)], ['Fees & costs', `− ${rm(sub.m.costs)}`], ['Net income', rm(sub.m.net)], ['Guarantee top-up', sub.m.topup ? `+ ${rm(sub.m.topup)}` : 'Not needed'], ['Accumulated payout', rm(sub.m.acc)]].map(([l, v]) => <div key={l} className="num" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--sc-subtle)', fontSize: 13 }}><span style={{ color: 'var(--sc-muted)' }}>{l}</span><b>{v}</b></div>)}
                </div>
                <div style={{ background: 'var(--sc-dark)', color: 'var(--sc-surface)', borderRadius: 20, padding: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><span style={{ fontSize: 14, fontWeight: 800 }}>Payout</span><span className="num" style={{ fontSize: 24, fontWeight: 800 }}>{rm(sub.m.payout)}</span></div>
              </>
            )}
            {sub.type === 'profile' && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '14px 0 6px' }}><div className="sc-avatar" style={{ width: 84, height: 84, fontSize: 28, background: 'var(--sc-tint-4)' }}>{OWNER.initials}</div><div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{OWNER.name}</div><div style={{ fontSize: 13, color: 'var(--sc-muted)' }}>Owner since {OWNER.since} · 3 units</div></div>
                <div style={{ background: 'var(--sc-surface)', borderRadius: 20, overflow: 'hidden' }}>
                  {PROFILE.map(([k, l]) => (
                    <button key={k} type="button" onClick={() => { setEdit(k); setEditVal(''); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', border: 'none', borderBottom: '1px solid var(--sc-subtle)', background: 'var(--sc-surface)', cursor: 'pointer', textAlign: 'left' }}>
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{l}</div><div className="ellipsis" style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{OWNER.profile[k]}</div></div>
                      {pending[k] && <span className="sc-status open" style={{ fontSize: 10, padding: '3px 8px' }}>Pending</span>}
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--sc-teal)', whiteSpace: 'nowrap' }}>Change ›</span>
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: 'var(--sc-muted)', textAlign: 'center', lineHeight: 1.5, padding: '0 12px' }}>Change requests are reviewed by The Conts within 1 working day. We will confirm by email.</div>
              </>
            )}
          </div>
          {sub.type === 'stay' && (
            <button type="button" onClick={() => { const s = sub.s; setSub(null); setTab('chat'); send(`Question about ${s.guest}'s stay (${s.code}).`); }}
              style={{ position: 'absolute', bottom: 28, left: '50%', transform: 'translateX(-50%)', height: 48, padding: '0 24px', border: 'none', borderRadius: 999, background: 'var(--sc-ink)', color: 'var(--sc-surface)', fontSize: 14, fontWeight: 800, cursor: 'pointer', boxShadow: '0 8px 24px rgba(28,27,25,0.25)', whiteSpace: 'nowrap' }}>Message The Conts</button>
          )}
        </div>
      )}

      {edit && (
        <>
          <div onClick={() => setEdit(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(28,27,25,0.35)', zIndex: 8, animation: 'scFade 200ms ease-out' }} />
          <div className="sc-phone-sheet" role="dialog" aria-label="Request a change">
            <div style={{ width: 40, height: 5, borderRadius: 3, background: 'var(--sc-control)', margin: '0 auto 4px' }} />
            <div style={{ fontSize: 18, fontWeight: 800 }}>Request change · {PROFILE.find(p => p[0] === edit)![1]}</div>
            <div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>Current: {OWNER.profile[edit]}</div>
            <input autoFocus type={edit === 'password' ? 'password' : 'text'} value={editVal} onChange={e => setEditVal(e.target.value)} placeholder={`New ${PROFILE.find(p => p[0] === edit)![1].toLowerCase()}`} aria-label="New value"
              style={{ height: 46, border: '1px solid var(--sc-ink)', borderRadius: 12, padding: '0 14px', fontSize: 15, outline: 'none', color: 'var(--sc-ink)' }} />
            <button type="button" className="sc-btn-dark" style={{ borderRadius: 12 }} disabled={!editVal.trim()} onClick={() => { setPending(p => ({ ...p, [edit]: true })); setEdit(null); }}>Send request</button>
          </div>
        </>
      )}

      {photo && (
        <div onClick={() => setPhoto(null)} style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'rgba(20,20,19,0.92)', animation: 'scFade 200ms ease-out', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <div className="sc-lightbox-photo" style={{ width: '88%', aspectRatio: '3 / 4', borderRadius: 14, fontSize: 12 }}>{photo} · case photo</div>
          <div style={{ color: 'var(--sc-surface)', fontSize: 12 }}>Tap anywhere to close</div>
        </div>
      )}
    </div>
  );
}

function StayPage({ s, today }: { s: SampleStay; today: string }) {
  const st = stayStatus(s, today);
  const u = UNITS.find(x => x.id === s.unitId)!;
  const n = daysBetween(s.checkIn, s.checkOut);
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '18px 0 8px', textAlign: 'center' }}>
        <div style={{ position: 'relative', width: 132, height: 100 }}>
          <div className="sc-avatar" style={{ position: 'absolute', left: 8, top: 6, width: 92, height: 92, fontSize: 34, background: `var(--sc-tint-${s.tint})`, border: '4px solid var(--sc-past)' }}>{s.guest[0]}</div>
          {s.guests > 1 && <div style={{ position: 'absolute', right: 0, top: 0, width: 52, height: 52, borderRadius: '50%', background: 'var(--sc-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, border: '4px solid var(--sc-past)' }}>+{s.guests - 1}</div>}
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 6 }}>{s.guests > 1 ? `${s.guest}'s party of ${s.guests}` : s.guest}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sc-ink-2)' }}>{dateShort(s.checkIn)} – {dateShort(s.checkOut)} · {nightsLabel(n)}</div>
        <div style={{ fontSize: 13, color: 'var(--sc-muted)' }}>{u.unit} · {u.name}</div>
        <span className="sc-status" style={{ marginTop: 6, fontSize: 11, fontWeight: 800, background: st === 'completed' ? 'var(--sc-seg)' : 'var(--sc-teal-tint)', color: st === 'completed' ? 'var(--sc-ink-2)' : 'var(--sc-teal-deep)' }}>{STATUS_WORD[st]}</span>
      </div>
      <div className="sc-phone-white" style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', gap: 14 }}>
        <div><div style={{ fontSize: 14, fontWeight: 800 }}>Check-in</div><div style={{ fontSize: 13, color: 'var(--sc-muted)', marginTop: 4 }}>{weekdayDate(s.checkIn)}</div><div style={{ fontSize: 13, color: 'var(--sc-muted)' }}>3:00 PM</div></div>
        <div style={{ background: 'var(--sc-seg)' }} />
        <div style={{ textAlign: 'right' }}><div style={{ fontSize: 14, fontWeight: 800 }}>Check-out</div><div style={{ fontSize: 13, color: 'var(--sc-muted)', marginTop: 4 }}>{weekdayDate(s.checkOut)}</div><div style={{ fontSize: 13, color: 'var(--sc-muted)' }}>11:00 AM</div></div>
      </div>
      <div className="sc-phone-white" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>Guest</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><div className="sc-avatar" style={{ width: 40, height: 40, fontSize: 14, background: `var(--sc-tint-${s.tint})` }}>{s.guest[0]}</div><div><div style={{ fontSize: 14, fontWeight: 700 }}>{s.guest}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>Verified on Airbnb · from {s.country}</div></div></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderTop: '1px solid var(--sc-subtle)', paddingTop: 12 }}><span style={{ color: 'var(--sc-muted)' }}>Guests</span><b>{s.guests} {s.guests === 1 ? 'adult' : 'adults'}</b></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: 'var(--sc-muted)' }}>Confirmation</span><b>{s.code}</b></div>
      </div>
      <div className="sc-phone-white" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><span style={{ fontSize: 14, fontWeight: 800 }}>Booking value</span><span className="num" style={{ fontSize: 20, fontWeight: 800 }}>{rm(s.total)}</span></div>
    </>
  );
}

/** One month of a unit's stays as continuous bars per week row, like Airbnb's host app. */
function PhoneMonth({ month, unitId, base, stays, today, onOpen }: { month: string; unitId: string; base: number; stays: SampleStay[]; today: string; onOpen: (s: SampleStay) => void }) {
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const last = addDays(first, dim);
  const mine = stays.filter(s => s.unitId === unitId);
  const weeks = Math.ceil((lead + dim) / 7);
  let booked = 0, revenue = 0;
  for (let d = first; d < last; d = addDays(d, 1)) if (mine.some(s => s.checkIn <= d && d < s.checkOut)) booked++;
  for (const s of mine) if (s.checkIn < last && s.checkOut > first) revenue += s.total;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '0 -10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 10px 6px' }}><div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>{monthLabel(month, { long: true }).split(' ')[0]}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{Math.round((booked / dim) * 100)}% booked · {rmShort(revenue)}</div></div>
      {Array.from({ length: weeks }, (_, w) => {
        const d0 = addDays(first, w * 7 - lead);
        const d7 = addDays(d0, 7);
        const lo = d0 > first ? d0 : first, hi = d7 < last ? d7 : last;
        const segs = mine.filter(s => s.checkIn < hi && s.checkOut > lo);
        return (
          <div key={w} style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', height: 72 }}>
            {Array.from({ length: 7 }, (_, c) => {
              const d = addDays(d0, c), inMonth = d >= first && d < last;
              const taken = mine.some(s => s.checkIn <= d && d < s.checkOut);
              return (
                <div key={c} className={`sc-phone-day${d < today ? ' past' : ''}`} style={{ visibility: inMonth ? 'visible' : 'hidden' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: d === today ? 'var(--sc-teal)' : 'transparent', color: d === today ? 'var(--sc-surface)' : d < today ? 'var(--sc-faint)' : 'var(--sc-ink)' }}>{Number(d.slice(8, 10))}</span>
                  <span style={{ fontSize: 9, color: 'var(--sc-faint)', fontWeight: 600 }}>{inMonth && !taken && d >= today ? rmShort(base).replace(' ', '') : ''}</span>
                </div>
              );
            })}
            {segs.map(s => {
              const a = Math.max(daysBetween(d0, s.checkIn) + 0.5, daysBetween(d0, lo)), e = Math.min(daysBetween(d0, s.checkOut) + 0.5, daysBetween(d0, hi));
              const realS = a === daysBetween(d0, s.checkIn) + 0.5, realE = e === daysBetween(d0, s.checkOut) + 0.5, wd = e - a;
              if (wd <= 0) return null;
              return (
                <button key={s.id} type="button" className={`sc-phone-bar ${stayStatus(s, today)}`} onClick={() => onOpen(s)}
                  style={{ left: `${(a / 7) * 100}%`, width: `${(wd / 7) * 100}%`, borderRadius: `${realS ? 14 : 0}px ${realE ? 14 : 0}px ${realE ? 14 : 0}px ${realS ? 14 : 0}px`, padding: `0 ${realS ? 3 : 8}px` }}>
                  {wd >= 1.6 && <><span className="sc-avatar" style={{ width: 22, height: 22, fontSize: 10, background: `var(--sc-tint-${s.tint})` }}>{s.guest[0]}</span><span className="ellipsis" style={{ fontSize: 12, fontWeight: 700 }}>{s.guest.split(' ')[0]}{s.guests > 1 ? ` + ${s.guests - 1}` : ''}</span></>}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
