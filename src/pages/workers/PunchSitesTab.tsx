import { useMemo, useState } from 'react';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StaleBanner } from '../../components/DataState';
import { DataTable, type Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { NumberInput } from '../../components/inputs';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, notifyFailure } from '../../lib/api';
import { mayWork } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import { parseLatLng, mapLink, RADIUS_MIN, RADIUS_MAX, type PunchSite } from '../../../functions/_lib/punchSites';

/* ------------------------------------------------------------------ *
 * HR > Employees > Hours > Punch Sites: where a phone punch counts as on
 * site besides the buildings (an office, a warehouse), each a map pin and
 * its own radius. Attendance names the site a punch was at, or how far it
 * was from the nearest one. Only a label: a punch is never refused.
 * ------------------------------------------------------------------ */

interface SitesPayload { data: PunchSite[]; buildingsWithLocation: number; buildingRadiusM: number }
interface Draft { name: string; pin: string; radiusM: number | null; active: boolean }

const pinText = (s: { lat: number; lng: number }): string => `${s.lat}, ${s.lng}`;

/** The browser's position for "Use where I am", or null when it is refused or off. */
function here(): Promise<{ lat: number; lng: number } | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise(resolve => navigator.geolocation.getCurrentPosition(
    p => resolve({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }), () => resolve(null),
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }));
}

