/* The approved 2D set behind a Built-in PO's PDF (owner, 5 Nov 2026): one copy per PO, drawn after its last page. */

import { api } from "../../api/client";
import { getBrandingCache } from "../../lib/branding";
import type { DesignFile } from "../projects/renovation/simpleApi";
import { dayMonthYear } from "./renovationBetaModel";
import { appendPartsToPdf, type PdfPart } from "./renovationBetaPdf";
import { sheetSetAt, sheetsApi } from "./renovationBetaSheets";

const B = "/api/beta";

export interface BuiltinPo { id: string; poNumber: string; revision: number; supplierName: string | null }
interface PoDrawings {
  projectId: number | null; projectName?: string; unit?: string | null; files?: DesignFile[];
  approved?: { fileId: number; version: number; approvedOn: string } | null;
}

export const builtinPos = (projectId: number): Promise<{ pos: BuiltinPo[] }> => api.get(`${B}/projects/${projectId}/builtin-pos`);

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
