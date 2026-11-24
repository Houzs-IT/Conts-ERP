/* A sales order printed from a list (the row's Print, right-click Print Sales Order) opens the same preview as the
   order's own page: the same card lines, the PDF layout picker, the column ticks, the brand and the contract block
   (owner, 24 Nov 2026: the list's preview showed only customer, date and status and printed a plain line list). */

import { useMemo, type ReactElement } from "react";
import { fmtDate, fmtMoneySen } from "@2990s/shared";
import type { PrintPreviewRow } from "../../components/scm-v2/PrintPreviewModal";
import type { PdfAction } from "../../vendor/scm/lib/pdf-common";
import { deriveBalance } from "../../vendor/scm/lib/so-detail-gates";
import { renoGet, useBrands, useContract, type BrandProfile, type ContractView } from "../../lib/renovation/api";
import { pickedSoBrand, soPdfContract } from "./soPdfDownload";
import { SoPrintPreview, useSoPrintLayout } from "./soPrintPreview";

export interface SoPrintBundle {
  header: Record<string, unknown>;
  items: unknown[];
  payments?: unknown[];
  pwpCodes?: unknown[];
}

export type SoPdfRender = (bundle: SoPrintBundle, action: PdfAction) => Promise<void>;

interface PrintableLine { id: string; item_code: string; cancelled?: boolean | null }

const isPrintableLine = (line: unknown): line is PrintableLine =>
  typeof line === "object" && line !== null &&
  typeof (line as { id?: unknown }).id === "string" && typeof (line as { item_code?: unknown }).item_code === "string";

const textOf = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

export function SoListPrintPreview({ docNo, bundle, onClose, run }: {
  docNo: string;
  /** Null while the order is still being read. */
  bundle: SoPrintBundle | null;
  onClose: () => void;
  /** Waits for the order, then draws it with `render`. */
  run: (action: PdfAction, render: SoPdfRender) => Promise<void>;
}): ReactElement {
  const header = bundle?.header;
  const lines = useMemo(() => (bundle?.items ?? []).filter(isPrintableLine), [bundle]);
  const liveLineCount = lines.filter((l) => !l.cancelled).length;
  const layout = useSoPrintLayout(docNo, lines);
  const branding = textOf(header?.branding);
  const currency = textOf(header?.currency) ?? undefined;
  const isRenovation = header?.so_kind === "RENOVATION";
  const brandsQ = useBrands();
  const contractQ = useContract(isRenovation ? docNo : undefined);
  const brands = brandsQ.data?.brands;
  const companyName = brands?.find((b) => b.brandId === contractQ.data?.header.brandId)?.name ?? pickedSoBrand(brands, branding)?.brandName;

  const rows: PrintPreviewRow[] = header
    ? [
        { label: "Customer", value: textOf(header.debtor_name) ?? "—" },
        { label: "Order date", value: fmtDate(textOf(header.so_date)) },
        { label: "Items", value: `${liveLineCount} line${liveLineCount === 1 ? "" : "s"}` },
        { label: "Order total", value: fmtMoneySen(typeof header.local_total_sen === "number" ? header.local_total_sen : null, currency) },
        {
          label: "Balance",
          value: fmtMoneySen(
            deriveBalance(header as Parameters<typeof deriveBalance>[0], bundle.payments as Parameters<typeof deriveBalance>[1]),
            currency,
          ),
        },
      ]
    : [{ value: "Loading document details…" }];

  /* The brands and the contract are read on open; a click before they land reads them here rather than printing
     the order without its letterhead or instalments. */
  const render: SoPdfRender = async (loaded, action) => {
    const brandList = brands ?? (await renoGet<{ brands: BrandProfile[] }>("/brands")).brands;
    const contract = loaded.header.so_kind === "RENOVATION"
      ? contractQ.data ?? (await renoGet<ContractView>(`/sales-orders/${encodeURIComponent(docNo)}`))
      : undefined;
    const { generateSalesOrderPdf } = await import("../../vendor/scm/lib/sales-order-pdf");
    type Args = Parameters<typeof generateSalesOrderPdf>;
    await generateSalesOrderPdf(
      loaded.header as unknown as Args[0], loaded.items as unknown as Args[1], (loaded.payments ?? []) as unknown as Args[2],
      action, (loaded.pwpCodes ?? []) as unknown as Args[4],
      {
        ...layout.pdfOpts,
        contract: soPdfContract(contract, brandList.find((b) => b.brandId === contract?.header.brandId)),
        brand: pickedSoBrand(brandList, textOf(loaded.header.branding)),
      },
    );
  };

  return (
    <SoPrintPreview
      open
      onClose={onClose}
      docNo={docNo}
      companyName={companyName}
      rows={rows}
      layout={layout}
      onViewPdf={() => run("preview", render)}
      onPrint={() => run("print", render)}
      onDownload={() => run("save", render)}
    />
  );
}
