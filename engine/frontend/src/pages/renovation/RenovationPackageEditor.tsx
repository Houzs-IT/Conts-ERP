/* One package or kit (owner, 20 Nov 2026): the header, the lines by area (drag to reorder, add product or kit through the
   SKU search, qty, the two optional SLA days, remove), and the tabs Used in (variation orders that took it) and History
   (the audit log). Changing a package never changes a sales order already made from it. No cost, no margin. */

import { useEffect, useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Copy, Plus, Power, Save } from 'lucide-react';
import { PageHeader } from '../../components/Layout';
import { Button } from '../../components/Button';
import { ModalOverlay } from '../../components/scm-v2/DocumentRelationshipMapModal';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../hooks/useToast';
import { refusalOf, useRenoMutation } from '../../lib/renovation/api';
import {
  createPackage, KIND_LONG, NO_AREA, nextPackageCode, savePackage, usePackage, type PackageKind, type PackageSection, type PackageStatus,
} from '../../lib/renovation/renovationPackagesApi';
import { Card, ErrorBanner, Field, fmtDate, inputCls, StatusPill } from './shared';
import { AddAreaBar, emptyArea, PackageAddSearch, PackageLinesTable, withoutBlankLines } from './RenovationPackageLines';
import { KindPill, PackageStatusPill } from './renovationPackageParts';
import { cn } from '../../lib/utils';
import { useFormDraft } from '../../lib/formDraft';
import { FormDraftBar } from '../../components/FormDraftBar';

type Tab = 'lines' | 'used' | 'history';

