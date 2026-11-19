/* Packages module list (owner, 20 Nov 2026): every package (PKG-, a whole unit with areas) and kit (组合, KIT-) of the
   company. Search, kind chips, status filter, the engine table (columns saved per user). New package opens the 5-step
   setup; Save from a sales order opens a sales order to save from. No cost and no margin anywhere in this module. */

import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileDown, Plus } from 'lucide-react';
import { PageHeader } from '../../components/Layout';
import { Button } from '../../components/Button';
import { DataTable } from '../../components/DataTable';
import type { Column } from '../../components/dataTableTypes';
import { FilterPills } from '../../components/FilterPills';
import { StatCard } from '../../components/StatCard';
import { ModalOverlay } from '../../components/scm-v2/DocumentRelationshipMapModal';
import { useAuth } from '../../auth/AuthContext';
import { refusalOf } from '../../lib/renovation/api';
import { STATUS_LABEL, usePackages, type PackageKind, type PackageRow, type PackageStatus } from '../../lib/renovation/renovationPackagesApi';
import { fmtDate, inputCls, rm } from './shared';
import { KindPill, PackageStatusPill, SlaPill } from './renovationPackageParts';
import { cn } from '../../lib/utils';

const COLUMNS: Column<PackageRow>[] = [
  { key: 'kind', label: 'Type', width: '110px', getValue: (r) => (r.kind === 'KIT' ? 'Kit' : 'Package'), render: (r) => <KindPill kind={r.kind} /> },
  { key: 'code', label: 'Code', alwaysVisible: true, getValue: (r) => r.code, disableFilter: true, render: (r) => <span className="font-mono font-semibold text-primary">{r.code}</span> },
  { key: 'name', label: 'Name', getValue: (r) => r.name, render: (r) => <span className="font-semibold">{r.name}</span> },
  { key: 'building', label: 'Building', getValue: (r) => r.building || 'Any', render: (r) => <span className="text-ink-secondary">{r.building || 'Any'}</span> },
  { key: 'areas', label: 'Areas', align: 'right', width: '80px', getValue: (r) => r.areas, disableFilter: true, render: (r) => <span className="tabular-nums">{r.areas}</span> },
  { key: 'lines', label: 'Lines', align: 'right', width: '80px', getValue: (r) => r.lines, disableFilter: true, render: (r) => <span className="tabular-nums">{r.lines}</span> },
  { key: 'total', label: 'At SKU price', align: 'right', getValue: (r) => r.totalSen, exportValue: (r) => r.totalSen / 100, disableFilter: true,
    render: (r) => <span className="tabular-nums">{rm(r.totalSen)}</span> },
  { key: 'sla', label: 'SLA', width: '100px', getValue: (r) => (r.slaSet ? 'Set' : 'Not set'), render: (r) => <SlaPill set={r.slaSet} /> },
  { key: 'used', label: 'Used', align: 'right', width: '80px', getValue: (r) => r.used, disableFilter: true, render: (r) => <span className="tabular-nums">{r.used}</span> },
  { key: 'status', label: 'Status', width: '110px', getValue: (r) => STATUS_LABEL[r.status], render: (r) => <PackageStatusPill status={r.status} /> },
  { key: 'updated', label: 'Updated', width: '130px', getValue: (r) => r.updatedAt, filterType: 'date', dateValue: (r) => r.updatedAt.slice(0, 10), filterLabel: fmtDate,
    render: (r) => <span className="whitespace-nowrap text-ink-secondary">{fmtDate(r.updatedAt)}</span> },
];

const KIND_FILTERS: Array<{ value: '' | PackageKind; label: string }> = [{ value: '', label: 'All' }, { value: 'PACKAGE', label: 'Package' }, { value: 'KIT', label: '组合' }];