export default function PunchSitesTab() {
  const { data, loading, error, reload } = useApi<SitesPayload>('/punch-sites');
  const toast = useToast();
  const [confirmDialog, ask] = useConfirm();
  const { user } = useSession();
  const mayEdit = mayWork(user, 'hr');
  const [form, setForm] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const sites = data?.data ?? [];
  const pin = form ? parseLatLng(form.draft.pin) : null;

  const body = (s: { name: string; lat: number; lng: number; radiusM: number; active: boolean }) =>
    ({ name: s.name, lat: s.lat, lng: s.lng, radiusM: s.radiusM, active: s.active });

  async function save() {
    if (!form || !pin) return;
    setBusy(true);
    setErrors({});
    try {
      const sent = body({ name: form.draft.name.trim(), ...pin, radiusM: form.draft.radiusM ?? 0, active: form.draft.active });
      if (form.id) await api.patch(`/punch-sites/${form.id}`, sent);
      else await api.post('/punch-sites', sent);
      toast({ tone: 'success', title: form.id ? 'Punch site saved.' : 'Punch site added.', body: `${sent.name}, ${sent.radiusM} m around the pin.` });
      setForm(null);
      reload();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setErrors(e.fields);
      notifyFailure(e);
    } finally { setBusy(false); }
  }

  async function toggle(s: PunchSite) {
    if (s.active && await ask({ title: `Switch off ${s.name}?`, body: 'Punches are no longer checked against it, old days included: they read against the other sites and the buildings. You can switch it back on at any time.', confirmLabel: 'Switch off', danger: true }) === null) return;
    try {
      await api.patch(`/punch-sites/${s.id}`, body({ ...s, active: !s.active }));
      toast({ tone: s.active ? 'warning' : 'success', title: s.active ? `${s.name} switched off.` : `${s.name} switched on.` });
      reload();
    } catch (e) { notifyFailure(e); }
  }

  async function useHere() {
    if (!form) return;
    setLocating(true);
    const p = await here();
    setLocating(false);
    if (p) setForm({ ...form, draft: { ...form.draft, pin: pinText(p) } });
    else toast({ tone: 'warning', title: 'No location from this device.', body: 'Allow location for this site in the browser, or paste the pin from a map.' });
  }

  const add = () => { setErrors({}); setForm({ id: null, draft: { name: '', pin: '', radiusM: data?.buildingRadiusM ?? 200, active: true } }); };
  const edit = (s: PunchSite) => { setErrors({}); setForm({ id: s.id, draft: { name: s.name, pin: pinText(s), radiusM: s.radiusM, active: s.active } }); };

  const actions = (s: PunchSite) => mayEdit ? (
    <span className="flex gap-[7px] items-center justify-end">
      <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => edit(s)}>Edit</Button>
      <Button size="sm" variant="tertiary" onClick={() => void toggle(s)}>{s.active ? 'Switch off' : 'Switch on'}</Button>
    </span>
  ) : null;

  const columns = useMemo<Column<PunchSite>[]>(() => [
    { key: 'name', label: 'Site', value: s => s.name, hideable: false, width: 220, render: s => <span className="font-semibold">{s.name}</span> },
    { key: 'pin', label: 'Map pin', value: s => pinText(s), width: 240,
      render: s => <a href={mapLink(s.lat, s.lng)} target="_blank" rel="noopener noreferrer" className="tabular-nums text-ink underline underline-offset-2">{pinText(s)}</a> },
    { key: 'radius', label: 'Radius (m)', type: 'number', value: s => s.radiusM, width: 110 },
    { key: 'active', label: 'Status', type: 'status', value: s => (s.active ? 'active' : 'inactive'),
      status: s => ({ label: s.active ? 'In use' : 'Switched off', tone: s.active ? 'success' : 'neutral' }), width: 130 },
    { key: 'go', label: '', noExport: true, sortable: false, filter: false, width: 200, align: 'right', render: actions },
  ], [mayEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const hint = data
    ? `Within a site's radius a punch reads "At <site>"; further out it shows the distance to the nearest site. Every building with a map location also counts, at ${data.buildingRadiusM} m (${data.buildingsWithLocation} now). Nothing is ever refused.`
    : '';

  return (
    <>
      {confirmDialog}
      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}
      <DataTable<PunchSite>
        id="punch-sites" columns={columns} rows={loading && !data ? null : sites} rowKey={s => s.id}
        pageSize={0} noun={['punch site', 'punch sites']} exportName="punch-sites"
        rowTone={s => (s.active ? null : 'muted')}
        header={
          <div className="pt-5 pb-3 px-5 flex items-center justify-between gap-3 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
            <span className="flex flex-col gap-0.5 max-w-[720px]">
              <span className="text-[16px] font-semibold tracking-[-0.01em]">Punch Sites <span className="text-meta font-normal text-muted-ink tabular-nums">{data ? sites.length : ''}</span></span>
              <span className="text-meta text-muted-ink">{hint}</span>
            </span>
            {mayEdit && <Button size="sm" variant="primary" icon={<Icon name="MapPin" size="sm" />} onClick={add}>Add punch site</Button>}
          </div>
        }
        empty={{ title: 'No punch sites yet.', body: hint || 'Add the office or a warehouse where staff clock in.', action: mayEdit ? { label: 'Add punch site', onClick: add } : undefined }}
        renderCard={s => (
          <span className="flex flex-col gap-[3px] min-w-0">
            <span className="flex items-center gap-[9px] flex-wrap">
              <span className="text-copy font-semibold">{s.name}</span>
              {!s.active && <StatusBadge tone="neutral" label="Switched off" size="sm" />}
            </span>
            <span className="text-meta text-muted-ink flex gap-x-3 flex-wrap tabular-nums">
              <a href={mapLink(s.lat, s.lng)} target="_blank" rel="noopener noreferrer" className="text-muted-ink underline underline-offset-2">{pinText(s)}</a>
              <span>{s.radiusM} m</span>
            </span>
            <span className="flex justify-start pt-1">{actions(s)}</span>
          </span>
        )}
      />

      {form && (
        <Modal title={form.id ? `Edit ${form.draft.name || 'punch site'}` : 'Add punch site'} onClose={() => !busy && setForm(null)}
          footer={<>
            <Button size="sm" variant="secondary" onClick={() => setForm(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} disabled={!form.draft.name.trim() || !pin || form.draft.radiusM == null}
              disabledReason="Enter a name, a map pin and a radius." onClick={() => void save()}>Save</Button>
          </>}>
          <div className="flex flex-col gap-4">
            <Field label="Name" value={form.draft.name} onChange={e => setForm({ ...form, draft: { ...form.draft, name: e.target.value } })}
              placeholder="Head office" disabled={busy} error={errors.name} />
            <div className="flex flex-col gap-2">
              <Field label="Map pin (latitude, longitude)" value={form.draft.pin} onChange={e => setForm({ ...form, draft: { ...form.draft, pin: e.target.value } })}
                placeholder="3.139003, 101.686855" disabled={busy}
                error={errors.lat ?? errors.lng ?? (form.draft.pin.trim() && !pin ? 'Paste the two numbers from a map, latitude first.' : undefined)}
                help="In Google Maps, right-click the spot and click the numbers to copy them." />
              <span className="flex gap-2 flex-wrap">
                <Button size="sm" variant="secondary" icon={<Icon name="LocateFixed" size="sm" />} loading={locating} disabled={busy} onClick={() => void useHere()}>Use where I am</Button>
                {pin && <a href={mapLink(pin.lat, pin.lng)} target="_blank" rel="noopener noreferrer" className="self-center text-copy text-ink underline underline-offset-2">Check on the map</a>}
              </span>
            </div>
            <NumberInput label="Radius" value={form.draft.radiusM} onChange={v => setForm({ ...form, draft: { ...form.draft, radiusM: v } })}
              min={RADIUS_MIN} max={RADIUS_MAX} suffix="m" disabled={busy} error={errors.radiusM}
              help={`From ${RADIUS_MIN} m to ${RADIUS_MAX} m. Phone GPS is often 20 to 50 m out, so leave a margin.`} />
          </div>
        </Modal>
      )}
    </>
  );
}
