import { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Drawer } from '../components/Dialog';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { TONE, cx } from '../lib/design-tokens';

/** Delivery Zones — ported from 2990's SCM zone-classify, drawn in Conts. The postcode-prefix
 *  -> area-zone map. Prefixes are the FIRST TWO digits of a Malaysian postcode (00–99). */

interface Zone { id: string; zone: string; prefixStart: number; prefixEnd: number; label: string; isActive: boolean }
interface Rule { zone: string; prefixStart: number; prefixEnd: number }
interface Payload { data: Zone[]; usingDefault: boolean; defaultMap: Rule[]; knownZones: string[]; generatedAt: string }

const KNOWN = ['KL', 'PJ', 'KLANG', 'KAJANG', 'RAWANG', 'PUCHONG', 'NS', 'MELAKA', 'JOHOR', 'PENANG', 'KEDAH', 'PERAK', 'PAHANG', 'EAST'];
const DEFAULT_MAP: Rule[] = [
  { zone: 'KEDAH', prefixStart: 5, prefixEnd: 9 }, { zone: 'PENANG', prefixStart: 10, prefixEnd: 14 }, { zone: 'PERAK', prefixStart: 30, prefixEnd: 36 },
  { zone: 'EAST', prefixStart: 15, prefixEnd: 24 }, { zone: 'PAHANG', prefixStart: 25, prefixEnd: 28 }, { zone: 'PJ', prefixStart: 40, prefixEnd: 40 },
  { zone: 'KLANG', prefixStart: 41, prefixEnd: 42 }, { zone: 'KAJANG', prefixStart: 43, prefixEnd: 43 }, { zone: 'PJ', prefixStart: 46, prefixEnd: 47 },
  { zone: 'RAWANG', prefixStart: 48, prefixEnd: 48 }, { zone: 'KL', prefixStart: 50, prefixEnd: 60 }, { zone: 'NS', prefixStart: 70, prefixEnd: 73 },
  { zone: 'MELAKA', prefixStart: 75, prefixEnd: 78 }, { zone: 'JOHOR', prefixStart: 79, prefixEnd: 86 },
];
const FALLBACK: Payload = { generatedAt: '', usingDefault: true, defaultMap: DEFAULT_MAP, knownZones: KNOWN, data: [] };

const pad = (n: number) => String(n).padStart(2, '0');
const emptyZone = (): Zone => ({ id: '', zone: 'KL', prefixStart: 50, prefixEnd: 60, label: '', isActive: true });