export function RenovationPackageEditor(): ReactElement {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const canEdit = can('scm.renovation.quote');
  const pq = usePackage(id);
  const [tab, setTab] = useState<Tab>('lines');
  const [kind, setKind] = useState<PackageKind>('PACKAGE');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [building, setBuilding] = useState('');
  const [unitType, setUnitType] = useState('');
  const [salesNote, setSalesNote] = useState('');
  const [sections, setSections] = useState<PackageSection[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  useEffect(() => {
    const p = pq.data;
    if (!p) return;
    setKind(p.kind); setCode(p.code); setName(p.name); setBuilding(p.building); setUnitType(p.unitType); setSalesNote(p.salesNote);
    setSections(p.sections); setDirty(false);
  }, [pq.data]);
  const run = useRenoMutation(async (fn: () => Promise<unknown>) => fn());
  /* Unsaved changes kept in this browser (lib/formDraft.ts) and offered back after a reload; a draft from before
     the package was saved again says so. */
  const draftValue = { kind, code, name, building, unitType, salesNote, sections };
  const draft = useFormDraft('package-edit', id, draftValue, {
    enabled: !!pq.data && canEdit,
    meaningful: dirty,
    version: pq.data?.updatedAt ? Date.parse(pq.data.updatedAt) || null : null,
  });
  const restoreDraft = (v: typeof draftValue) => {
    setKind(v.kind); setCode(v.code); setName(v.name); setBuilding(v.building); setUnitType(v.unitType); setSalesNote(v.salesNote);
    if (Array.isArray(v.sections)) setSections(v.sections);
    setDirty(true);
  };
  if (pq.isLoading || !pq.data) return <div className="p-8 text-center text-[13px] text-ink-muted">{pq.error ? refusalOf(pq.error).message : 'Loading package…'}</div>;
  const p = pq.data;
  const mark = () => setDirty(true);
  const head = { kind, code: code.trim(), name: name.trim(), building, unitType, salesNote };
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null);
    try { await run.mutateAsync(fn); if (ok) toast.success(ok); return true; } catch (e) { setError(refusalOf(e).message); return false; }
  };
  const save = () => act(() => savePackage(p.id, { ...head, sections: withoutBlankLines(sections).filter((s) => s.lines.length > 0 || s.heading.trim()) }), `${code} saved.`).then((ok) => { if (ok) { setDirty(false); draft.clear(); } });
  const setStatus = (status: PackageStatus) => {
    if (dirty) { setError('Save your changes first.'); return; }
    void act(() => savePackage(p.id, { status }), status === 'ACTIVE' ? `${p.code} is active.` : status === 'INACTIVE' ? `${p.code} is inactive: it no longer shows in the sales order search.` : undefined);
  };
  const duplicate = async () => {
    setError(null);
    try {
      const { code: next } = await nextPackageCode(kind);
      const r = await createPackage({ ...head, code: next, name: `${name.trim()} (copy)`, status: 'DRAFT', sections: withoutBlankLines(sections) });
      toast.success(`Copied to ${r.code} (draft).`);
      navigate(`/scm/renovation/packages/${r.id}`);
    } catch (e) { setError(refusalOf(e).message); }
  };
  const addArea = (heading: string) => { setSections([...sections, emptyArea(heading)]); mark(); };
  const target = adding === null ? 0 : Math.min(adding, Math.max(0, sections.length - 1));

  return (
    <div className="space-y-4 pb-20">
      <PageHeader back="/scm/renovation/packages" eyebrow="Packages" eyebrowMeta={<span className="font-mono">{p.code}</span>} title={name || p.code}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <KindPill kind={p.kind} /><PackageStatusPill status={p.status} />
            {canEdit && <Button variant="secondary" icon={<Copy size={14} />} onClick={() => void duplicate()}>Duplicate</Button>}
            {canEdit && p.status === 'ACTIVE' && <Button variant="secondary" icon={<Power size={14} />} onClick={() => setStatus('INACTIVE')}>Deactivate</Button>}
            {canEdit && p.status !== 'ACTIVE' && <Button variant="secondary" icon={<Power size={14} />} onClick={() => setStatus('ACTIVE')}>Activate</Button>}
            {canEdit && <Button icon={<Save size={14} />} disabled={!dirty || run.isPending} onClick={() => void save()}>{run.isPending ? 'Saving…' : 'Save'}</Button>}
          </div>
        )} />
      <ErrorBanner error={error} onClose={() => setError(null)} />
      <FormDraftBar draft={draft} onRestore={restoreDraft} staleText="This package changed after your draft; restoring will overwrite those changes." />
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Code"><input className={cn(inputCls, 'font-mono uppercase')} disabled={!canEdit} value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); mark(); }} /></Field>
          <Field label="Name" className="lg:col-span-3"><input className={inputCls} disabled={!canEdit} value={name} onChange={(e) => { setName(e.target.value); mark(); }} /></Field>
          <Field label="Type" className="lg:col-span-2"><select className={inputCls} disabled={!canEdit} value={kind} onChange={(e) => { setKind(e.target.value as PackageKind); mark(); }}>
            <option value="PACKAGE">{KIND_LONG.PACKAGE}</option><option value="KIT">{KIND_LONG.KIT}</option></select></Field>
          <Field label="Building (optional)"><input className={inputCls} disabled={!canEdit} value={building} onChange={(e) => { setBuilding(e.target.value); mark(); }} /></Field>
          <Field label="Unit type (optional)"><input className={inputCls} disabled={!canEdit} value={unitType} onChange={(e) => { setUnitType(e.target.value); mark(); }} /></Field>
          <Field label="Note for sales (optional)" className="lg:col-span-4"><input className={inputCls} disabled={!canEdit} value={salesNote} onChange={(e) => { setSalesNote(e.target.value); mark(); }} /></Field>
        </div>
      </Card>

      <div role="tablist" className="flex gap-1 w-fit max-w-full rounded-lg border border-border bg-surface px-1">
        {([['lines', 'Lines'], ['used', `Used in ${p.usedIn.length}`], ['history', 'History']] as Array<[Tab, string]>).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn('-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold', tab === k ? 'border-primary text-primary' : 'border-transparent text-ink-secondary hover:text-ink')}>{label}</button>
        ))}
      </div>

      {tab === 'lines' && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <PackageLinesTable sections={sections} disabled={!canEdit} showAreas={kind === 'PACKAGE' || sections.length > 1 || Boolean(sections[0]?.heading)}
            onChange={(s) => { setSections(s); mark(); }} />
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-3 py-2">
              {kind === 'PACKAGE' && <AddAreaBar existing={sections.map((s) => s.heading)} onAdd={addArea} />}
              <Button variant="secondary" className="h-8" icon={<Plus size={13} />} onClick={() => { if (sections.length === 0) setSections([emptyArea('')]); setAdding(0); }}>Add product or kit</Button>
            </div>
          )}
        </div>
      )}

      {tab === 'used' && (
        <Card dense>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[12.5px]">
              <thead className="bg-surface-2 text-[10.5px] uppercase tracking-wide text-ink-muted"><tr><th className="px-3 py-2">Variation order</th><th>Sales order</th><th>Project</th><th>Added on</th><th className="text-right">Lines kept</th><th className="px-3">Status</th></tr></thead>
              <tbody>
                {p.usedIn.map((u) => (
                  <tr key={u.voId} className="border-t border-border-subtle">
                    <td className="px-3 py-2"><Link className="font-semibold text-primary" to={`/scm/renovation/variation-orders/${u.voId}`}>{u.voNo}</Link></td>
                    <td><Link className="text-primary" to={`/scm/sales-orders/${encodeURIComponent(u.soDocNo)}`}>{u.soDocNo}</Link></td>
                    <td>{u.project ?? '—'}</td>
                    <td className="text-ink-secondary">{fmtDate(u.docDate)}</td>
                    <td className="text-right tabular-nums">{u.lines}</td>
                    <td className="px-3"><StatusPill status={u.status} /></td>
                  </tr>
                ))}
                {p.usedIn.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-muted">No sales order has taken this {kind === 'KIT' ? 'kit' : 'package'} yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'history' && (
        <Card dense>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[12.5px]">
              <thead className="bg-surface-2 text-[10.5px] uppercase tracking-wide text-ink-muted"><tr><th className="px-3 py-2">When</th><th>Who</th><th className="px-3">What changed</th></tr></thead>
              <tbody>
                {p.history.map((h, i) => (
                  <tr key={i} className="border-t border-border-subtle align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">{new Date(h.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="py-2">{h.who ?? '—'}</td>
                    <td className="px-3 py-2">{h.note ?? (h.action === 'CREATE' ? 'Created' : 'Saved')}</td>
                  </tr>
                ))}
                {p.history.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-ink-muted">No history yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ModalOverlay open={adding !== null} onClose={() => setAdding(null)} title="Add product or kit" icon={<Plus size={16} />}
        footer={<div className="flex w-full justify-end"><Button variant="secondary" onClick={() => setAdding(null)}>Done</Button></div>}>
        <div className="space-y-2">
          {sections.length > 1 && (
            <Field label="Adding to area"><select className={inputCls} value={target} onChange={(e) => setAdding(Number(e.target.value))}>
              {sections.map((s, i) => <option key={i} value={i}>{s.heading || NO_AREA}</option>)}</select></Field>
          )}
          {adding !== null && <PackageAddSearch autoFocus onAdd={(ls, label) => {
            const base = sections.length ? sections : [emptyArea('')];
            // Functional update: several batches can be added while the picker stays open.
            setSections((cur) => (cur.length ? cur : base).map((s, i) => (i === target ? { ...s, lines: [...s.lines, ...ls] } : s)));
            mark();
            toast.success(`Added ${label} to ${base[target]?.heading || NO_AREA}`);
          }} />}
        </div>
      </ModalOverlay>
    </div>
  );
}
