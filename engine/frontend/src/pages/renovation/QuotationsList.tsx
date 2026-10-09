// Renovation quotations: every quotation (newest first) with its current
// revision, customer, building / unit, total and status; filter by status or
// search; "New quotation" picks the project (and optionally a package template).

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, Plus } from 'lucide-react';
import { PageHeader } from '../../components/Layout';
import { Button } from '../../components/Button';
import { ModalOverlay } from '../../components/scm-v2/DocumentRelationshipMapModal';
import { useAuth } from '../../auth/AuthContext';
import { refusalOf, renoSend, searchProjects, useBrands, useQuotations, useTemplates } from '../../lib/renovation/api';
import { ErrorBanner, Field, fmtDate, inputCls, rm, StatusPill } from './shared';
import { cn } from '../../lib/utils';

const FILTERS = [
  { value: '', label: 'All' }, { value: 'DRAFT', label: 'Draft' }, { value: 'SENT', label: 'Sent' },
  { value: 'ACCEPTED', label: 'Accepted' }, { value: 'REJECTED', label: 'Rejected' }, { value: 'EXPIRED', label: 'Expired' },
];

function NewQuotationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const brands = useBrands();
  const templates = useTemplates();
  const [q, setQ] = useState('');
  const [projects, setProjects] = useState<Array<{ id: number; code: string | null; name: string; contractDocNo: string | null }>>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [brandId, setBrandId] = useState<number | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(() => { searchProjects(q).then((r) => { if (live) setProjects(r.projects); }).catch(() => { if (live) setProjects([]); }); }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q, open]);
  useEffect(() => {
    if (brandId === null && brands.data?.brands.length) setBrandId(brands.data.brands.find((b) => b.hasProfile)?.brandId ?? null);
  }, [brands.data, brandId]);
  const create = async () => {
    if (!projectId) { setError('Pick the project this quotation is for.'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await renoSend<{ id: string }>('/quotations', 'POST', { projectId, brandId, templateId: templateId || null });
      onClose();
      navigate(`/scm/renovation/quotations/${r.id}`);
    } catch (e) {
      setError(refusalOf(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalOverlay open={open} onClose={onClose} title="New quotation" icon={<FileText size={16} />}
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !projectId} onClick={create}>{busy ? 'Creating…' : 'Create quotation'}</Button></div>}>
      <div className="space-y-3">
        <Field label="Project">
          <input className={inputCls} placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <div className="max-h-56 space-y-1 overflow-auto">
          {projects.length === 0 && <div className="px-1 py-2 text-[12.5px] text-ink-muted">No project matches. Projects are opened in Projects when design starts.</div>}
          {projects.map((p) => (
            <button key={p.id} type="button" onClick={() => setProjectId(p.id)}
              className={cn('flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-[13px]', projectId === p.id ? 'border-primary bg-primary-soft' : 'border-border hover:border-border-strong')}>
              <span className="font-semibold text-ink">{p.name}{p.code ? <span className="ml-1 font-normal text-ink-muted">{p.code}</span> : null}</span>
              {p.contractDocNo && <span className="text-[11.5px] text-ink-muted">contract {p.contractDocNo}</span>}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Letterhead">
            <select className={inputCls} value={brandId ?? ''} onChange={(e) => setBrandId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— choose —</option>
              {(brands.data?.brands ?? []).map((b) => <option key={b.brandId} value={b.brandId}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Package template (optional)">
            <select className={inputCls} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Blank quotation</option>
              {(templates.data?.templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        </div>
        <ErrorBanner error={error} />
      </div>
    </ModalOverlay>
  );
}

export function QuotationsList() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const list = useQuotations({ status: status || null, q: q || null });
  const { can } = useAuth();
  const canQuote = can('scm.renovation.quote');
  const rows = list.data?.quotations ?? [];
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Renovation"
        title="Quotations"
        description="Quotations for renovation projects. An accepted revision converts to the sales order in one step."
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link to="/scm/renovation/templates"><Button variant="secondary">Package templates</Button></Link>
            <Link to="/scm/renovation/settings"><Button variant="secondary">Terms & letterheads</Button></Link>
            {canQuote && <Button icon={<Plus size={15} />} onClick={() => setNewOpen(true)}>New quotation</Button>}
          </div>
        )}
      />
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" onClick={() => setStatus(f.value)}
            className={cn('rounded-full border px-3 py-1 text-[12.5px] font-semibold', status === f.value ? 'border-primary bg-primary text-white' : 'border-border bg-surface text-ink-secondary')}>
            {f.label}
          </button>
        ))}
        <input className={cn(inputCls, 'ml-auto w-full sm:w-64')} placeholder="Search number, customer, building" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorBanner error={list.error ? refusalOf(list.error).message : null} />
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="hidden w-full text-left text-[13px] md:table">
          <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-muted">
            <tr><th className="px-3 py-2">Quotation</th><th>Project</th><th>Customer</th><th>Building / unit</th><th>Date</th><th className="text-right">Total</th><th className="px-3">Status</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border-subtle hover:bg-primary-soft/40">
                <td className="px-3 py-2"><Link className="font-semibold text-primary" to={`/scm/renovation/quotations/${r.id}`}>{r.docNo}</Link></td>
                <td className="text-ink-secondary">{r.projectName ?? `#${r.projectId}`}</td>
                <td>{r.customerName || '—'}</td>
                <td className="text-ink-secondary">{[r.building, r.unitNo].filter(Boolean).join(' ') || '—'}</td>
                <td className="text-ink-secondary">{fmtDate(r.docDate)}</td>
                <td className="text-right font-semibold tabular-nums">{rm(r.totalSen)}</td>
                <td className="px-3"><StatusPill status={r.status} />{r.convertedSoDocNo && <Link to={`/scm/renovation/contracts/${encodeURIComponent(r.convertedSoDocNo)}`} className="ml-2 text-[12px] text-primary">{r.convertedSoDocNo}</Link>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="divide-y divide-border-subtle md:hidden">
          {rows.map((r) => (
            <Link key={r.id} to={`/scm/renovation/quotations/${r.id}`} className="block px-3 py-2.5">
              <div className="flex items-center justify-between"><span className="font-semibold text-primary">{r.docNo}</span><StatusPill status={r.status} /></div>
              <div className="text-[12.5px] text-ink-secondary">{r.customerName || '—'} · {[r.building, r.unitNo].filter(Boolean).join(' ')}</div>
              <div className="flex justify-between text-[12.5px]"><span className="text-ink-muted">{fmtDate(r.docDate)}</span><span className="font-semibold tabular-nums">{rm(r.totalSen)}</span></div>
            </Link>
          ))}
        </div>
        {!list.isLoading && rows.length === 0 && <div className="p-8 text-center text-[13px] text-ink-muted">No quotations{status ? ' with this status' : ''} yet.</div>}
        {list.isLoading && <div className="p-8 text-center text-[13px] text-ink-muted">Loading quotations…</div>}
      </div>
      <NewQuotationDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
