// Conts only (not part of Houzs's code): renovation contracts signed before the ledger start, seeded at go-live (plan
// 2026-10-30-renovation-revenue-ledger.md Task 8) — reading finance's Excel and talking to
// /accounting/renovation-opening/* (backend/src/acc/reno-opening.ts). One row per contract: its SO, its customer
// account, its advance sub-account and what AutoCount invoiced on it before go-live (RM). Nothing posts.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";
import { readGrid, toSen, type Parsed, type ParsedSheet } from "./opening";

export const RENO_OPENING_COLUMNS = ["SO doc no", "Customer account", "Advance account", "Invoiced before go-live (RM)"] as const;
/** Optional: what AutoCount's project expense record shows spent before go-live (chew, 31 Oct 2026). Blank = not given. */
export const RENO_OPENING_COST_COLUMN = "Cost before go-live (RM)";

export type RenoOpeningRow = { soDocNo: string; debtorCode: string; advanceAccountCode: string; billedBeforeGoLiveSen: number; costBeforeGoLiveSen?: number | null };
/** The server's preview of one row (backend acc/reno-opening RenoOpeningPreviewRow). */
export type RenoOpeningPreviewRow = RenoOpeningRow & {
  problems: string[];
  contractSen: number | null;
  current: { debtorCode: string | null; advanceAccountCode: string | null; billedBeforeGoLiveSen: number; costBeforeGoLiveSen?: number | null } | null;
};

export function parseRenoOpeningGrid(grid: unknown[][]): ParsedSheet<RenoOpeningRow> {
  const g = readGrid(grid, RENO_OPENING_COLUMNS, [RENO_OPENING_COST_COLUMN]);
  const rows: Parsed<RenoOpeningRow>[] = g.rows.map(({ line, cells }) => {
    const sen = toSen(cells["Invoiced before go-live (RM)"]);
    const rawCost = cells[RENO_OPENING_COST_COLUMN];
    const costBlank = rawCost == null || String(rawCost).trim() === "";
    const cost = costBlank ? null : toSen(rawCost);
    const value = {
      soDocNo: String(cells["SO doc no"] ?? "").trim(),
      debtorCode: String(cells["Customer account"] ?? "").trim(),
      advanceAccountCode: String(cells["Advance account"] ?? "").trim(),
      billedBeforeGoLiveSen: sen ?? 0,
      costBeforeGoLiveSen: cost,
    };
    const error = !value.soDocNo ? "No SO doc no." : !value.debtorCode ? "No customer account."
      : !value.advanceAccountCode ? "No advance account." : sen == null ? "The amount is not a plain RM figure."
      : !costBlank && cost == null ? "The cost before go-live is not a plain RM figure." : null;
    return { line, value, error };
  });
  return { rows, error: g.error };
}

/** An empty workbook with the sheet's columns. */
export function downloadRenoOpeningTemplate(): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...RENO_OPENING_COLUMNS, RENO_OPENING_COST_COLUMN]]), "Renovation");
  XLSX.writeFile(wb, "renovation-contracts-at-go-live.xlsx");
}

export const useRenoOpeningPreview = () => useMutation({
  mutationFn: (rows: RenoOpeningRow[]) =>
    authedFetch<{ ok: true; rows: RenoOpeningPreviewRow[] }>("/accounting/renovation-opening/preview", { method: "POST", body: JSON.stringify({ rows }) }),
});

/** Apply writes the contracts' accounts; the contract screens read again. */
export const useRenoOpeningApply = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: RenoOpeningRow[]) =>
      authedFetch<{ ok: true; applied: number }>("/accounting/renovation-opening/apply", { method: "POST", body: JSON.stringify({ rows }) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["reno"] }); },
  });
};
