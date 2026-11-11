/* The sales order's PDF without its page: the project's Export PDF (owner, 7 Nov 2026) downloads the same document the
   order's own Print preview does, by area. */

import { fetchPrintBundle } from "../../lib/printDocumentPdf";
import type { PdfAction } from "../../vendor/scm/lib/pdf-common";
import { renoGet, type BrandProfile, type ContractView } from "../../lib/renovation/api";
import { soInfoApi } from "../projects/renovation/customerPropertyApi";
import { projectDatesText } from "../projects/renovation/customerPropertyModel";

/** A renovation contract's brand block and instalments, as the SO PDF prints them. */
export function soPdfContract(contract: ContractView | undefined, brand: BrandProfile | undefined) {
  return contract && brand ? {
    brandName: brand.name, logoKey: brand.logoR2Key, letterhead: [...brand.companyLines, brand.contactLine].filter(Boolean), bankLine: brand.bankLine, termsLines: brand.termsLines,
    instalments: contract.instalments.map((i) => ({ label: i.label, percent: `${i.pctBp / 100}%`, description: i.description })),
  } : undefined;
}

/* The PDF's standard font has no em dash. */
const pdfText = (t: string): string => t.replace(/—/g, "-");

/** renovation null reads it from the order (a renovation contract prints its brand block and instalments). "preview" shows
    the PDF in the in-app viewer instead of saving it (the project's Open SO, feedback 11 Nov 2026). */
export async function downloadSoPdf(docNo: string, renovation: boolean | null, action: PdfAction = "save"): Promise<void> {
  const [bundle, info, { generateSalesOrderPdf }] = await Promise.all([
    fetchPrintBundle({ doc: "so", docNo, key: docNo }),
    soInfoApi.so(docNo),
    import("../../vendor/scm/lib/sales-order-pdf"),
  ]);
  const dates = projectDatesText(info.project, "so");
  let contract: ReturnType<typeof soPdfContract>;
  if (renovation ?? (bundle.header as { so_kind?: string | null }).so_kind === "RENOVATION") {
    const [view, { brands }] = await Promise.all([
      renoGet<ContractView>(`/sales-orders/${encodeURIComponent(docNo)}`),
      renoGet<{ brands: BrandProfile[] }>("/brands"),
    ]);
    contract = soPdfContract(view, brands.find((b) => b.brandId === view.header.brandId));
  }
  await generateSalesOrderPdf(bundle.header as never, bundle.items as never, (bundle.payments ?? []) as never, action, (bundle.pwpCodes ?? []) as never, {
    rooms: info.roomSections.length > 0 ? { order: info.roomSections, byItem: info.itemRooms } : undefined,
    projectDates: { start: pdfText(dates.start), end: pdfText(dates.end) },
    contract,
  });
}

/** One file per order, one after the other: a browser refuses several downloads started at once. */
export async function downloadSoPdfs(orders: ReadonlyArray<{ docNo: string; renovation?: boolean }>): Promise<void> {
  for (const o of orders) await downloadSoPdf(o.docNo, !!o.renovation);
}
