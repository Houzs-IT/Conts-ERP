import { useMemo, useState } from 'react';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StaleBanner } from '../../components/DataState';
import { DataTable, type Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { NumberInput } from '../../components/inputs';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, notifyFailure } from '../../lib/api';
import { mayWork } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import { mapLink, RADIUS_MIN, RADIUS_MAX, type PunchSite } from '../../../functions/_lib/punchSites';

/* ------------------------------------------------------------------ *
 * HR > Employees > Hours > Punch Sites: the buildings a phone punch is
 * checked against, each with its own radius (owner, 27 Oct 2026). Within
 * it a punch reads "At <building>" on Attendance; further out it shows
 * the distance. Only a label: a punch is never refused. A building with
 * no map location cannot read as on site.
 * ------------------------------------------------------------------ */

interface SitesPayload { data: PunchSite[]; defaultRadiusM: number }

const pinText = (s: { lat: number; lng: number }): string => `${s.lat}, ${s.lng}`;
const located = (s: PunchSite): s is PunchSite & { lat: number; lng: number } => s.lat !== null && s.lng !== null;

export default function PunchSitesTab() {
  const { data, loading, error, reload } = useApi<SitesPayload>('/punch-sites');
  const toast = useToast();
  const { user } = useSession();
  const mayEdit = mayWork(user, 'hr');
  const [editing, setEditing] = useState<{ site: PunchSite; radiusM: number | null } | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const sites = data?.data ?? [];
  const fallback = data?.defaultRadiusM ?? 200;
  const withLocation = sites.filter(located).length;

  async function save(radiusM: number | null) {
    if (!editing) return;
    setBusy(true);
    setFieldError(undefined);
    try {
      await api.patch(`/punch-sites/${editing.site.id}`, { radiusM });
      toast({ tone: 'success', title: 'Punch radius saved.', body: `${editing.site.name}: ${radiusM ?? fallback} m${radiusM === null ? ' (default)' : ''}.` });
      setEditing(null);
      reload();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFieldError(e.fields.radiusM);
      notifyFailure(e);
    } finally { setBusy(false); }
  }

  const edit = (s: PunchSite) => { setFieldError(undefined); setEditing({ site: s, radiusM: s.radiusM ?? fallback }); };
  const radiusText = (s: PunchSite) => (s.radiusM === null ? `${fallback} m (default)` : `${s.radiusM} m`);

  const columns = useMemo<Column<PunchSite>[]>(() => [
    { key: 'name', label: 'Building', value: s => s.name, hideable: false, width: 240, render: s => <span className="font-semibold">{s.name}</span> },
    { key: 'pin', label: 'Map location', value: s => (located(s) ? pinText(s) : null), width: 240,
      render: s => located(s)
        ? <a href={mapLink(s.lat, s.lng)} target="_blank" rel="noopener noreferrer" className="tabular-nums text-ink underline underline-offset-2">{pinText(s)}</a>
        : <StatusBadge tone="warning" label="No map location" size="sm" /> },
    { key: 'radius', label: 'Punch radius', type: 'number', value: s => s.radiusM ?? fallback, width: 150, render: s => <span className="tabular-nums">{radiusText(s)}</span> },
    { key: 'go', label: '', noExport: true, sortable: false, filter: false, width: 120, align: 'right',
      render: s => mayEdit ? <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => edit(s)}>Radius</Button> : null },
  ], [mayEdit, fallback]); // eslint-disable-line react-hooks/exhaustive-deps

  const hint = `Within a building's radius a phone punch reads "At <building>"; further out Attendance shows the distance to the nearest building. Buildings without their own radius use ${fallback} m. Nothing is ever refused.`;

  return (
    <>
      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}
      <DataTable<PunchSite>
        id="punch-sites" columns={columns} rows={loading && !data ? null : sites} rowKey={s => s.id}
        pageSize={0} noun={['building', 'buildings']} exportName="punch-sites"
        rowTone={s => (located(s) ? null : 'muted')}
        header={
          <div className="pt-5 pb-3 px-5 flex flex-col gap-0.5 [border-bottom:1px_solid_var(--color-line-soft)]">
            <span className="text-[16px] font-semibold tracking-[-0.01em]">Punch Sites <span className="text-meta font-normal text-muted-ink tabular-nums">{data ? `${withLocation} of ${sites.length} on the map` : ''}</span></span>
            <span className="text-meta text-muted-ink max-w-[760px]">{hint}{data && withLocation < sites.length ? ' A building with no map location cannot read as on site; its location comes with the building from HostPlatform.' : ''}</span>
          </div>
        }
        empty={{ title: 'No buildings yet.', body: hint }}
        renderCard={s => (
          <span className="flex flex-col gap-[3px] min-w-0">
            <span className="flex items-center gap-[9px] flex-wrap">
              <span className="text-copy font-semibold">{s.name}</span>
              {!located(s) && <StatusBadge tone="warning" label="No map location" size="sm" />}
            </span>
            <span className="text-meta text-muted-ink flex gap-x-3 flex-wrap tabular-nums">
              {located(s) && <a href={mapLink(s.lat, s.lng)} target="_blank" rel="noopener noreferrer" className="text-muted-ink underline underline-offset-2">{pinText(s)}</a>}
              <span>{radiusText(s)}</span>
            </span>
            {mayEdit && <span className="flex justify-start pt-1"><Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => edit(s)}>Radius</Button></span>}
          </span>
        )}
      />

      {editing && (
        <Modal title={`Punch radius: ${editing.site.name}`} onClose={() => !busy && setEditing(null)}
          footer={<>
            {editing.site.radiusM !== null && (
              <Button size="sm" variant="tertiary" style={{ marginRight: 'auto' }} disabled={busy} onClick={() => void save(null)}>Use the default ({fallback} m)</Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} disabled={editing.radiusM == null} disabledReason="Enter a radius." onClick={() => void save(editing.radiusM)}>Save</Button>
          </>}>
          <div className="flex flex-col gap-4">
            {!located(editing.site) && <p className="m-0 text-copy text-muted-ink">This building has no map location yet, so no punch can read as at it until it has one.</p>}
            <NumberInput label="Radius" value={editing.radiusM} onChange={v => setEditing({ ...editing, radiusM: v })}
              min={RADIUS_MIN} max={RADIUS_MAX} suffix="m" disabled={busy} error={fieldError}
              help={`From ${RADIUS_MIN} m to ${RADIUS_MAX} m. Phone GPS is often 20 to 50 m out, so leave a margin. The change also shows on past days.`} />
          </div>
        </Modal>
      )}
    </>
  );
}
