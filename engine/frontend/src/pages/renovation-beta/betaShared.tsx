/* Small pieces the Beta workspace tabs share: the props every tab gets, the WhatsApp reminder, the file viewer. */

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

export function FileDialog({ projectId, file, onClose }: { projectId: number; file: ViewedFile; onClose: () => void }) {
  const path = simpleApi.fileUrl(projectId, file.key);
  return (
    <Dialog title={file.name} onClose={onClose} wide>
      {IMAGE.test(file.key)
        ? <AuthImage path={path} alt={file.name} className="w-full rounded" />
        : <p className="text-sm"><a className="text-primary" href={path} target="_blank" rel="noopener">Open the file</a></p>}
    </Dialog>
  );
}
