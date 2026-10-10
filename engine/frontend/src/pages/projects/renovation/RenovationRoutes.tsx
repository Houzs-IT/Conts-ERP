/* How the engine's Projects area switches to renovation (app_settings
   projects_mode = renovation, mig 0082): the list view becomes the board, the
   calendar view becomes the task calendar, and a renovation project opens the
   renovation detail. An exhibition project (or an install still in exhibition
   mode) keeps the original screens. */

import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "../../../hooks/useQuery";
import { useAuth } from "../../../auth/AuthContext";
import { renovationApi } from "./renovationApi";
import { RenovationBoard } from "./RenovationBoard";
import { RenovationCalendar } from "./RenovationCalendar";
import { RenovationDetail } from "./RenovationDetail";

export function useProjectsMode(): "renovation" | "exhibition" | null {
  const q = useQuery(["renovation", "mode"], () => renovationApi.mode(), [], { staleTime: 5 * 60_000 });
  if (q.loading) return null;
  return q.data?.mode === "renovation" ? "renovation" : "exhibition";
}

/** Renders `renovation` in renovation mode, `exhibition` otherwise, nothing while unknown. */
export function ByProjectsMode({ renovation, exhibition }: { renovation: () => ReactNode; exhibition: () => ReactNode }) {
  const mode = useProjectsMode();
  if (mode === null) return <p className="py-10 text-center text-sm text-ink-secondary">Loading...</p>;
  return <>{mode === "renovation" ? renovation() : exhibition()}</>;
}

export function RenovationListView() {
  const { can } = useAuth();
  return <RenovationBoard canCreate={can("projects.write")} />;
}

export function RenovationCalendarView() {
  const { can } = useAuth();
  return <RenovationCalendar canWrite={can("projects.write")} />;
}

/** The renovation detail when this id is a renovation project; `fallback` (the
    exhibition detail) when the renovation API answers 404 for it. */
export function RenovationProjectRoute({ id, fallback }: { id: number; fallback: () => ReactNode }) {
  const { can } = useAuth();
  const [kind, setKind] = useState<"checking" | "renovation" | "other">("checking");
  useEffect(() => {
    let live = true;
    setKind("checking");
    renovationApi.detail(id)
      .then(() => { if (live) setKind("renovation"); })
      .catch((e: unknown) => { if (live) setKind((e as { status?: number })?.status === 404 ? "other" : "renovation"); });
    return () => { live = false; };
  }, [id]);
  if (kind === "checking") return <p className="py-10 text-center text-sm text-ink-secondary">Loading project...</p>;
  if (kind === "other") return <>{fallback()}</>;
  return <RenovationDetail id={id} canWrite={can("projects.write")} />;
}
