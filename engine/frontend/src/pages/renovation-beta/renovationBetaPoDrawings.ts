/* The approved 2D set behind a Built-in PO's PDF (owner, 5 Nov 2026): one copy per PO, drawn after its last page. */

import { api } from "../../api/client";
import { getBrandingCache } from "../../lib/branding";
import type { DesignFile } from "../projects/renovation/simpleApi";
import { dayMonthYear } from "./renovationBetaModel";
import { appendPartsToPdf, type PdfPart } from "./renovationBetaPdf";
import { sheetSetAt, sheetsApi, type BetaSheet } from "./renovationBetaSheets";

const B = "/api/beta";

export interface BuiltinPo { id: string; poNumber: string; revision: number; supplierName: string | null }
interface PoDrawings {
  projectId: number | null; projectName?: string; unit?: string | null; files?: DesignFile[];
  approved?: { fileId: number; version: number; approvedOn: string } | null;
}

export const builtinPos = (projectId: number): Promise<{ pos: BuiltinPo[] }> => api.get(`${B}/projects/${projectId}/builtin-pos`);

export interface ApprovedSheets { projectId: number; version: number; approvedOn: string; sheets: Array<{ key: string; name: string; fileName: string }> }

/** The set as sheets with a stored file; null with nothing approved, or for a PO that is not Built-in. */
export function approvedSheets(d: Pick<PoDrawings, "projectId" | "files" | "approved">, sheets: BetaSheet[]): ApprovedSheets | null {
  const { projectId, approved } = d;
  if (!projectId || !approved) return null;
  const list = sheetSetAt(d.files ?? [], sheets, approved.version).flatMap((x) => (x.key ? [{ key: x.key, name: x.name, fileName: x.fileName }] : []));
  return list.length ? { projectId, version: approved.version, approvedOn: approved.approvedOn, sheets: list } : null;
}

async function withSheets(d: PoDrawings): Promise<ApprovedSheets | null> {
  if (!d.projectId || !d.approved) return null;
  return approvedSheets(d, (await sheetsApi.list(d.projectId)).sheets);
}
export const poApprovedSheets = async (poId: string): Promise<ApprovedSheets | null> => withSheets(await api.get<PoDrawings>(`${B}/po-drawings/${encodeURIComponent(poId)}`));
export const projectApprovedSheets = async (projectId: number): Promise<ApprovedSheets | null> => withSheets(await api.get<PoDrawings>(`${B}/projects/${projectId}/approved-2d`));

/** What to draw after the PO's last page, or null when this PO has no approved drawings to carry. */
export async function poDrawingsAppender(poId: string): Promise<((doc: Parameters<typeof appendPartsToPdf>[0]) => Promise<void>) | null> {
  const d = await api.get<PoDrawings>(`${B}/po-drawings/${encodeURIComponent(poId)}`);
  const { projectId, approved } = d;
  if (!projectId || !approved) return null;
  const { sheets } = await sheetsApi.list(projectId);
  const parts: PdfPart[] = sheetSetAt(d.files ?? [], sheets, approved.version).filter((x) => x.key).map((x) => ({
    key: x.key ?? "", fileName: x.fileName,
    block: {
      company: getBrandingCache().companyName, project: d.projectName ?? "", unit: d.unit ?? null, sheet: x.name,
      version: x.version === approved.version ? `V${x.version}` : `Set V${approved.version} · sheet V${x.version}`,
      date: dayMonthYear(approved.approvedOn), status: `Approved by client ${dayMonthYear(approved.approvedOn)}`,
    },
  }));
  if (parts.length === 0) return null;
  return async (doc) => { await appendPartsToPdf(doc, projectId, parts); };
}
