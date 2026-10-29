// Conts only (not part of Houzs's code): a float's receipts as an Excel sheet (finance, chew 28 Oct 2026: "按月份筛选和导出 Excel").
// One row per receipt line, so a receipt split across a unit and a project keeps both; amounts in ringgit as numbers.
import { DEPARTMENT, RECEIPT_STATUS, type Receipt } from "./claimsQueries";

export const PETTY_CASH_HEADER = ["Date", "Receipt no.", "Handed in by", "Shop", "Description", "Department", "Unit / job / project", "Account", "Amount (RM)", "Status", "Receipts"];

export function pettyCashRows(receipts: Receipt[], names: { unit?: (id: string) => string; project?: (id: number) => string } = {}): (string | number)[][] {
  const rows: (string | number)[][] = [PETTY_CASH_HEADER];
  for (const r of receipts) {
    for (const l of r.lines) {
      const where = [
        l.unitId ? names.unit?.(l.unitId) ?? l.unitId : "",
        l.maintenanceIssueId ? "Maintenance job" : "",
        l.projectId != null ? names.project?.(l.projectId) ?? `Project ${l.projectId}` : "",
      ].filter(Boolean).join(" · ");
      rows.push([
        r.spendDate, r.receiptNo, r.submitterName, r.vendorName ?? "", l.description ?? r.note ?? "", DEPARTMENT[l.department], where,
        l.accountCode ?? "", Math.round(l.amountSen) / 100, RECEIPT_STATUS[r.status], r.files.length,
      ]);
    }
  }
  return rows;
}

export async function exportPettyCash(floatName: string, month: string, receipts: Receipt[], names?: Parameters<typeof pettyCashRows>[1]): Promise<void> {
  const XLSX = await import("../lib/xlsx-runtime");
  const ws = XLSX.utils.aoa_to_sheet(pettyCashRows(receipts, names));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Petty cash");
  XLSX.writeFileXLSX(wb, `Petty cash ${floatName} ${month || "all"}.xlsx`.replace(/[\\/:*?"<>|]/g, "-"));
}
