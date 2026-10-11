// The project a renovation sales order belongs to (owner decisions 11 Oct 2026):
// an SO may come before its project. Without one, pick an existing project or
// open a new one from this SO (name, customer, building and unit come from the
// contract). Linking brings the SO's works lines into the project's site tasks.

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { FolderKanban } from 'lucide-react';
import { Button } from '../../components/Button';
import { useQuery } from '../../hooks/useQuery';
import { searchProjects } from '../../lib/renovation/api';
import { renovationApi } from '../projects/renovation/renovationApi';
import { simpleApi } from '../projects/renovation/simpleApi';
import { errorText } from '../projects/renovation/renovationModel';
import { Card, inputCls } from './shared';

export function ContractProjectCard({ docNo, projectId, canWrite }: { docNo: string; projectId: number | null; canWrite: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Array<{ id: number; code: string | null; name: string; contractDocNo: string | null }>>([]);
  const [typeId, setTypeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const types = useQuery(['renovation', 'types'], () => renovationApi.types(), [], { staleTime: 5 * 60_000 });
  const activeTypes = (types.data?.data ?? []).filter((t) => t.active);
  const chosenType = typeId || (activeTypes[0] ? String(activeTypes[0].id) : '');

  useEffect(() => {
    if (projectId != null || !canWrite) return;
    let live = true;
    const t = setTimeout(() => { searchProjects(q).then((r) => { if (live) setFound(r.projects.filter((p) => !p.contractDocNo)); }).catch(() => { if (live) setFound([]); }); }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q, projectId, canWrite]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); await qc.invalidateQueries(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  if (projectId != null) {
    return (
      <Card title="Project">
        <div className="flex items-center gap-2 text-[13px]"><FolderKanban size={15} /><Link className="text-primary font-semibold" to={`/projects/${projectId}`}>Open the project</Link></div>
      </Card>
    );
  }
  return (
    <Card title="Project">
      <p className="text-[12.5px] text-ink-muted">This sales order has no project yet. Link it to the project it belongs to, or open a new project from it.</p>
      {canWrite && (
        <div className="mt-2 space-y-3">
          <div>
            <input className={inputCls} placeholder="Search projects without a contract" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
            <div className="mt-1 max-h-44 space-y-1 overflow-auto">
              {found.length === 0 && <div className="px-1 py-1 text-[12px] text-ink-muted">No project without a contract matches.</div>}
              {found.map((p) => (
                <button key={p.id} type="button" disabled={busy} className="w-full rounded-lg border border-border px-3 py-1.5 text-left text-[13px] hover:border-primary"
                  onClick={() => run(() => simpleApi.linkSo(p.id, docNo))}>
                  <span className="font-semibold text-ink">{p.name}</span>{p.code ? <span className="ml-1 text-ink-muted">{p.code}</span> : null}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[12px] text-ink-muted">Project type
              <select className={inputCls} value={chosenType} onChange={(e) => setTypeId(e.target.value)}>
                {activeTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <Button disabled={busy || !chosenType} onClick={() => run(async () => {
              const r = await simpleApi.projectFromSo({ docNo, projectTypeId: Number(chosenType) });
              navigate(`/projects/${r.id}`);
            })}>Create project from this SO</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[12.5px] text-err">{error}</p>}
    </Card>
  );
}
