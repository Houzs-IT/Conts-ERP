import { useRef, useState } from 'react';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { StaleBanner } from '../components/DataState';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { time, todayMyt } from '../lib/format';
import { usePortalText, usePortalDates } from '../lib/portalI18n';
import type { PunchView } from '../../functions/_lib/attendance';

/* ------------------------------------------------------------------ *
 * Portal > Clock: clock in and out with a selfie and the phone's GPS
 * (HR phase 2, ported from Hookka's worker home). The selfie is required (owner, 27 Oct 2026);
 * the location is kept when the phone gives it and never stops a punch.
 * ------------------------------------------------------------------ */

interface ClockPayload {
  name: string; employeeId: string | null; today: PunchView | null; month: string; days: PunchView[];
  totals: { days: number; minutes: number; forgotten: number };
}

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
  const t = usePortalText();
  const { day } = usePortalDates();
  const hm = t.common.hm;

  const today = data?.today ?? null;
  const action: 'in' | 'out' | null = !today ? 'in' : today.clockOutAt ? null : 'out';

  async function punch(photo: File) {
    if (!action) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set('action', action);
      const [pos, img] = await Promise.all([position(), shrink(photo)]);
      form.set('photo', img, 'selfie.jpg');
      if (pos) {
        form.set('lat', String(pos.coords.latitude));
        form.set('lng', String(pos.coords.longitude));
        form.set('accuracy', String(pos.coords.accuracy));
      }
      const res = await api.post<{ data: PunchView; photoKept: boolean; closedForgotten: number }>('/field/clock', form);
      const at = time(action === 'in' ? res.data.clockInAt : res.data.clockOutAt ?? res.data.clockInAt);
      toast({ tone: 'success', title: action === 'in' ? t.clock.clockedIn(at) : t.clock.clockedOut(at),
        body: action === 'out' ? t.clock.workedToday(hm(res.data.minutes)) : res.closedForgotten ? t.clock.forgotLast : t.clock.goodDay });
      if (!res.photoKept) toast({ tone: 'warning', title: t.clock.photoNotSaved, body: t.clock.photoNotSavedBody });
      if (!pos) toast({ tone: 'warning', title: t.clock.noLocation, body: t.clock.noLocationBody });
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
        <h1 className="m-0 text-title font-semibold">{t.clock.title}</h1>
        <div className="text-copy text-muted-ink">{day(todayMyt())}{data?.employeeId ? ` · ${data.employeeId}` : ''}</div>
      </div>

      {error && <StaleBanner message={error} onRetry={reload} />}

      <section className="bg-card rounded-card border border-solid border-line px-4 py-4 flex flex-col gap-3">
        {loading && !data ? <span className="text-copy text-muted-ink">{t.common.loading}</span> : (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-meta text-muted-ink">{t.clock.today}</span>
              <span className="text-[22px] leading-tight font-bold tracking-[-0.01em] tabular-nums">
                {!today ? t.clock.notIn : today.clockOutAt ? `${time(today.clockInAt)} – ${time(today.clockOutAt)}` : t.clock.inSince(time(today.clockInAt))}
              </span>
              {today && <span className="text-copy text-muted-ink tabular-nums">{today.clockOutAt ? t.clock.worked(hm(today.minutes)) : t.clock.soFar(hm(today.minutes))}</span>}
            </div>
            {action ? (
              <>
                <Button size="touch" variant="primary" className="w-full" loading={busy} icon={<Icon name="Camera" size="sm" />}
                  onClick={() => camera.current?.click()}>
                  {action === 'in' ? t.clock.inWithSelfie : t.clock.outWithSelfie}
                </Button>
                <input ref={camera} type="file" accept="image/*" capture="user" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void punch(f); }} />
              </>
            ) : (
              <span className="text-copy text-muted-ink">{t.clock.done}</span>
            )}
          </>
        )}
      </section>

      {data && (
        <section className="flex flex-col gap-2">
          <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em] flex items-baseline gap-2">
            {t.clock.thisMonth}
            <span className="text-meta text-muted-ink font-normal tabular-nums">{t.common.days(data.totals.days)} · {hm(data.totals.minutes)}</span>
          </h2>
          {data.days.length === 0 && <span className="text-copy text-muted-ink">{t.clock.noDays}</span>}
          {data.days.map(d => (
            <div key={d.id} className="bg-card rounded-card border border-solid border-line px-4 py-3 flex items-center justify-between gap-3">
              <span className="flex flex-col min-w-0">
                <span className="text-copy font-semibold">{day(d.date)}</span>
                <span className="text-meta text-muted-ink tabular-nums">{time(d.clockInAt)} – {d.clockOutAt ? time(d.clockOutAt) : '…'}</span>
              </span>
              {d.forgotOut
                ? <StatusBadge tone="warning" label={t.clock.noClockOut} size="sm" />
                : <span className="text-copy tabular-nums">{hm(d.minutes)}</span>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