export default function DeliveryZonesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/delivery-zones', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [drawer, setDrawer] = useState<{ draft: Zone; isNew: boolean } | null>(null);
  const [added, setAdded] = useState<Zone[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Zone>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [seeded, setSeeded] = useState(false);

  const knownZones = data?.knownZones?.length ? data.knownZones : KNOWN;
  const rows = useMemo(() => [...added, ...(data?.data ?? [])].filter(z => !removed.has(z.id)).map(z => ({ ...z, ...edits[z.id] })), [added, data, edits, removed]);
  const usingDefault = (data?.usingDefault ?? true) && added.length === 0 && !seeded;

  function save(draft: Zone, isNew: boolean) {
    if (isNew) { setAdded(a => [{ ...draft, id: `dz-new-${crypto.randomUUID().slice(0, 8)}` }, ...a]); api.post('/delivery-zones', draft).catch(notifyFailure); toast({ tone: 'success', title: 'Zone rule added.', body: `${draft.zone} ${pad(draft.prefixStart)}–${pad(draft.prefixEnd)}` }); }
    else { setEdits(e => ({ ...e, [draft.id]: { ...e[draft.id], ...draft } })); api.patch(`/delivery-zones/${draft.id}`, draft).catch(notifyFailure); toast({ tone: 'success', title: 'Zone rule updated.', body: draft.zone }); }
    setDrawer(null);
  }
  function remove(z: Zone) { setRemoved(r => new Set(r).add(z.id)); api.del(`/delivery-zones/${z.id}`).catch(notifyFailure); toast({ tone: 'success', title: 'Zone rule removed.', body: z.zone }); setDrawer(null); }
  function loadDefault() {
    setSeeded(true);
    setAdded((data?.defaultMap ?? DEFAULT_MAP).map((r, i) => ({ id: `dz-def-${i}`, zone: r.zone, prefixStart: r.prefixStart, prefixEnd: r.prefixEnd, label: '', isActive: true })));
    api.post('/delivery-zones', { loadDefault: true }).catch(notifyFailure);
    toast({ tone: 'success', title: 'Default map loaded.', body: `${(data?.defaultMap ?? DEFAULT_MAP).length} rules` });
  }

  return (
    <>
      <PageHeader title="Delivery zones" sub={`${rows.length} postcode-prefix rules`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ draft: emptyZone(), isNew: true })}>New rule</Button> : undefined} />
      {error && <StaleBanner message={`Showing the last zone map we have. ${error}`} onRetry={reload} />}
      {usingDefault && (
        <div className="flex items-center justify-between gap-4 flex-wrap p-4 rounded-card bg-[var(--color-gold-50)] [border:1px_solid_var(--color-line,#DEDAD3)]">
          <div className="text-[13px] text-gold-ink">No custom map yet — postcodes classify by the built-in default. Load it to customise.</div>
          {canWrite && <Button size="sm" variant="secondary" onClick={loadDefault}>Load default map</Button>}
        </div>
      )}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[560px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
              {['Zone', 'Postcode prefixes', 'Label', 'Status'].map((h) => <th key={h} className="py-[11px] px-4 text-left text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && rows.length === 0 ? <tr><td colSpan={4}><TableSkeleton rows={6} cols={4} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={4}><div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center"><span className="text-[14px] font-semibold">No custom rules.</span><span className="text-[12.5px] text-muted-ink max-w-[380px]">Add postcode-prefix rules, or load the default map to start from.</span></div></td></tr>
              : rows.map(z => (
                <tr key={z.id} onClick={() => { if (canWrite) setDrawer({ draft: z, isNew: false }); }} className={cx('[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]', canWrite ? 'cursor-pointer hover:bg-muted' : '')}>
                  <td className="py-[13px] px-4"><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{z.zone}</span></td>
                  <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] tabular-nums">{pad(z.prefixStart)}xxx – {pad(z.prefixEnd)}xxx</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-muted-ink">{z.label || '—'}</td>
                  <td className="py-[13px] px-4"><StatusPill active={z.isActive} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {drawer && <ZoneDrawer draft={drawer.draft} isNew={drawer.isNew} knownZones={knownZones} onClose={() => setDrawer(null)} onSave={save} onDelete={drawer.isNew ? undefined : () => remove(drawer.draft)} />}
    </>
  );
}

function StatusPill({ active }: { active: boolean }) {
  const t = active ? TONE.success : TONE.neutral;
  return <span className={cx('inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-0.5 rounded-full', t.bg, t.text)}><span className="w-1.5 h-1.5 rounded-full bg-current" />{active ? 'Active' : 'Inactive'}</span>;
}

function ZoneDrawer({ draft, isNew, knownZones, onClose, onSave, onDelete }: { draft: Zone; isNew: boolean; knownZones: string[]; onClose: () => void; onSave: (d: Zone, isNew: boolean) => void; onDelete?: () => void }) {
  const [f, setF] = useState<Zone>(draft);
  const num = (v: string) => Math.max(0, Math.min(99, Math.round(Number(v) || 0)));
  const canSave = f.zone.trim() !== '' && f.prefixEnd >= f.prefixStart;
  return (
    <Drawer open onClose={onClose} width={520}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">{isNew ? 'New zone rule' : 'Edit zone rule'}</h2><button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-4">
        <div className="flex flex-col gap-[7px]">
          <label className="text-[12px] font-medium text-muted-ink">Zone</label>
          <select value={f.zone} onChange={e => setF(s => ({ ...s, zone: e.target.value }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            {knownZones.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Prefix from (00–99)" type="number" numeric min={0} max={99} value={String(f.prefixStart)} onChange={e => setF(s => ({ ...s, prefixStart: num(e.target.value) }))} />
          <Field label="Prefix to (00–99)" type="number" numeric min={0} max={99} value={String(f.prefixEnd)} onChange={e => setF(s => ({ ...s, prefixEnd: num(e.target.value) }))} />
        </div>
        <Field label="Label" placeholder="Optional, e.g. Klang Valley" value={f.label} onChange={e => setF(s => ({ ...s, label: e.target.value }))} />
        <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Status</label>
          <select value={f.isActive ? '1' : '0'} onChange={e => setF(s => ({ ...s, isActive: e.target.value === '1' }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            <option value="1">Active</option><option value="0">Inactive</option>
          </select>
        </div>
        <div className="text-[12.5px] text-muted-ink">Covers postcodes <span className="[font-family:var(--font-mono,ui-monospace,monospace)]">{String(f.prefixStart).padStart(2, '0')}xxx</span> to <span className="[font-family:var(--font-mono,ui-monospace,monospace)]">{String(f.prefixEnd).padStart(2, '0')}xxx</span>.</div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <div>{onDelete && <Button size="sm" variant="danger" icon={<Trash2 size={15} strokeWidth={1.75} />} onClick={onDelete}>Delete</Button>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Pick a zone and a valid prefix range" onClick={() => onSave(f, isNew)}>{isNew ? 'Add rule' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
