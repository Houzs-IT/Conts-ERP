/* Small pieces the Beta workspace tabs share: the props every tab gets, the WhatsApp reminder, the file viewer. */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { api } from "../../api/client";
import { AuthImage, Dialog } from "../projects/renovation/renovationUi";
import { errorText } from "../projects/renovation/renovationModel";
import { simpleApi, type ProjectDetailV2 } from "../projects/renovation/simpleApi";
import { betaApi, type BetaTrade, type BetaWorkspace, type DesignRecords, type ReminderKind } from "./renovationBetaApi";
import { whatsappLink } from "./renovationBetaModel";
import type { BetaTabKey } from "./renovationBetaTabs";

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

export interface ViewedFile { key: string; name: string }

const IMAGE = /\.(png|jpe?g|webp)$/i;
const FILE_TYPE: Readonly<Record<string, string | undefined>> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** An image shows in place. Any other file is fetched with the sign-in header (a plain link cannot carry it) and offered as a link to the downloaded copy. */
export function FileDialog({ projectId, file, onClose }: { projectId: number; file: ViewedFile; onClose: () => void }): ReactElement {
  const path = simpleApi.fileUrl(projectId, file.key);
  const isImage = IMAGE.test(file.key);
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
    <Dialog title={file.name} onClose={onClose} wide>
      {isImage ? <AuthImage path={path} alt={file.name} className="w-full rounded" />
        : error ? <p role="alert" className="text-sm text-err">The file could not be loaded: {error}</p>
        : !blobUrl ? <p className="text-sm text-ink-secondary">Loading the file...</p>
        : <p className="text-sm"><a className="text-primary" href={blobUrl} target="_blank" rel="noopener" download={file.name}>Open the file</a></p>}
    </Dialog>
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
