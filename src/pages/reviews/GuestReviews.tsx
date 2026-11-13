import { useEffect, useState } from 'react';
import { Switch } from '../../components/Switch';
import { Link } from 'react-router-dom';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { Segmented } from '../../components/Metric';
import { EmptyState } from '../../components/States';
import { StaleBanner, TableSkeleton } from '../../components/DataState';
import { StatusBadge } from '../../components/StatusBadge';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import Icon from '../../components/Icon';
import { api, errorMessage, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { date as fmtDate, dateRange, dateTime, count, plural, buildingName } from '../../lib/format';
import { cx, TONE } from '../../lib/design-tokens';
import { useUrlState } from '../finance/listKit';
import {
  GUEST_REVIEW_CATEGORIES, GUEST_CATEGORY_LABELS, GUEST_REVIEW_TAGS, GUEST_REVIEW_WINDOW_DAYS, BAD_GUEST_SEND_DAY,
  tagInfo, timeLeft, type GuestReviewCategory,
} from '../../lib/reviewRules';
import { Avatar, Notice, StarMark } from './reviewUi';

/* Review guests (owner, 3 Nov 2026): Airbnb lets the host review the guest for GUEST_REVIEW_WINDOW_DAYS after checkout,
 * and hides the guest's review of us until we do. The form follows Airbnb's own steps: cleanliness, communication and
 * respect for house rules (stars and tags each), the public review, a private note to the guest, and whether we would
 * host them again. Rules write the easy ones by themselves; a Bad guest's review waits to day BAD_GUEST_SEND_DAY. */

interface GReview {
  id: string; state: 'needs_approval' | 'scheduled' | 'sent' | 'failed'; source: 'manual' | 'rule'; ruleName: string | null;
  cleanliness: number; communication: number; respect_house_rules: number; publicReview: string; privateNote: string; recommend: boolean; tags: string[];
  sendAfter: string | null; attempts: number; lastError: string | null; sentAt: string | null; writtenBy: string | null;
}
export interface GuestStay {
  reservationId: string; guestName: string; unitId: string; unitNumber: string; propertyName: string | null; checkIn: string; checkOut: string; bookingRef: string | null;
  deadline: string; windowOpen: boolean; badGuest: boolean; badGuestNote: string | null; badGuestSendAt: string; blacklisted: boolean;
  theirReview: { id: string; linked: boolean; hidden: boolean; rating: number | null } | null;
  review: GReview | null;
}
interface Payload {
  data: GuestStay[]; channexConnected: boolean;
  counts: { due: number; notWritten: number; needsApproval: number; failed: number; held: number; closingSoon: number };
}
type Send = { state: 'sent' | 'scheduled' | 'failed'; reason?: string };

const stateOf = (s: GuestStay): string => {
  const r = s.review;
  if (!r) return s.windowOpen ? 'to_write' : 'closed';
  if (r.state === 'scheduled') return s.badGuest ? 'held' : r.lastError ? 'waiting' : 'scheduled';
  return r.state;
};

function sendToast(toast: ReturnType<typeof useToast>, send: Send | undefined, guest: string) {
  if (!send) return;
  if (send.state === 'sent') toast({ tone: 'success', title: `Review of ${guest} sent to Airbnb.` });
  else if (send.state === 'scheduled') toast({ tone: 'info', title: 'Review saved, not sent yet.', body: send.reason ?? 'It goes on the next run.' });
  else toast({ tone: 'warning', title: 'Review saved, not sent.', body: `${send.reason ?? 'Airbnb did not take it.'} Use Retry.` });
}

/** The 14-day countdown, as Airbnb shows it above the form. */
function Countdown({ deadline, compact }: { deadline: string; compact?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
  const left = timeLeft(deadline, now);
  const urgent = !left.closed && left.ms < 2 * 864e5;
  return (
    <span className={cx('inline-flex items-center gap-1.5 font-semibold', compact ? 'text-meta' : 'text-copy', left.closed ? 'text-muted-ink' : urgent ? TONE.critical.text : 'text-ink')}>
      <Icon name="Clock" size="sm" />{left.text}
    </span>
  );
}

export function GuestReviews({ canWrite }: { canWrite: boolean }) {
  const url = useUrlState();
  const toast = useToast();
  const [confirmUi, ask] = useConfirm();
  const v = url.get('gview');
  const view = v === 'sent' || v === 'all' ? v : 'due';
  const { data, loading, error, reload } = useApi<Payload>(`/reviews/guest-reviews?view=${view}`);
  const [writing, setWriting] = useState<GuestStay | null>(null);
  const [panel, setPanel] = useState<'templates' | 'rules' | 'settings' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const c = data?.counts;

  async function act(s: GuestStay, action: 'approve' | 'retry' | 'discard') {
    if (!s.review) return;
    if (action === 'discard') {
      const ok = await ask({ title: `Drop this review of ${s.guestName}?`, body: 'It has not been sent. You can write it again while the window is open.', confirmLabel: 'Drop review', cancelLabel: 'Keep review', danger: true });
      if (ok === null) return;
    }
    setBusy(s.reservationId);
    try {
      const res = await api.post<{ send?: Send }>(`/reviews/guest-reviews/${s.review.id}/${action}`, {});
      if (action === 'discard') toast({ tone: 'success', title: 'Review dropped.' }); else sendToast(toast, res.send, s.guestName);
      reload();
    } catch (e) { toast({ tone: 'critical', title: 'That did not work.', body: errorMessage(e) }); }
    finally { setBusy(null); }
  }

  async function flag(s: GuestStay) {
    let note: string | null = null;
    if (!s.badGuest) {
      note = await ask({ title: `Mark ${s.guestName} as a Bad guest?`, body: `No rule will review them. The review you write is held and sent on day ${BAD_GUEST_SEND_DAY} after checkout (${dateTime(s.badGuestSendAt)}), just before Airbnb closes the window, so they cannot answer it with a review of their own.`, confirmLabel: 'Mark as Bad guest', cancelLabel: 'Back', danger: true, reason: { label: 'What happened (kept here only)', placeholder: 'Smoking in the unit, party, damage ...', optional: true, maxLength: 500 } });
      if (note === null) return;
    }
    setBusy(s.reservationId);
    try {
      await api.post('/reviews/guest-reviews/bad-guest', { reservationId: s.reservationId, badGuest: !s.badGuest, note: note || null });
      toast({ tone: 'success', title: s.badGuest ? 'Bad guest flag removed.' : 'Marked as Bad guest.' });
      reload();
    } catch (e) { toast({ tone: 'critical', title: 'That did not work.', body: errorMessage(e) }); }
    finally { setBusy(null); }
  }

  async function runNow() {
    setBusy('run');
    try {
      const r = await api.post<{ written: number; approval: number; sent: number; waiting: number; failed: number }>('/reviews/guest-reviews/run', {});
      toast({ tone: 'success', title: 'Rules ran.', body: `${plural(r.written + r.approval, 'review')} written (${r.approval} for approval), ${r.sent} sent, ${r.waiting} waiting for Airbnb, ${r.failed} not sent.` });
      reload();
    } catch (e) { toast({ tone: 'critical', title: 'Rules did not run.', body: errorMessage(e) }); }
    finally { setBusy(null); }
  }

  return (
    <>
      {confirmUi}
      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="m-0 text-copy text-muted-ink max-w-[640px]">
          Airbnb gives you {GUEST_REVIEW_WINDOW_DAYS} days after checkout to review each guest, and shows their review of you only once you have.
        </p>
        {canWrite && (
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="secondary" icon={<Icon name="Play" size="sm" />} loading={busy === 'run'} onClick={runNow}>Run rules now</Button>
            <Button size="sm" variant="secondary" onClick={() => setPanel('templates')}>Templates</Button>
            <Button size="sm" variant="secondary" onClick={() => setPanel('rules')}>Auto rules</Button>
            <Button size="sm" variant="secondary" icon={<Icon name="Settings" size="sm" />} onClick={() => setPanel('settings')}>Settings</Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: 'To review', value: c?.notWritten, tone: c?.notWritten ? 'warning' : undefined, hint: c ? `${count(c.due)} with the window open` : undefined },
          { label: 'Close within 2 days', value: c?.closingSoon, tone: c?.closingSoon ? 'critical' : undefined, hint: 'Not written yet' },
          { label: 'Need approval', value: c?.needsApproval, tone: c?.needsApproval ? 'warning' : undefined, hint: 'Written by a rule' },
          { label: 'Not sent', value: c?.failed, tone: c?.failed ? 'critical' : undefined, hint: c?.held ? `${c.held} held for Bad guests` : 'Use Retry' },
        ].map(t => (
          <div key={t.label} className={cx('rounded-card border border-solid p-4 flex flex-col gap-1.5 min-w-0', t.tone ? cx(TONE[t.tone as 'warning'].border, TONE[t.tone as 'warning'].bg) : 'border-line bg-card')}>
            <span className={cx('text-caption font-semibold tracking-[0.12em] uppercase', t.tone ? TONE[t.tone as 'warning'].text : 'text-muted-ink')}>{t.label}</span>
            <span className={cx('text-headline leading-none font-semibold tabular-nums', t.tone ? TONE[t.tone as 'warning'].text : 'text-ink')}>{t.value == null ? '–' : count(t.value)}</span>
            {t.hint && <span className="text-meta text-muted-ink">{t.hint}</span>}
          </div>
        ))}
      </div>

      <Segmented label="Which stays" value={view} onChange={k => url.set({ gview: k === 'due' ? null : k })}
        options={[{ key: 'due', label: 'To review', count: c?.due }, { key: 'sent', label: 'Sent' }, { key: 'all', label: 'Last 30 days' }]} />

      {data && !data.channexConnected && (
        <Notice icon="TriangleAlert" tone="warning" title="Channex is not connected here">Reviews are saved, and sent once Channex is connected.</Notice>
      )}

      {!data && loading ? <Card><TableSkeleton rows={4} cols={3} /></Card> : (data?.data.length ?? 0) === 0 ? (
        <EmptyState icon="Star" title={view === 'due' ? 'No Airbnb guest is waiting for a review' : view === 'sent' ? 'No guest reviews sent in this period' : 'No Airbnb checkouts in the last 30 days'}
          body={view === 'due' ? `Airbnb stays show here from checkout until the ${GUEST_REVIEW_WINDOW_DAYS}-day window closes.` : undefined} />
      ) : (
        <div className="flex flex-col gap-3">
          {data!.data.map(s => {
            const st = stateOf(s);
            const r = s.review;
            const isBusy = busy === s.reservationId;
            return (
              <Card key={s.reservationId}>
                <div className="px-4 sm:px-6 py-5 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={s.guestName} />
                      <div className="flex flex-col min-w-0">
                        <span className="text-copy font-semibold truncate">{s.guestName}</span>
                        <span className="text-meta text-muted-ink">{dateRange(s.checkIn, s.checkOut)} · {[buildingName(s.propertyName), s.unitNumber].filter(Boolean).join(' ')}</span>
                        <Link to={`/reservations/bookings?open=${encodeURIComponent(s.reservationId)}`} className="text-meta text-ink-2 w-fit">Reservation{s.bookingRef ? ` ${s.bookingRef}` : ''}</Link>
                      </div>
                    </div>
                    <StatusBadge entity="guest_review" value={st} size="sm" />
                  </div>

                  {st !== 'sent' && s.windowOpen && (
                    <div className="flex items-center justify-between gap-3 flex-wrap rounded-control bg-muted px-3 py-2">
                      <Countdown deadline={s.deadline} compact />
                      <span className="text-meta text-muted-ink">Closes {dateTime(s.deadline)}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted-ink">
                    {s.theirReview
                      ? <span className="inline-flex items-center gap-1.5"><Icon name={s.theirReview.hidden ? 'EyeOff' : 'Eye'} size="sm" />{s.theirReview.hidden ? 'Their review is in, hidden until you review them' : 'Their review is visible'}</span>
                      : <span className="inline-flex items-center gap-1.5"><Icon name="Clock" size="sm" />Airbnb has not opened their review in Channex yet</span>}
                    {s.blacklisted && <span className={cx('inline-flex items-center gap-1.5', TONE.critical.text)}><Icon name="UserX" size="sm" />On the Blacklist: no rule reviews them</span>}
                  </div>
                  {s.badGuest && (
                    <Notice icon="UserX" tone="critical" title="Bad guest">
                      {s.badGuestNote ? `${s.badGuestNote} · ` : ''}Their review is held to day {BAD_GUEST_SEND_DAY}: {dateTime(s.badGuestSendAt)}.
                    </Notice>
                  )}
                  {r && (
                    <div className="flex flex-col gap-1.5 pl-3 sm:pl-4 [border-left:2px_solid_var(--color-line)]">
                      <span className="text-meta font-semibold">
                        Your review{r.source === 'rule' ? ` · written by rule "${r.ruleName ?? 'removed rule'}"` : r.writtenBy ? ` · by ${r.writtenBy}` : ''}
                        {r.sentAt ? <span className="font-normal text-muted-ink"> · sent {fmtDate(r.sentAt)}</span> : null}
                      </span>
                      <span className="text-meta text-muted-ink">
                        {GUEST_REVIEW_CATEGORIES.map(k => `${GUEST_CATEGORY_LABELS[k]} ${r[k]}/5`).join(' · ')} · {r.recommend ? 'Would host again' : 'Would not host again'}
                      </span>
                      <p className="m-0 text-copy leading-[1.55] whitespace-pre-line [overflow-wrap:anywhere]">{r.publicReview}</p>
                      {r.privateNote && <span className="text-meta text-muted-ink"><Icon name="Lock" size="sm" /> Private note: {r.privateNote}</span>}
                      {r.lastError && r.state !== 'sent' && <span className={cx('text-meta', r.state === 'failed' ? TONE.critical.text : 'text-muted-ink')}>{r.lastError}{r.attempts ? ` (${plural(r.attempts, 'try', 'tries')})` : ''}</span>}
                    </div>
                  )}

                  {canWrite && st !== 'sent' && (
                    <div className="flex gap-2 flex-wrap">
                      {s.windowOpen && !r && <Button size="sm" variant="brand" onClick={() => setWriting(s)}>Write a review</Button>}
                      {s.windowOpen && r?.state === 'needs_approval' && <Button size="sm" variant="brand" loading={isBusy} onClick={() => act(s, 'approve')}>Approve and send</Button>}
                      {s.windowOpen && r && <Button size="sm" variant="secondary" onClick={() => setWriting(s)}>Edit</Button>}
                      {s.windowOpen && r && (r.state === 'failed' || (r.state === 'scheduled' && !s.badGuest)) && <Button size="sm" variant="secondary" loading={isBusy} onClick={() => act(s, 'retry')}>Retry</Button>}
                      {r && <Button size="sm" variant="ghost" onClick={() => act(s, 'discard')}>Drop</Button>}
                      {s.windowOpen && <Button size="sm" variant="ghost" icon={<Icon name="UserX" size="sm" />} loading={isBusy && !r} onClick={() => flag(s)}>{s.badGuest ? 'Not a Bad guest' : 'Bad guest'}</Button>}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {writing && <GuestReviewForm stay={writing} onClose={() => setWriting(null)} onSaved={() => { setWriting(null); reload(); }} />}
      {panel === 'templates' && <TemplatesPanel onClose={() => setPanel(null)} />}
      {panel === 'rules' && <RulesPanel onClose={() => setPanel(null)} />}
      {panel === 'settings' && <SettingsPanel onClose={() => setPanel(null)} />}
    </>
  );
}

/** Five big stars to pick from. */
export function StarPicker({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`} onClick={() => onChange(n)}
          className={cx('w-11 h-11 grid place-items-center bg-transparent border-none cursor-pointer text-headline leading-none p-0', n <= value ? 'text-ink' : 'text-line')}><StarMark /></button>
      ))}
    </div>
  );
}

function TagPicker({ cat, value, onChange, rating }: { cat: GuestReviewCategory; value: string[]; onChange: (t: string[]) => void; rating: number }) {
  // Airbnb offers compliments for a good score and problems for a low one.
  const list = rating >= 4 ? GUEST_REVIEW_TAGS[cat].positive : rating > 0 ? GUEST_REVIEW_TAGS[cat].negative : [];
  if (!list.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-meta text-muted-ink">{rating >= 4 ? 'What went well? (optional)' : 'What went wrong? (optional)'}</span>
      <div className="flex flex-wrap gap-2">
        {list.map(code => {
          const on = value.includes(code);
          return (
            <button key={code} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter(x => x !== code) : [...value, code])}
              className={cx('h-9 px-3.5 rounded-full border border-solid cursor-pointer [font-family:inherit] text-meta',
                on ? 'border-black bg-black text-white' : 'border-line-strong bg-card text-ink')}>{tagInfo(code).label}</button>
          );
        })}
      </div>
    </div>
  );
}

type Draft = { cleanliness: number; communication: number; respect_house_rules: number; publicReview: string; privateNote: string; recommend: boolean | null; tags: string[] };
const STEPS = ['cleanliness', 'communication', 'respect_house_rules', 'public', 'private', 'recommend'] as const;

/** Airbnb's host-reviews-guest form, one step at a time. */
export function GuestReviewForm({ stay, onClose, onSaved }: { stay: GuestStay; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const r = stay.review;
  const [d, setD] = useState<Draft>({
    cleanliness: r?.cleanliness ?? 0, communication: r?.communication ?? 0, respect_house_rules: r?.respect_house_rules ?? 0,
    publicReview: r?.publicReview ?? '', privateNote: r?.privateNote ?? '', recommend: r ? r.recommend : null, tags: r?.tags ?? [],
  });
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [templ, setTempl] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const first = stay.guestName.split(' ')[0];
  const key = STEPS[step];
  const isCat = (GUEST_REVIEW_CATEGORIES as readonly string[]).includes(key);
  const ready = isCat ? d[key as GuestReviewCategory] > 0 : key === 'public' ? d.publicReview.trim().length > 0 : key === 'recommend' ? d.recommend !== null : true;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(x => ({ ...x, [k]: v }));
  // A tag of one category belongs to it; changing a rating clears tags that no longer fit.
  const catTags = (cat: GuestReviewCategory) => d.tags.filter(t => [...GUEST_REVIEW_TAGS[cat].positive, ...GUEST_REVIEW_TAGS[cat].negative].includes(t));
  const setCatTags = (cat: GuestReviewCategory, list: string[]) => set('tags', [...d.tags.filter(t => !catTags(cat).includes(t)), ...list]);
  const rate = (cat: GuestReviewCategory, n: number) => {
    const keep = (n >= 4 ? GUEST_REVIEW_TAGS[cat].positive : GUEST_REVIEW_TAGS[cat].negative);
    setD(x => ({ ...x, [cat]: n, tags: x.tags.filter(t => ![...GUEST_REVIEW_TAGS[cat].positive, ...GUEST_REVIEW_TAGS[cat].negative].includes(t) || keep.includes(t)) }));
  };

  async function useTemplate() {
    setTempl(true);
    try {
      const res = await api.get<{ text: string }>('/reviews/guest-templates', { pick: stay.reservationId });
      set('publicReview', res.text);
    } catch (e) {
      toast({ tone: 'warning', title: 'No template.', body: e instanceof ApiFailure && e.code === 'NO_TEMPLATE' ? 'Add one under Templates first.' : errorMessage(e) });
    } finally { setTempl(false); }
  }

  async function send() {
    setBusy(true);
    try {
      const res = await api.post<{ send: Send }>('/reviews/guest-reviews', { reservationId: stay.reservationId, ...d, recommend: d.recommend === true });
      sendToast(toast, res.send, stay.guestName);
      onSaved();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setErrors(e.fields);
      toast({ tone: 'critical', title: 'Review not saved.', body: errorMessage(e) });
    } finally { setBusy(false); }
  }

  const title = isCat ? `How was ${first}'s ${GUEST_CATEGORY_LABELS[key as GuestReviewCategory].toLowerCase()}?`
    : key === 'public' ? `Write a public review for ${first}` : key === 'private' ? `Add a private note for ${first}` : `Would you host ${first} again?`;
  const help = key === 'cleanliness' ? 'Did they leave the place the way they found it?'
    : key === 'communication' ? 'Were they responsive and easy to deal with?'
    : key === 'respect_house_rules' ? 'Did they follow the house rules?'
    : key === 'public' ? 'Shown on their Airbnb profile. Future hosts read it.'
    : key === 'private' ? 'Only they see this. Optional.' : 'Kept between you and Airbnb.';

  return (
    <Modal title={`Review ${stay.guestName}`} sub={`${dateRange(stay.checkIn, stay.checkOut)} · ${[buildingName(stay.propertyName), stay.unitNumber].filter(Boolean).join(' ')}`} onClose={onClose} width={560}
      footer={<>
        {step > 0 ? <Button variant="secondary" onClick={() => setStep(step - 1)}>Previous step</Button> : <Button variant="secondary" onClick={onClose}>Close</Button>}
        {step < STEPS.length - 1
          ? <Button variant="primary" disabled={!ready} disabledReason="Answer this step first." onClick={() => setStep(step + 1)}>Next</Button>
          : <Button variant="brand" loading={busy} disabled={!ready} disabledReason="Answer this step first." onClick={send}>{stay.badGuest ? 'Save, send on day 13' : 'Submit review'}</Button>}
      </>}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-control bg-muted px-3 py-2.5">
          <Countdown deadline={stay.deadline} />
          <span className="text-meta text-muted-ink">to review {first} on Airbnb</span>
        </div>
        {stay.badGuest && <Notice icon="UserX" tone="critical" title="Bad guest">Saved now, sent on {dateTime(stay.badGuestSendAt)} so they cannot answer it.</Notice>}
        <div className="flex gap-1" aria-hidden>
          {STEPS.map((s, i) => <span key={s} className={cx('h-1 flex-1 rounded-full', i <= step ? 'bg-ink' : 'bg-line')} />)}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-caption text-muted-ink">Step {step + 1} of {STEPS.length}</span>
          <h3 className="m-0 text-heading font-semibold leading-[1.3]">{title}</h3>
          <span className="text-copy text-muted-ink">{help}</span>
        </div>

        {isCat && (
          <>
            <StarPicker value={d[key as GuestReviewCategory]} onChange={n => rate(key as GuestReviewCategory, n)} label={GUEST_CATEGORY_LABELS[key as GuestReviewCategory]} />
            <TagPicker cat={key as GuestReviewCategory} rating={d[key as GuestReviewCategory]} value={catTags(key as GuestReviewCategory)} onChange={l => setCatTags(key as GuestReviewCategory, l)} />
          </>
        )}
        {key === 'public' && (
          <div className="flex flex-col gap-2">
            <textarea value={d.publicReview} onChange={e => set('publicReview', e.target.value)} rows={6} maxLength={1000} aria-label="Public review"
              placeholder={`${first} was a great guest ...`}
              className="w-full box-border px-3 py-2.5 [font-family:inherit] text-copy text-ink bg-card border border-solid border-line rounded-control outline-none resize-y" />
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Button size="sm" variant="secondary" loading={templ} onClick={useTemplate}>{d.publicReview ? 'Another template' : 'Use a template'}</Button>
              <span className="text-caption text-muted-ink tabular-nums">{d.publicReview.length} / 1,000</span>
            </div>
            {errors.publicReview && <span className={cx('text-meta', TONE.critical.text)}>{errors.publicReview}</span>}
          </div>
        )}
        {key === 'private' && (
          <textarea value={d.privateNote} onChange={e => set('privateNote', e.target.value)} rows={4} maxLength={1000} aria-label="Private note"
            placeholder="Thanks for looking after the place ..."
            className="w-full box-border px-3 py-2.5 [font-family:inherit] text-copy text-ink bg-card border border-solid border-line rounded-control outline-none resize-y" />
        )}
        {key === 'recommend' && (
          <div className="grid grid-cols-2 gap-3">
            {[{ v: true, label: 'Yes', icon: 'Check' }, { v: false, label: 'No', icon: 'X' }].map(o => (
              <button key={o.label} type="button" aria-pressed={d.recommend === o.v} onClick={() => set('recommend', o.v)}
                className={cx('h-20 rounded-card border border-solid cursor-pointer [font-family:inherit] text-heading font-semibold flex items-center justify-center gap-2',
                  d.recommend === o.v ? 'border-black bg-black text-white' : 'border-line-strong bg-card text-ink')}>
                <Icon name={o.icon} />{o.label}
              </button>
            ))}
          </div>
        )}
        {key === 'recommend' && d.recommend !== null && (
          <div className="flex flex-col gap-1 text-meta text-muted-ink">
            <span>{GUEST_REVIEW_CATEGORIES.map(k => `${GUEST_CATEGORY_LABELS[k]} ${d[k]}/5`).join(' · ')}</span>
            {d.tags.length > 0 && <span>Tags: {d.tags.map(t => tagInfo(t).label).join(', ')}</span>}
          </div>
        )}
      </div>
    </Modal>
  );
}

interface Template { id: string; title: string; body: string; active: boolean; useCount: number }
function TemplatesPanel({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { data, reload } = useApi<{ data: Template[] }>('/reviews/guest-templates');
  const [edit, setEdit] = useState<{ id?: string; title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function save() {
    if (!edit) return;
    setBusy(true);
    try {
      if (edit.id) await api.patch(`/reviews/guest-templates/${edit.id}`, { title: edit.title, body: edit.body });
      else await api.post('/reviews/guest-templates', { title: edit.title, body: edit.body });
      toast({ tone: 'success', title: 'Template saved.' });
      setEdit(null); setErrors({}); reload();
    } catch (e) { if (e instanceof ApiFailure && e.fields) setErrors(e.fields); toast({ tone: 'critical', title: 'Template not saved.', body: errorMessage(e) }); }
    finally { setBusy(false); }
  }
  async function toggle(t: Template) {
    try { await api.patch(`/reviews/guest-templates/${t.id}`, { active: !t.active }); reload(); }
    catch (e) { toast({ tone: 'critical', title: 'Not changed.', body: errorMessage(e) }); }
  }
  async function remove(t: Template) {
    try { await api.del(`/reviews/guest-templates/${t.id}`); toast({ tone: 'success', title: 'Template removed.' }); reload(); }
    catch (e) { toast({ tone: 'critical', title: 'Not removed.', body: errorMessage(e) }); }
  }
  return (
    <Modal title="Guest review templates" sub="A review written by a rule or with Use a template takes one at random among the least used, so guests do not all read the same words. {guest} is the guest's first name, {unit} the unit." onClose={onClose} width={620}
      footer={edit
        ? <><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save template</Button></>
        : <><Button variant="secondary" onClick={onClose}>Close</Button><Button variant="primary" onClick={() => setEdit({ title: '', body: '' })}>Add template</Button></>}>
      {edit ? (
        <div className="flex flex-col gap-3">
          <Field label="Name" value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} error={errors.title} maxLength={80} />
          <label className="flex flex-col gap-1.5 text-meta text-muted-ink">Review text
            <textarea value={edit.body} onChange={e => setEdit({ ...edit, body: e.target.value })} rows={5} maxLength={1000}
              className="w-full box-border px-3 py-2.5 [font-family:inherit] text-copy text-ink bg-card border border-solid border-line rounded-control outline-none resize-y" />
          </label>
          {errors.body && <span className={cx('text-meta', TONE.critical.text)}>{errors.body}</span>}
        </div>
      ) : (
        <div className="flex flex-col">
          {(data?.data ?? []).length === 0 && <EmptyState bare icon="FileText" title="No templates yet" body="Add three or four so rules can vary the words." />}
          {(data?.data ?? []).map(t => (
            <div key={t.id} className="flex items-start gap-3 py-3 [border-bottom:1px_solid_var(--color-line-soft)]">
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className={cx('text-copy font-medium', !t.active && 'text-muted-ink')}>{t.title}{!t.active ? ' (off)' : ''}</span>
                <span className="text-meta text-muted-ink [overflow-wrap:anywhere]">{t.body}</span>
                <span className="text-caption text-muted-ink">Used {plural(t.useCount, 'time')}</span>
              </div>
              <div className="flex gap-1 flex-wrap justify-end">
                <Button size="sm" variant="ghost" onClick={() => setEdit({ id: t.id, title: t.title, body: t.body })}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => toggle(t)}>{t.active ? 'Turn off' : 'Turn on'}</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(t)}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

interface Rule { id: string; name: string; condition: 'no_issues' | 'always'; mode: 'auto' | 'approval'; active: boolean; cleanliness: number; communication: number; respect_house_rules: number; recommend: boolean; tags: string[] }
const BLANK_RULE: Omit<Rule, 'id'> = { name: '', condition: 'no_issues', mode: 'approval', active: true, cleanliness: 5, communication: 5, respect_house_rules: 5, recommend: true, tags: [] };
function RulesPanel({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { data, reload } = useApi<{ data: Rule[] }>('/reviews/guest-rules');
  const [edit, setEdit] = useState<(Omit<Rule, 'id'> & { id?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function save() {
    if (!edit) return;
    setBusy(true);
    try {
      const { id, ...body } = edit;
      if (id) await api.patch(`/reviews/guest-rules/${id}`, body); else await api.post('/reviews/guest-rules', body);
      toast({ tone: 'success', title: 'Rule saved.' });
      setEdit(null); setErrors({}); reload();
    } catch (e) { if (e instanceof ApiFailure && e.fields) setErrors(e.fields); toast({ tone: 'critical', title: 'Rule not saved.', body: errorMessage(e) }); }
    finally { setBusy(false); }
  }
  async function remove(r: Rule) {
    try { await api.del(`/reviews/guest-rules/${r.id}`); toast({ tone: 'success', title: 'Rule removed.' }); reload(); }
    catch (e) { toast({ tone: 'critical', title: 'Not removed.', body: errorMessage(e) }); }
  }
  const cond = (c: string) => (c === 'always' ? 'Every finished stay' : 'No repair reported during the stay');
  return (
    <Modal title="Auto rules" sub="After checkout, the first rule that fits writes the review with its stars and a random template. Never for a Bad guest or a guest on the Blacklist." onClose={onClose} width={620}
      footer={edit
        ? <><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save rule</Button></>
        : <><Button variant="secondary" onClick={onClose}>Close</Button><Button variant="primary" onClick={() => setEdit({ ...BLANK_RULE })}>Add rule</Button></>}>
      {edit ? (
        <div className="flex flex-col gap-4">
          <Field label="Name" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} error={errors.name} maxLength={80} placeholder="No issues: 5 stars" />
          <div className="flex flex-col gap-1.5"><span className="text-meta text-muted-ink">When</span>
            <Segmented label="When" value={edit.condition} onChange={k => setEdit({ ...edit, condition: k })}
              options={[{ key: 'no_issues', label: 'No issues reported' }, { key: 'always', label: 'Every stay' }]} />
          </div>
          {GUEST_REVIEW_CATEGORIES.map(k => (
            <div key={k} className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-copy">{GUEST_CATEGORY_LABELS[k]}</span>
              <StarPicker value={edit[k]} onChange={n => setEdit({ ...edit, [k]: n })} label={GUEST_CATEGORY_LABELS[k]} />
            </div>
          ))}
          <div className="flex flex-col gap-1.5"><span className="text-meta text-muted-ink">Would host again</span>
            <Segmented label="Would host again" value={edit.recommend ? 'yes' : 'no'} onChange={k => setEdit({ ...edit, recommend: k === 'yes' })}
              options={[{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }]} />
          </div>
          <div className="flex flex-col gap-1.5"><span className="text-meta text-muted-ink">Then</span>
            <Segmented label="Then" value={edit.mode} onChange={k => setEdit({ ...edit, mode: k })}
              options={[{ key: 'approval', label: 'Needs approval' }, { key: 'auto', label: 'Send by itself' }]} />
          </div>
          <div className="flex flex-col gap-1.5"><span className="text-meta text-muted-ink">Rule is</span>
            <Segmented label="Rule is" value={edit.active ? 'on' : 'off'} onChange={k => setEdit({ ...edit, active: k === 'on' })}
              options={[{ key: 'on', label: 'On' }, { key: 'off', label: 'Off' }]} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          {(data?.data ?? []).length === 0 && <EmptyState bare icon="Play" title="No rules yet" body="Add one such as: no issues reported, 5 stars, needs approval." />}
          {(data?.data ?? []).map((r, i) => (
            <div key={r.id} className="flex items-start gap-3 py-3 [border-bottom:1px_solid_var(--color-line-soft)]">
              <span className="w-6 text-meta text-muted-ink tabular-nums">{i + 1}.</span>
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className={cx('text-copy font-medium', !r.active && 'text-muted-ink')}>{r.name}{!r.active ? ' (off)' : ''}</span>
                <span className="text-meta text-muted-ink">{cond(r.condition)} · {GUEST_REVIEW_CATEGORIES.map(k => `${r[k]}/5`).join(' ')} · {r.recommend ? 'host again' : 'not again'} · {r.mode === 'auto' ? 'sends by itself' : 'needs approval'}</span>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEdit({ ...r })}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(r)}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { data, reload } = useApi<{ aiConfigured: boolean; aiDrafts: boolean }>('/reviews/settings');
  const [busy, setBusy] = useState(false);
  async function flip() {
    if (!data) return;
    setBusy(true);
    try { await api.put('/reviews/settings', { aiDrafts: !data.aiDrafts }); toast({ tone: 'success', title: data.aiDrafts ? 'AI draft replies turned off.' : 'AI draft replies turned on.' }); reload(); }
    catch (e) { toast({ tone: 'critical', title: 'Not changed.', body: errorMessage(e) }); }
    finally { setBusy(false); }
  }
  return (
    <Modal title="Reviews settings" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-copy font-semibold">AI draft replies</span>
            <span className="text-meta text-muted-ink">Draft reply on a review or a guest message writes a suggestion into the reply box. It is never posted or sent by itself: someone reads it and presses Post.</span>
          </div>
          <Switch checked={!!data?.aiDrafts} label="AI draft replies" disabled={!data?.aiConfigured || busy} onChange={() => flip()} />
        </div>
        {data && !data.aiConfigured && (
          <Notice icon="Lock" tone="warning" title="AI drafting is not set up">
            It needs an AI key on this system (the secret ANTHROPIC_API_KEY), which management adds in Cloudflare. Until then Draft reply says it is not set up.
          </Notice>
        )}
      </div>
    </Modal>
  );
}
