/* The sales order's Print preview, one for every screen that prints an SO: the read page (SalesOrderDetailV2) and
   the editor (SalesOrderDetail, ?edit=1 and Submit VO) open the same dialog, with the same summary card and, for an
   order with rooms, the same "PDF layout" picker (By item / By area / By category). Owner, 3 Nov 2026: some screens
   showed the picker and others did not, and the card changed size from one screen to the next. */

import { useMemo, useState, type ReactElement } from "react";
import { PrintPreviewModal, type PrintPreviewRow } from "../../components/scm-v2/PrintPreviewModal";
import { useSoInfoLists, useSoRooms } from "../projects/renovation/customerPropertyApi";
import { projectDatesText } from "../projects/renovation/customerPropertyModel";
import { categoryRooms } from "../../vendor/scm/lib/so-print-rooms";
import type { SoPrintRooms } from "../../vendor/scm/lib/so-print-rooms";
import { useMfgProducts } from "../../vendor/scm/lib/mfg-products-queries";
import { ALL_SO_PDF_COLUMNS, type SoPdfColumns } from "../../vendor/scm/lib/sales-order-pdf";
import { useRenovationCatalog } from "../../vendor/scm/lib/renovation-catalog-queries";
import { SoLinesViewToggle, type SoLinesView } from "./renovationSoAreaLines";

type LineLike = { id: string; item_code: string };

/** The order's rooms, its lines by category, the chosen PDF layout and what the PDF generator needs for it. */
export function useSoPrintLayout(docNo: string | null | undefined, items: readonly LineLike[]) {
  /* Renovation mode (Conts, mig 0112): an order with rooms is shown and printed room by room. */
  const renoMode = useSoInfoLists().data?.ready === true;
  const renoRooms = useSoRooms(docNo ?? undefined, renoMode).data ?? null;
  /* The PDF's own layout (owner, 31 Oct 2026: "export PDF 应该都是 by default by area"). */
  const [printLayout, setPrintLayout] = useState<SoLinesView>("area");
  const [columns, setColumns] = useState<SoPdfColumns>(ALL_SO_PDF_COLUMNS);
  const printRooms: SoPrintRooms | undefined = renoMode && renoRooms && renoRooms.roomSections.length > 0
    ? { order: renoRooms.roomSections, byItem: renoRooms.itemRooms } : undefined;
  /* The printed Start / End date are the linked project's (owner, 15 Oct 2026). The PDF's standard font has no em
     dash (it prints blank), so the print says "-" where the page says "—". */
  const renoDates = renoMode && renoRooms ? projectDatesText(renoRooms.project, "so") : null;
  const pdfText = (t: string) => t.replace(/—/g, "-");
  const printProjectDates = renoDates ? { start: pdfText(renoDates.start), end: pdfText(renoDates.end) } : undefined;
  const catalogQ = useMfgProducts({ enabled: !!printRooms });
  const catalogNames = useRenovationCatalog();
  const categoryView = useMemo(() => {
    if (!printRooms || !catalogQ.data) return undefined;
    const products = new Map(catalogQ.data.map((p) => [p.code, { group: p.category_group || p.category, sub: p.sub_category }]));
    return categoryRooms(items as never, (code) => products.get(code), { groups: catalogNames.groups, subs: catalogNames.all });
  }, [printRooms, catalogQ.data, items, catalogNames.groups, catalogNames.all]);
  /* "By item" prints the plain line list; until the catalog has loaded, "By category" prints by area. */
  const pdfRooms = printLayout === "item" ? undefined : printLayout === "category" ? categoryView ?? printRooms : printRooms;
  return {
    renoMode, renoRooms, renoDates, printRooms, categoryView, printLayout, setPrintLayout, columns, setColumns,
    /** The generator's last argument (generateSalesOrderPdf opts). */
    pdfOpts: { rooms: pdfRooms, projectDates: printProjectDates, columns },
  };
}

const COLUMN_CHOICES: ReadonlyArray<{ key: keyof SoPdfColumns; label: string }> = [
  { key: "qty", label: "Qty" },
  { key: "unit", label: "Unit" },
  { key: "price", label: "Price" },
  { key: "discount", label: "Discount" },
  { key: "amount", label: "Amount" },
];

type PrintLayoutChoices = Pick<ReturnType<typeof useSoPrintLayout>, "printRooms" | "printLayout" | "setPrintLayout" | "columns" | "setColumns">;

function PrintLayoutOptions({ layout }: { layout: PrintLayoutChoices }): ReactElement {
  const optionRow = "flex flex-wrap items-center justify-between gap-x-3 gap-y-2";
  return (
    <div className="space-y-3">
      {layout.printRooms && (
        <div className={optionRow}>
          <span className="text-[12px] font-semibold text-ink-secondary">PDF layout</span>
          <SoLinesViewToggle view={layout.printLayout} onChange={layout.setPrintLayout} />
        </div>
      )}
      <div className={optionRow}>
        <span className="text-[12px] font-semibold text-ink-secondary">Columns</span>
        <span role="group" aria-label="Columns" className="flex flex-wrap gap-x-4 gap-y-1">
          {COLUMN_CHOICES.map(({ key, label }) => (
            <label key={key} className="flex min-h-7 items-center gap-1.5 text-[12.5px] text-ink [@media(pointer:coarse)]:min-h-11">
              <input
                type="checkbox"
                checked={layout.columns[key]}
                onChange={(e) => layout.setColumns({ ...layout.columns, [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </span>
      </div>
    </div>
  );
}

/** The category heading of a contract line for its PDF, as the SO's own By category reads it. */
export function useLineCategory(enabled: boolean): (l: { itemCode?: string | null }) => string | null {
  const catalogQ = useMfgProducts({ enabled });
  const names = useRenovationCatalog();
  return useMemo(() => {
    const products = new Map((catalogQ.data ?? []).map((p) => [p.code, { group: p.category_group || p.category, sub: p.sub_category }]));
    return (l) => {
      if (!l.itemCode) return null;
      return categoryRooms([{ id: "x", item_code: l.itemCode }], (code) => products.get(code), { groups: names.groups, subs: names.all }).byItem.x ?? null;
    };
  }, [catalogQ.data, names.groups, names.all]);
}

/** The SO's Print preview: summary card, the layout picker for an order with rooms, and the three exits. */
export function SoPrintPreview({ open, onClose, docNo, companyName, rows, layout, onViewPdf, onPrint, onDownload, docTitle = "Sales Order" }: {
  /** A quotation prints on this same preview (owner, 17 Nov 2026). */
  docTitle?: string;
  open: boolean;
  companyName?: string;
  onClose: () => void;
  docNo: string;
  rows: PrintPreviewRow[];
  layout: PrintLayoutChoices;
  onViewPdf: () => void | Promise<void>;
  onPrint: () => void | Promise<void>;
  onDownload: () => void | Promise<void>;
}) {
  return (
    <PrintPreviewModal
      open={open}
      onClose={onClose}
      docTitle={docTitle}
      docNo={docNo}
      companyName={companyName}
      rows={rows}
      options={<PrintLayoutOptions layout={layout} />}
      onViewPdf={onViewPdf}
      onPrint={onPrint}
      onDownload={onDownload}
    />
  );
}
