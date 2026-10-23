/* Beta > Project workspace for one renovation project (owner, 23 Oct 2026). It copies the owner's mockup
   ("Renovation Project Workspace", project page): the header, the stage stepper and the tabs. Bundle A fills
   Overview, Drawings, Site & photos, Defects and Timeline; bundle B fills VO, PO and Client PO
   (docs/superpowers/plans/2026-10-23-beta-project-workspace.md).
   The project, the workspace and the design records are loaded here once and handed to the tabs; every write
   shows a notice and reloads all three. */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthContext";
import { useQuery } from "../../hooks/useQuery";
import { simpleApi } from "../projects/renovation/simpleApi";
import { BetaClientPoTab } from "./BetaClientPoTab";
import { BetaDefectsTab } from "./BetaDefectsTab";
import { BetaDrawingsTab } from "./BetaDrawingsTab";
import { BetaOverviewTab } from "./BetaOverviewTab";
import { BetaPoTab } from "./BetaPoTab";
import { BetaSiteTab } from "./BetaSiteTab";
import { BetaTimelineTab } from "./BetaTimelineTab";
import { BetaVoTab } from "./BetaVoTab";
import { BetaDialogs, type BetaDialog } from "./BetaForms";
import { BetaWsHeader, BetaWsStepper } from "./BetaWsHeader";
import { WS, WsNotice, WsStyle } from "./BetaWsUi";
import type { BetaTabProps, BoardView } from "./betaShared";
import { betaApi } from "./renovationBetaApi";
import { projectView } from "./renovationBetaBoard";
import { boardApi, boardKey, forgetLastProject, invalidateBeta, rememberLastProject } from "./renovationBetaBoardApi";
import { mytDay, stepperItems } from "./renovationBetaModel";
import { BETA } from "./renovationBetaTheme";
import { BETA_TABS, tabFromParam, type BetaTabKey } from "./renovationBetaTabs";

/** A request the server answered with 404: the project is gone, or Beta is switched off. */
function isNotFound(e: unknown): boolean {
  return typeof e === "object" && e !== null && "status" in e && (e as { status?: unknown }).status === 404;
}

export function RenovationBetaWorkspace(): ReactElement {
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const tab = tabFromParam(params.get("tab"));
  const valid = Number.isInteger(id) && id > 0;
  const q = useQuery(["renovation-beta", "detail", id], () => simpleApi.detail(id), [id], { enabled: valid });
  // The same board answer Home and Calendar use, for this one project: people, dates and condition match them.
  const bq = useQuery(boardKey(undefined, id), () => boardApi.board(undefined, id).catch((e: unknown) => { if (isNotFound(e)) forgetLastProject(); throw e; }), [id], { enabled: valid });
  const ws = useQuery(["renovation-beta", "workspace", id], () => betaApi.workspace(id), [id], { enabled: valid });
  const rec = useQuery(["renovation-beta", "records", id], () => simpleApi.designRecords(id), [id], { enabled: valid });
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [dialog, setDialog] = useState<BetaDialog | null>(null);
  const d = q.data;
  const view = useMemo(() => (bq.data ? projectView(bq.data, id) : null), [bq.data, id]);
  const loaded = d != null && view != null;

  useEffect(() => {
    if (loaded) rememberLastProject(id);
  }, [loaded, id]);

  if (!valid) return <p role="alert" style={{ padding: "24px 0", fontSize: 14, color: WS.red }}>This project address is not valid.</p>;
  if (q.loading && !d) return <p style={{ padding: "40px 0", textAlign: "center", fontSize: 14, color: BETA.muted }}>Loading project...</p>;
  if (q.error || !d) return <p role="alert" style={{ padding: "24px 0", fontSize: 14, color: WS.red }}>The project could not be loaded: {q.error ?? "not found"}</p>;
  if (bq.loading && !bq.data) return <p style={{ padding: "40px 0", textAlign: "center", fontSize: 14, color: BETA.muted }}>Loading project...</p>;
  const raw = bq.data?.projects.find((x) => x.id === id);
  if (bq.error || !view || !raw) return <p role="alert" style={{ padding: "24px 0", fontSize: 14, color: WS.red }}>The project could not be loaded: {bq.error ?? "not found"}</p>;
  const board: BoardView = { ...view, raw };

  const today = mytDay(new Date().toISOString());
  const { project: p } = d;
  const current = BETA_TABS.find((t) => t.key === tab) ?? BETA_TABS[0];
  // Home and Calendar read the same board, so every write refreshes all of Beta, not only this page.
  const reloadAll = (): void => { q.reload(); ws.reload(); rec.reload(); bq.reload(); void invalidateBeta(queryClient); };
  const openTab = (key: BetaTabKey): void => setParams((prev) => { const next = new URLSearchParams(prev); next.set("tab", key); return next; }, { replace: true });
  const onDone = (text: string): void => { setNotice({ tone: "ok", text }); reloadAll(); };
  const onError = (text: string): void => setNotice({ tone: "err", text });
  const props: BetaTabProps | null = ws.data && rec.data
    ? { projectId: id, detail: d, workspace: ws.data, records: rec.data, canWrite: can("projects.write"), today, openTab, onDone, onError, board, openDialog: setDialog }
    : null;
  const items = stepperItems({
    steps: d.flow.steps, currentKey: d.flow.current, currentIndex: d.flow.currentIndex, soDate: d.so?.so_date ?? null, handoverOn: p.handed_over_at ?? p.planned_handover_date, tasks: d.tasks, today,
  });
  const hold = d.hold ? (d.hold.flag === "in_defect" ? "In defect" : "On hold") : null;

  return (
    <div className="bws" style={{ display: "flex", flexDirection: "column", gap: 20, width: "100%", minWidth: 0, paddingBottom: 40 }}>
      <WsStyle />
      <BetaWsHeader d={d} p={board.p} canWrite={can("projects.write")} today={today} openDialog={setDialog} />
      <BetaWsStepper items={items} hold={hold} />

      <nav aria-label="Project sections" className="tabs">
        {BETA_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className="tab"
            aria-current={t.key === tab ? "page" : undefined}
            onClick={() => { setNotice(null); openTab(t.key); }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div aria-live="polite">{notice && <WsNotice tone={notice.tone}>{notice.text}</WsNotice>}</div>

      {ws.error || rec.error ? (
        <p role="alert" style={{ padding: "24px 0", fontSize: 14, color: WS.red }}>This section could not be loaded: {ws.error ?? rec.error}</p>
      ) : !props ? (
        <p style={{ padding: "40px 0", textAlign: "center", fontSize: 14, color: BETA.muted }}>Loading {current.label.toLowerCase()}...</p>
      ) : (
        <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 20 }} aria-label={current.label} role="region">
          {tab === "overview" && <BetaOverviewTab {...props} />}
          {tab === "drawings" && <BetaDrawingsTab {...props} />}
          {tab === "site" && <BetaSiteTab {...props} />}
          {tab === "defects" && <BetaDefectsTab {...props} />}
          {tab === "timeline" && <BetaTimelineTab {...props} />}
          {tab === "vo" && <BetaVoTab {...props} />}
          {tab === "po" && <BetaPoTab {...props} />}
          {tab === "client-po" && <BetaClientPoTab {...props} />}
        </div>
      )}

      <BetaDialogs
        dialog={dialog}
        env={{ m: board.m, who: "All", onClose: () => setDialog(null), onSaved: (text) => { setDialog(null); onDone(text); } }}
      />
    </div>
  );
}
