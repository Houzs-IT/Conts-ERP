/* Projects on the phone in renovation mode: the board as cards, a project's
   detail (the same responsive screen as desktop, vertical stage timeline), and
   the site receipt. In exhibition mode the original MobilePMS opens instead. */

import { useState, type ReactNode } from "react";
import { ArrowLeft, PackageCheck } from "lucide-react";
import { useQuery } from "../hooks/useQuery";
import { useAuth } from "../auth/AuthContext";
import { renovationApi } from "../pages/projects/renovation/renovationApi";
import { UNIT_KEY_LABEL, supplyLabel, supplyTone } from "../pages/projects/renovation/renovationModel";
import { Pill } from "../pages/projects/renovation/renovationUi";
import { RenovationDetail } from "../pages/projects/renovation/RenovationDetail";
import { useProjectsMode } from "../pages/projects/renovation/RenovationRoutes";
import { MobileSiteReceipt } from "./MobileSiteReceipt";

function TopBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 bg-surface border-b border-border px-3 py-3">
      <button type="button" aria-label="Back" onClick={onBack} className="p-1"><ArrowLeft size={20} /></button>
      <div className="text-base font-semibold text-ink truncate">{title}</div>
    </header>
  );
}

export function MobileProjectsEntry({ onBack, initialProjectId, exhibition }: { onBack: () => void; initialProjectId?: number; exhibition: () => ReactNode }) {
  const mode = useProjectsMode();
  if (mode === null) return <div className="p-6 text-center text-sm text-ink-secondary">Loading...</div>;
  if (mode !== "renovation") return <>{exhibition()}</>;
  return <MobileRenovationProjects onBack={onBack} initialProjectId={initialProjectId} />;
}

function MobileRenovationProjects({ onBack, initialProjectId }: { onBack: () => void; initialProjectId?: number }) {
  const { can } = useAuth();
  const [projectId, setProjectId] = useState<number | null>(initialProjectId ?? null);
  const [receiving, setReceiving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const board = useQuery(["renovation", "board"], () => renovationApi.board());
  const rows = board.data?.data ?? [];
  const current = rows.find((r) => r.id === projectId);

  if (projectId && receiving) {
    return (
      <MobileSiteReceipt
        projectId={projectId}
        projectName={current?.name ?? `Project ${projectId}`}
        onBack={() => setReceiving(false)}
        onDone={(msg) => { setReceiving(false); setFlash(msg); }}
      />
    );
  }

  if (projectId) {
    return (
      <div className="min-h-screen bg-surface-dim pb-24">
        <TopBar title={current?.name ?? "Project"} onBack={() => { setProjectId(null); setFlash(null); }} />
        {flash && <div role="status" className="m-3 rounded-md border border-synced/30 bg-synced-bg px-3 py-2 text-sm text-synced">{flash}</div>}
        <div className="px-3 pt-2">
          <RenovationDetail id={projectId} canWrite={can("projects.write")} embedded key={flash ?? "detail"} />
        </div>
        {can("projects.write") && (
          <footer className="fixed bottom-0 left-0 right-0 border-t border-border bg-surface p-3">
            <button type="button" onClick={() => setReceiving(true)} className="w-full flex items-center justify-center gap-2 rounded-md bg-primary py-3 text-white font-semibold">
              <PackageCheck size={18} />Receive on site
            </button>
          </footer>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-dim">
      <TopBar title="Projects" onBack={onBack} />
      <div className="p-3 space-y-2">
        {board.loading && <p className="text-sm text-ink-secondary text-center py-8">Loading projects...</p>}
        {board.error && <p role="alert" className="text-sm text-err">{board.error}</p>}
        {!board.loading && rows.length === 0 && <p className="text-sm text-ink-secondary text-center py-8">No renovation projects yet.</p>}
        {rows.map((r) => (
          <button key={r.id} type="button" onClick={() => setProjectId(r.id)} className="w-full text-left rounded-lg border border-border bg-surface p-3">
            <div className="font-medium text-ink truncate">{r.name}</div>
            <div className="text-xs text-ink-secondary truncate">{r.code} · {[r.building, r.unitNo].filter(Boolean).join(" ") || "-"}</div>
            <div className="mt-1 text-sm text-ink">{r.renoConditionLabel}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Pill tone={supplyTone(r.furnitureCondition)}>Furniture: {supplyLabel(r.furnitureCondition)}</Pill>
              <Pill tone={supplyTone(r.renoItemCondition)}>Reno: {supplyLabel(r.renoItemCondition)}</Pill>
              <Pill tone="muted">Key: {UNIT_KEY_LABEL[r.unitKey]}</Pill>
              {r.redFlags.length > 0 && <Pill tone="err">{r.redFlags.length} flag{r.redFlags.length === 1 ? "" : "s"}</Pill>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
