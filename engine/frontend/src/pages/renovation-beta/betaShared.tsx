/* Small pieces the Beta workspace tabs share: the props every tab gets, the WhatsApp reminder, the file viewer. */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { api } from "../../api/client";
import { errorText } from "../projects/renovation/renovationModel";
import { simpleApi, type ProjectDetailV2 } from "../projects/renovation/simpleApi";
import { WS, WsDialog, WsPhoto } from "./BetaWsUi";
import { betaApi, type BetaTrade, type BetaWorkspace, type DesignRecords, type ReminderKind } from "./renovationBetaApi";
import type { BetaDialog } from "./BetaForms";
import type { BoardModel, DesignProject } from "./renovationBetaBoard";
import type { BetaBoardProject } from "./renovationBetaBoardApi";
import { dayMonthYear, whatsappLink } from "./renovationBetaModel";
import { BETA } from "./renovationBetaTheme";
import type { BetaTabKey } from "./renovationBetaTabs";

/** The project as Home and Calendar see it (the board's logic), so the workspace shows the same dates and conditions. */
export interface BoardView { m: BoardModel; p: DesignProject; raw: BetaBoardProject }

export interface BetaTabProps {
  projectId: number;
  detail: ProjectDetailV2;
  workspace: BetaWorkspace;
  records: DesignRecords;
  canWrite: boolean;
  /** Today in Malaysia time, YYYY-MM-DD. */
  today: string;
  /** Show a success notice and reload what the page shows. */
  onDone: (text: string) => void;
  onError: (text: string) => void;
  openTab: (tab: BetaTabKey) => void;
  board: BoardView;
  /** Opens one of the shared Home and Calendar forms (assign, book, amend). */
  openDialog: (dialog: BetaDialog) => void;
}

export const TRADE_LABEL: Readonly<Record<BetaTrade, string>> = {
  carpenter: "Carpenter",
  electrician: "Electrician",
  plumber: "Plumber",
  painter: "Painter",
  plaster: "Plaster",
  hacking: "Hacking",
  aircon: "Aircon",
  tiler: "Tiler",
  other: "Other",
};

export function tradeLabel(trade: string | null): string | null {
  if (!trade) return null;
  return (TRADE_LABEL as Readonly<Record<string, string | undefined>>)[trade] ?? trade;
}

export interface ReminderRequest { kind: ReminderKind; text: string; phone: string | null }

/** Opens WhatsApp in a new tab and records the reminder. The tab opens first, in the click itself, so the browser allows it. */
export async function sendReminder(projectId: number, r: ReminderRequest, onDone: (t: string) => void, onError: (t: string) => void): Promise<void> {
  const text = r.text.slice(0, 1000);
  window.open(whatsappLink(r.phone, text), "_blank", "noopener");
  try {
    await betaApi.remind(projectId, { kind: r.kind, text });
    onDone("Reminder recorded. WhatsApp opened in a new tab.");
  } catch (e) {
    onError(`WhatsApp was opened, but the reminder was not recorded: ${errorText(e)}`);
  }
}

export interface ViewedVersion { version: number; key: string; fileName: string; uploadedOn: string }

/** `versions` (newest first) lets the viewer switch between the versions of one sheet. */
export interface ViewedFile { key: string; name: string; versions?: ViewedVersion[] }

const IMAGE = /\.(png|jpe?g|webp)$/i;
const FILE_TYPE: Readonly<Record<string, string | undefined>> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** An image or a PDF shows in place. Any other file is fetched with the sign-in header (a plain link cannot carry it) and offered as a link to the downloaded copy. */
export function FileDialog({ projectId, file: opened, onClose }: { projectId: number; file: ViewedFile; onClose: () => void }): ReactElement {
  const versions = opened.versions ?? [];
  const [pickedKey, setPickedKey] = useState(opened.key);
  const picked = versions.find((v) => v.key === pickedKey);
  const file: ViewedFile = { key: picked?.key ?? opened.key, name: opened.name };
  const downloadName = picked?.fileName ?? opened.name;
  const path = simpleApi.fileUrl(projectId, file.key);
  const isImage = IMAGE.test(file.key);
  // A PDF shows in place, as MediaLightbox does; phones have no inline PDF viewer (an empty box), so they keep the link.
  const inlinePdf = /\.pdf$/i.test(file.key) && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (isImage) return;
    let live = true;
    let made: string | null = null;
    const ext = file.key.split(".").pop()?.toLowerCase() ?? "";
    api.fetchBlobUrl(path, FILE_TYPE[ext] ?? null)
      .then((u) => { made = u; if (live) setBlobUrl(u); else URL.revokeObjectURL(u); })
      .catch((e: unknown) => { if (live) setError(errorText(e)); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [path, isImage, file.key]);
  return (
    <WsDialog title={file.name} sub={picked ? `V${picked.version} · ${dayMonthYear(picked.uploadedOn)}${picked === versions[0] ? " · latest" : ""}` : undefined} onClose={onClose} wide>
      {versions.length > 1 && (
        <div role="group" aria-label="Choose version" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 12, fontSize: 13 }}>
          <span style={{ color: BETA.muted, fontWeight: 600, marginRight: 4 }}>Version</span>
          {versions.map((v) => {
            const on = v.key === file.key;
            return (
              <button key={v.key} type="button" aria-pressed={on} onClick={() => { setBlobUrl(null); setError(null); setPickedKey(v.key); }}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 64, minHeight: 44, padding: "4px 10px", borderRadius: 8, font: "inherit", cursor: "pointer",
                  border: `1px solid ${on ? BETA.ink : BETA.line}`, background: on ? BETA.ink : BETA.surface, color: on ? BETA.surface : BETA.ink }}>
                <span style={{ fontWeight: 700 }}>V{v.version}</span>
                <span style={{ fontSize: 11, opacity: 0.8 }}>{dayMonthYear(v.uploadedOn)}</span>
              </button>
            );
          })}
        </div>
      )}
      {isImage ? <div style={{ maxHeight: "70vh", overflow: "auto" }}><WsPhoto path={path} alt={file.name} style={{ height: "auto", objectFit: "contain" }} /></div>
        : error ? <p role="alert" style={{ fontSize: 14, color: WS.red }}>The file could not be loaded: {error}</p>
        : !blobUrl ? <p style={{ fontSize: 14, color: BETA.muted }}>Loading the file...</p>
        : (
          <>
            {inlinePdf && <iframe src={blobUrl} title={file.name} style={{ width: "100%", height: "70vh", border: 0, borderRadius: 8, background: "#FFFFFF", marginBottom: 10 }} />}
            <p style={{ fontSize: 14 }}><a href={blobUrl} target="_blank" rel="noopener" download={downloadName}>{inlinePdf ? "Open in a new tab" : "Open the file"}</a></p>
          </>
        )}
    </WsDialog>
  );
}

/** Runs one write at a time: busy is true while it is in flight, and a second press meanwhile does nothing. */
export function useGuarded(): { busy: boolean; run: (fn: () => Promise<void>) => Promise<void> } {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = async (fn: () => Promise<void>): Promise<void> => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try { await fn(); } finally { lock.current = false; setBusy(false); }
  };
  return { busy, run };
}
