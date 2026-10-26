import { useRef, useState } from 'react';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { StaleBanner } from '../components/DataState';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { date, time } from '../lib/format';
import type { PunchView } from '../../functions/_lib/attendance';

/* ------------------------------------------------------------------ *
 * Portal > Clock: clock in and out with a selfie and the phone's GPS
 * (HR phase 2, ported from Hookka's worker home). Both are kept when the
 * phone gives them and never stop a punch; the office sees what is missing.
 * ------------------------------------------------------------------ */

interface ClockPayload {
  name: string; employeeId: string | null; today: PunchView | null; month: string; days: PunchView[];
  totals: { days: number; minutes: number; forgotten: number };
}

const hm = (min: number): string => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;

/** The phone's position, or null when it is refused, off or slow. Never throws: location is optional. */
function position(): Promise<GeolocationPosition | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise(resolve => navigator.geolocation.getCurrentPosition(resolve, () => resolve(null),
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }));
}

/** A phone photo shrunk to 1024px JPEG before upload: a selfie only has to show who it is, and site Wi-Fi is slow.
 *  Falls back to the original when the browser cannot decode it. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.75));
    return blob ?? file;
  } catch {
    return file; // the original still uploads; the server checks it is a photo
  }
}

export default function FieldClockPage() {
  const { data, loading, error, reload } = useApi<ClockPayload>('/field/clock');
  const toast = useToast();
  const camera = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const today = data?.today ?? null;
  const action: 'in' | 'out' | null = !today ? 'in' : today.clockOutAt ? null : 'out';

  async function punch(photo: File | null) {
    if (!action) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set('action', action);
      const [pos, img] = await Promise.all([position(), photo ? shrink(photo) : Promise.resolve(null)]);
      if (img) form.set('photo', img, 'selfie.jpg');
      if (pos) {
        form.set('lat', String(pos.coords.latitude));
        form.set('lng', String(pos.coords.longitude));
        form.set('accuracy', String(pos.coords.accuracy));
      }
      const res = await api.post<{ data: PunchView; photoKept: boolean; closedForgotten: number }>('/field/clock', form);
      const at = time(action === 'in' ? res.data.clockInAt : res.data.clockOutAt ?? res.data.clockInAt);
      toast({ tone: 'success', title: action === 'in' ? `Clocked in at ${at}.` : `Clocked out at ${at}.`,
        body: action === 'out' ? `${hm(res.data.minutes)} today.` : res.closedForgotten ? 'You did not clock out last time. The office will check that day.' : 'Have a good day.' });
      if (!res.photoKept) toast({ tone: 'warning', title: 'Your photo was not saved.', body: 'The punch counts. Tell the office if this keeps happening.' });
      if (!pos) toast({ tone: 'warning', title: 'No location with this punch.', body: 'Turn on location for this site so the office can see where you clocked.' });
      reload();
    } catch (e) { notifyFailure(e); }
    finally {
      setBusy(false);
      if (camera.current) camera.current.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="m-0 text-title font-semibold">Clock</h1>
        <div className="text-copy text-muted-ink">{date(new Date().toISOString())}{data?.employeeId ? ` · ${data.employeeId}` : ''}</div>
      </div>

      {error && <StaleBanner message={error} onRetry={reload} />}

      <section className="bg-card rounded-card border border-solid border-line px-4 py-4 flex flex-col gap-3">
        {loading && !data ? <span className="text-copy text-muted-ink">Loading…</span> : (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-meta text-muted-ink">Today</span>
              <span className="text-[22px] leading-tight font-bold tracking-[-0.01em] tabular-nums">
                {!today ? 'Not clocked in' : today.clockOutAt ? `${time(today.clockInAt)} – ${time(today.clockOutAt)}` : `In since ${time(today.clockInAt)}`}
              </span>
              {today && <span className="text-copy text-muted-ink tabular-nums">{hm(today.minutes)}{today.clockOutAt ? ' worked' : ' so far'}</span>}
            </div>
            {action ? (
              <>
                <Button size="touch" variant="primary" className="w-full" loading={busy} icon={<Icon name="Camera" size="sm" />}
                  onClick={() => camera.current?.click()}>
                  {action === 'in' ? 'Clock in with a selfie' : 'Clock out with a selfie'}
                </Button>
                <input ref={camera} type="file" accept="image/*" capture="user" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void punch(f); }} />
                <button type="button" disabled={busy} onClick={() => void punch(null)}
                  className="min-h-11 self-center text-copy text-muted-ink underline underline-offset-2 bg-transparent border-0 cursor-pointer [font-family:inherit]">
                  Camera not working? {action === 'in' ? 'Clock in' : 'Clock out'} without a photo
                </button>
              </>
            ) : (
              <span className="text-copy text-muted-ink">Done for today. Ask the office if a time is wrong.</span>
            )}
          </>
        )}
      </section>

      {data && (
        <section className="flex flex-col gap-2">
          <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em] flex items-baseline gap-2">
            This month
            <span className="text-meta text-muted-ink font-normal tabular-nums">{data.totals.days} {data.totals.days === 1 ? 'day' : 'days'} · {hm(data.totals.minutes)}</span>
          </h2>
          {data.days.length === 0 && <span className="text-copy text-muted-ink">No days yet this month.</span>}
          {data.days.map(d => (
            <div key={d.id} className="bg-card rounded-card border border-solid border-line px-4 py-3 flex items-center justify-between gap-3">
              <span className="flex flex-col min-w-0">
                <span className="text-copy font-semibold">{date(`${d.date}T12:00:00+08:00`)}</span>
                <span className="text-meta text-muted-ink tabular-nums">{time(d.clockInAt)} – {d.clockOutAt ? time(d.clockOutAt) : '…'}</span>
              </span>
              {d.forgotOut
                ? <StatusBadge tone="warning" label="No clock-out" size="sm" />
                : <span className="text-copy tabular-nums">{hm(d.minutes)}</span>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
