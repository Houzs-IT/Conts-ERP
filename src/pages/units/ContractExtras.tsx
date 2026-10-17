import { useState } from 'react';
import { Button } from '../../components/Button';
import { DateField } from '../../components/inputs';
import { FileRow, FileDropRow } from '../../components/Attachments';
import Icon from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { date } from '../../lib/format';
import { CentreModal } from './shared';

/** Staff sheet UNIT (17 Oct 2026): extending a contract needs the new signed agreement or memo; the agreement itself
 *  is generated from the company's template (Settings > Agreement template). */

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const addYear = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return addDays(`${y + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, -1); };

/** Extend or renew the unit's contract for a new period on the same terms. The file is required: it is uploaded to
 *  the unit first, then the new period is saved with it (POST /units/:id/contract-extend). */
export function ExtendContractModal({ unitId, unitLabel, current, onClose, onSaved }: {
  unitId: string; unitLabel: string; current: { code: string; termsLabel: string; startsOn: string | null; endsOn: string | null };
  onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const firstDay = current.endsOn ? addDays(current.endsOn.slice(0, 10), 1) : '';
  const [startsOn, setStartsOn] = useState(firstDay);
  const [endsOn, setEndsOn] = useState(firstDay ? addYear(firstDay) : '');
  const [renewsOn, setRenewsOn] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const local: Record<string, string> = {};
  if (!file) local.documentId = 'Attach the signed agreement or memo for the new period.';
  if (!startsOn) local.startsOn = 'Enter the start of the new period.';
  else if (current.startsOn && startsOn <= current.startsOn.slice(0, 10)) local.startsOn = `Start after ${date(current.startsOn)}.`;
  if (endsOn && startsOn && endsOn < startsOn) local.endsOn = 'The end is before the start.';

  async function save() {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('unitId', unitId); fd.append('kind', 'contract');
      const doc = await api.post<{ id: string }>('/documents', fd);
      await api.post(`/units/${encodeURIComponent(unitId)}/contract-extend`, { documentId: doc.id, startsOn, endsOn: endsOn || null, renewsOn: renewsOn || null });
      toast({ tone: 'success', title: 'Contract extended.', body: `${unitLabel}: ${current.code} from ${date(startsOn)}${endsOn ? ` to ${date(endsOn)}` : ''}. The previous period is kept in the history.` });
      onSaved();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFields(e.fields);
      toast({ tone: 'critical', title: 'Contract was not extended.', body: errorMessage(e) });
    } finally { setBusy(false); }
  }
  return (
    <CentreModal title="Extend or renew the contract" sub={`${unitLabel} · ${current.code} · ${current.termsLabel}. Same terms for a new period; for different terms start a new contract instead.`} onClose={onClose}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" loading={busy} disabled={Object.keys(local).length > 0} disabledReason={Object.values(local)[0]} onClick={() => void save()}>Extend contract</Button></>}>
      <div className="flex flex-col gap-[7px]">
        <span className="text-meta font-medium text-muted-ink">New agreement or memo (required)</span>
        {file
          ? <FileRow file={{ id: 'agreement', name: file.name, size: file.size, onRemove: () => setFile(null), removeLabel: 'Remove file' }} />
          : <FileDropRow label="Attach the signed agreement or memo" hint="PDF, JPG or PNG, up to 8 MB" accept=".pdf,.jpg,.jpeg,.png" onPick={fl => { setFile(fl.item(0)); setFields({}); }} />}
        {(fields.documentId) && <span className="text-meta text-critical">{fields.documentId}</span>}
      </div>
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
        <DateField label="New period starts" value={startsOn} onChange={v => { setStartsOn(v); setFields({}); }} error={fields.startsOn ?? (startsOn ? local.startsOn : undefined)}
          help={current.endsOn ? `The current period ends ${date(current.endsOn)}.` : 'The current contract ends the day before.'} />
        <DateField label="New period ends" value={endsOn} min={startsOn || undefined} onChange={setEndsOn} error={fields.endsOn ?? local.endsOn} />
      </div>
      <DateField label="Renews on" value={renewsOn} min={startsOn || undefined} onChange={setRenewsOn} error={fields.renewsOn} help="Optional." />
    </CentreModal>
  );
}

interface Check { ready: boolean; missing: { key: string; label: string; where: string }[]; template: { version: number; title: string } }

/** "Generate agreement": opens the print-ready agreement once everything it needs is on file; until then, says what
 *  is missing and where it is filled in. */
export function GenerateAgreement({ unitId, refreshKey }: { unitId: string; refreshKey?: unknown }) {
  const { data } = useApi<Check>(`/units/${encodeURIComponent(unitId)}/agreement?check=1${refreshKey ? `&v=${encodeURIComponent(String(refreshKey))}` : ''}`);
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const missing = data.missing;
  return (
    <span className="relative inline-flex flex-col items-start gap-1">
      <Button size="sm" variant="secondary" icon={<Icon name="FileText" size="sm" />}
        onClick={() => (missing.length ? setOpen(o => !o) : window.open(`/api/units/${encodeURIComponent(unitId)}/agreement`, '_blank', 'noopener'))}>
        Generate agreement
      </Button>
      {open && missing.length > 0 && (
        <div role="note" className="absolute left-0 top-[calc(100%+6px)] z-10 w-[min(340px,80vw)] p-3 rounded-card bg-card border border-solid border-line shadow-[var(--shadow-overlay)] text-meta flex flex-col gap-1.5">
          <span className="font-semibold text-ink">Fill these in first</span>
          {missing.map(m => <span key={m.key} className="text-muted-ink">{m.label}{m.where ? <> · on {m.where}</> : null}</span>)}
          <span className="text-muted-ink">Template: {data.template.title}, version {data.template.version} (Settings &gt; Agreement template).</span>
        </div>
      )}
    </span>
  );
}
