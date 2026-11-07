/* The approved 2D set where the carpenter's work is read (owner, 7 Nov 2026): on a Built-in PO and on a Built-in line. A
   Production Order never shows it: Built-in has none. Nothing shows until the client has approved a set. Each sheet opens
   in the app's file view, one the page already has or a dialog of its own. */

import { useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { simpleApi } from "../projects/renovation/simpleApi";
import { BETA } from "./renovationBetaTheme";
import { FileDialog } from "./betaShared";
import { WsPhoto } from "./BetaWsUi";
import { dayMonthYear } from "./renovationBetaModel";
import { poApprovedSheets, projectApprovedSheets, type ApprovedSheets } from "./renovationBetaPoDrawings";

const isImage = (name: string): boolean => /\.(png|jpe?g|webp|gif)$/i.test(name);

function Sheets({ set, size }: { set: ApprovedSheets; size: number }): ReactElement {
  const [open, setOpen] = useState<{ key: string; name: string } | null>(null);
  return (
    <div role="group" aria-label={`Approved 2D set V${set.version}`} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: BETA.accentInk }}>2D V{set.version}, approved {dayMonthYear(set.approvedOn)}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {set.sheets.map((s) => (isImage(s.fileName)
          ? <span key={s.key} style={{ width: size, height: size, borderRadius: 4, overflow: "hidden", flexShrink: 0 }}>
              <WsPhoto path={simpleApi.fileUrl(set.projectId, s.key)} alt={s.name} onClick={() => setOpen({ key: s.key, name: s.fileName })} />
            </span>
          : <button key={s.key} type="button" onClick={() => setOpen({ key: s.key, name: s.fileName })}
              style={{ display: "inline-flex", alignItems: "center", gap: 3, maxWidth: 160, border: `1px solid ${BETA.line}`, borderRadius: 4, background: "transparent", padding: "1px 5px", fontSize: 11.5, color: BETA.ink, cursor: "pointer" }}>
              <FileText size={11} aria-hidden="true" /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
            </button>))}
      </div>
      {open && <FileDialog projectId={set.projectId} file={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** On a Built-in PO's page. */
export function PoApprovedDrawings({ poId }: { poId: string }): ReactElement | null {
  const q = useQuery({ queryKey: ["renovation-beta", "po-approved-2d", poId], queryFn: () => poApprovedSheets(poId), retry: false, staleTime: 30_000 });
  if (!q.data) return null;
  return <section aria-label="Approved 2D drawings" style={{ border: `1px solid ${BETA.line}`, borderRadius: 10, padding: 12 }}><Sheets set={q.data} size={72} /></section>;
}

/** On a Built-in line of the project's SO tab. */
export function LineApprovedDrawings({ projectId }: { projectId: number }): ReactElement | null {
  const q = useQuery({ queryKey: ["renovation-beta", "project-approved-2d", projectId], queryFn: () => projectApprovedSheets(projectId), retry: false, staleTime: 30_000 });
  return q.data ? <Sheets set={q.data} size={36} /> : null;
}

export { approvedSheets } from "./renovationBetaPoDrawings";