/** "Save from a sales order": the sales order number to open; the Save as package button waits on its page. */
function SaveFromSoDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const navigate = useNavigate();
  const [docNo, setDocNo] = useState('');
  const go = () => { const d = docNo.trim().toUpperCase(); if (d) navigate(`/scm/sales-orders/${encodeURIComponent(d)}?savePackage=1`); };
  return (
    <ModalOverlay open={open} onClose={onClose} title="Save from a sales order" icon={<FileDown size={16} />}
      footer={<div className="flex w-full justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!docNo.trim()} onClick={go}>Open sales order</Button></div>}>
      <div className="space-y-3 text-[13px]">
        <p className="text-ink-secondary">Open a finished sales order and press <b>Save as package</b> there: tick the areas and lines to keep, give it a code and a name. Quantities and SLA days are copied, prices are not.</p>
        <label className="flex flex-col gap-1 text-[12px] text-ink-muted">Sales order number
          <input autoFocus className={inputCls} value={docNo} placeholder="e.g. TC-SO-2611-007" onChange={(e) => setDocNo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} />
        </label>
      </div>
    </ModalOverlay>
  );
}

export function RenovationPackages(): ReactElement {
  const navigate = useNavigate();
  const { can } = useAuth();
  const list = usePackages();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'' | PackageKind>('');
  const [status, setStatus] = useState<'' | PackageStatus>('ACTIVE');
  const [fromSo, setFromSo] = useState(false);
  const all = useMemo(() => list.data?.packages ?? [], [list.data]);
  const rows = useMemo(() => {
    const words = q.trim().toLowerCase();
    return all.filter((r) => (!kind || r.kind === kind) && (!status || r.status === status)
      && (!words || `${r.code} ${r.name} ${r.building}`.toLowerCase().includes(words)));
  }, [all, q, kind, status]);
  const active = all.filter((r) => r.status === 'ACTIVE');
  const pending = list.isLoading;
  const failed = { failed: Boolean(list.error), onRetry: () => void list.refetch() };
  const canEdit = can('scm.renovation.quote');
  return (
    <div>
      <PageHeader
        eyebrow="Sales order"
        title="Packages"
        description="Packages (a whole unit, by area) and 组合 (a few items together). Sales find the active ones in the sales order and VO product search."
        primaryAction={canEdit ? <Button variant="primary" icon={<Plus size={14} />} onClick={() => navigate('/scm/renovation/packages/new')}>New package</Button> : undefined}
        actions={canEdit ? <Button variant="secondary" icon={<FileDown size={14} />} onClick={() => setFromSo(true)}>Save from a sales order</Button> : undefined}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard pending={pending} {...failed} label="Active packages" value={String(active.filter((r) => r.kind === 'PACKAGE').length)} subtitle="Offered in the SO search" rail="bg-primary" active />
        <StatCard pending={pending} {...failed} label="Active 组合" value={String(active.filter((r) => r.kind === 'KIT').length)} subtitle="Kits of a few items" rail="bg-accent" />
        <StatCard pending={pending} {...failed} label="Used" value={String(all.reduce((s, r) => s + r.used, 0))} subtitle="Variation orders that took one" rail="bg-synced" />
        <StatCard pending={pending} {...failed} label="No SLA yet" value={String(active.filter((r) => !r.slaSet).length)} subtitle="Active ones without SLA days" tone="error" rail="bg-err" />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterPills options={KIND_FILTERS.map((f) => ({ ...f, count: pending ? undefined : all.filter((r) => !f.value || r.kind === f.value).length }))} value={kind} onChange={setKind} />
        <select aria-label="Status" className={cn(inputCls, 'w-auto')} value={status} onChange={(e) => setStatus(e.target.value as '' | PackageStatus)}>
          <option value="ACTIVE">Active</option><option value="DRAFT">Draft</option><option value="INACTIVE">Inactive</option><option value="">Any status</option>
        </select>
      </div>
      <DataTable<PackageRow>
        tableId="renovation-packages"
        documentLabel="Packages"
        exportName="packages"
        rows={rows}
        loading={list.isLoading}
        error={list.error ? refusalOf(list.error).message : null}
        columns={COLUMNS}
        getRowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/scm/renovation/packages/${r.id}`)}
        mobileCard={{ primary: 'code', cells: ['name', 'kind', 'status', 'lines', 'total'] }}
        emptyLabel={q || kind || status ? 'Nothing matches.' : 'No packages yet.'}
        search={{ value: q, onChange: setQ, placeholder: 'Search code, name or building', scope: 'server', totalRecords: rows.length, countPending: list.isLoading }}
      />
      <SaveFromSoDialog open={fromSo} onClose={() => setFromSo(false)} />
    </div>
  );
}
