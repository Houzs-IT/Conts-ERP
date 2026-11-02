// Conts only (not part of Houzs's code): opening deposits by project or unit (chew 2 Nov 2026; plan
// 2026-11-02-renovation-close-out.md Task 2) — reading finance's Excel and talking to /accounting/opening/deposits
// (backend acc/opening-deposits.ts). One row per deposit still out at go-live, on its 330 account, by project code or
// by building and unit. The journal tags them without moving any account's total.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";
import { invalidateOpening, readGrid, toSen, type Parsed, type ParsedSheet } from "./opening";

export const OPENING_DEPOSIT_COLUMNS = ["Account", "Project code", "Building", "Unit", "Amount (RM)", "Paid to"] as const;

export type OpeningDepositRow = {
  accountCode: string; projectCode: string | null; building: string | null; unitNumber: string | null; amountSen: number; paidTo: string | null;
};
export type DepositProblem = { row: number; problem: string };
export type OpeningDepositsResult = { ok: true; dryRun?: boolean; jeNo?: string; rows: number; totalSen: number };

const blankToNull = (v: unknown): string | null => { const s = String(v ?? "").trim(); return s ? s : null; };

export function parseOpeningDepositsGrid(grid: unknown[][]): ParsedSheet<OpeningDepositRow> {
  const g = readGrid(grid, OPENING_DEPOSIT_COLUMNS, ["Project code", "Building", "Unit", "Paid to"]);
  const rows: Parsed<OpeningDepositRow>[] = g.rows.map(({ line, cells }) => {
    const sen = toSen(cells["Amount (RM)"]);
    const value: OpeningDepositRow = {
      accountCode: String(cells["Account"] ?? "").trim(),
      projectCode: blankToNull(cells["Project code"]),
      building: blankToNull(cells["Building"]),
      unitNumber: blankToNull(cells["Unit"]),
      amountSen: sen ?? 0,
      paidTo: blankToNull(cells["Paid to"]),
    };
    const hasUnit = !!value.building || !!value.unitNumber;
    const error = !value.accountCode ? "No account."
      : sen == null || sen <= 0 ? "The amount is not a plain RM figure."
      : value.projectCode && hasUnit ? "Name a project code or a unit, not both."
      : !value.projectCode && !(value.building && value.unitNumber) ? "Name a project code or a unit (building and unit)."
      : null;
    return { line, value, error };
  });
  return { rows, error: g.error };
}

/** An empty workbook with the sheet's columns. */
export function downloadOpeningDepositsTemplate(): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...OPENING_DEPOSIT_COLUMNS]]), "Deposits");
  XLSX.writeFile(wb, "opening-deposits.xlsx");
}

/** The server's problems, from a refused call's body (409). */
export function refusedProblems(e: unknown): DepositProblem[] | null {
  const body = (e as { body?: unknown } | null)?.body;
  if (typeof body !== "string") return null;
  try {
    const parsed = JSON.parse(body) as { problems?: unknown };
    return Array.isArray(parsed.problems) ? (parsed.problems as DepositProblem[]) : null;
  } catch {
    return null;
  }
}

export const useOpeningDeposits = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rows: OpeningDepositRow[]; dryRun: boolean }) =>
      authedFetch<OpeningDepositsResult>("/accounting/opening/deposits", { method: "POST", body: JSON.stringify(v) }),
    onSuccess: (r) => { if (!r.dryRun) invalidateOpening(qc); },
  });
};
export const useReverseOpeningDeposits = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => authedFetch<{ ok: true; jeNo: string }>("/accounting/opening/deposits/reverse", { method: "POST" }),
    onSuccess: () => invalidateOpening(qc),
  });
};
