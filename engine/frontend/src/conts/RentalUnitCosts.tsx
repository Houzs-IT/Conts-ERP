// Conts only (not part of Houzs's code): Rental costs by unit — /scm/rental-unit-costs (finance, chew 2 Nov 2026:
// answer A, the unit stays on the finance side; SOP 3.2; plan 2026-11-02-voucher-purpose Task 4; backend
// acc/rental-unit-costs.ts). What the company paid for each unit through vouchers, by account. Owner charges are on
// the owner statement in Property OS, not here.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/Layout";
import { DataTable, type Column } from "../components/DataTable";
import { DateField } from "../vendor/scm/components/DateField";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";

type Result = {
  from: string; to: string;
  rows: Array<{ unitId: string; building: string; unitNumber: string; byAccount: Record<string, number>; totalSen: number; subDepartments?: string[] }>;
  noUnitSen: number; noUnitByAccount: Record<string, number>;
  accounts: Array<{ code: string; name: string }>;
};
type Row = { key: string; building: string; unitNumber: string; byAccount: Record<string, number>; totalSen: number; noUnit?: boolean; subDepartments: string[] };

const MUTED = "var(--fg-muted)";
const num: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };
const myt = (): string => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
const monthStart = (d: string): string => `${d.slice(0, 7)}-01`;
const rm = (sen: number): string => {
  const s = new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(sen) / 100);
  return sen < 0 ? `(${s})` : s;
};

/** The table's rows: one per unit, then Rental's cost that names no unit. Exported for the test. */
export function costRows(r: Result): Row[] {
  const rows: Row[] = r.rows.map((u) => ({ key: u.unitId, building: u.building, unitNumber: u.unitNumber, byAccount: u.byAccount, totalSen: u.totalSen, subDepartments: u.subDepartments ?? [] }));
  if (r.noUnitSen !== 0) rows.push({ key: "no-unit", building: "No unit", unitNumber: "Rental's general cost", byAccount: r.noUnitByAccount, totalSen: r.noUnitSen, noUnit: true, subDepartments: [] });
  return rows;
}

export function RentalUnitCosts() {
  const [from, setFrom] = useState(monthStart(myt()));
  const [to, setTo] = useState(myt());
  const q = useQuery({
    queryKey: ["conts-rental-unit-costs", from, to],
    queryFn: () => authedFetch<Result>(`/accounting/rental-unit-costs?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    enabled: from <= to,
    staleTime: 60_000,
  });
  const rows = useMemo(() => (q.data ? costRows(q.data) : null), [q.data]);
  const totalSen = (q.data?.rows ?? []).reduce((s, r) => s + r.totalSen, 0) + (q.data?.noUnitSen ?? 0);
  const columns = useMemo<Column<Row>[]>(() => [
    { key: "building", label: "Building", render: (r) => <span style={{ color: r.noUnit ? MUTED : undefined }}>{r.building}</span>, getValue: (r) => r.building },
    { key: "unit", label: "Unit", render: (r) => <span style={{ fontWeight: r.noUnit ? 400 : 600, color: r.noUnit ? MUTED : undefined }}>{r.unitNumber}</span>, getValue: (r) => r.unitNumber },
    /* SOP 1.1: which sub-departments spent on the unit — the same money as Spending by department, seen by unit. */
    { key: "subs", label: "Departments", render: (r) => (r.subDepartments.length ? r.subDepartments.join(", ") : <span style={{ color: MUTED }}>–</span>), getValue: (r) => r.subDepartments.join(", ") },
    ...(q.data?.accounts ?? []).map((a): Column<Row> => ({
      key: `acc-${a.code}`, label: `${a.name || a.code} (RM)`, align: "right",
      render: (r) => (r.byAccount[a.code] ? <span style={num}>{rm(r.byAccount[a.code]!)}</span> : <span style={{ color: MUTED }}>–</span>),
      getValue: (r) => r.byAccount[a.code] ?? 0, exportValue: (r) => (r.byAccount[a.code] ?? 0) / 100, exportFormat: "money",
    })),
    {
      key: "total", label: "Total (RM)", align: "right",
      render: (r) => <span style={{ ...num, fontWeight: 700 }}>{rm(r.totalSen)}</span>, getValue: (r) => r.totalSen,
      exportValue: (r) => r.totalSen / 100, exportFormat: "money",
    },
  ], [q.data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <PageHeader
        eyebrow="Finance"
        title="Rental unit costs"
        description="What the company paid for each unit through vouchers. Owner charges are on the owner statement."
        actions={(
          <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <label className={styles.field} style={{ minWidth: 150 }}>
              <span className={styles.fieldLabel}>From</span>
              <DateField value={from} onChange={(v) => v && setFrom(v)} aria-label="From" className={styles.fieldInput} />
            </label>
            <label className={styles.field} style={{ minWidth: 150 }}>
              <span className={styles.fieldLabel}>To</span>
              <DateField value={to} onChange={(v) => v && setTo(v)} aria-label="To" className={styles.fieldInput} />
            </label>
          </div>
        )}
      />
      {q.data && (
        <p style={{ margin: 0, fontSize: "var(--fs-13)" }}>
          Rental cost paid <b style={num}>RM {rm(totalSen)}</b> — {q.data.rows.length} unit{q.data.rows.length === 1 ? "" : "s"}
          {q.data.noUnitSen !== 0 && <>, RM <span style={num}>{rm(q.data.noUnitSen)}</span> with no unit</>}.
        </p>
      )}
      <DataTable<Row>
        tableId="conts-rental-unit-costs"
        exportName={`rental-unit-costs-${from}-to-${to}`}
        exportXlsx
        columns={columns}
        rows={rows}
        loading={q.isLoading}
        error={from > to ? "The start date is after the end date." : q.isError ? "The costs did not load." : null}
        emptyLabel="No Rental cost in this range."
        getRowKey={(r) => r.key}
        clientSearch={{ placeholder: "Building or unit" }}
      />
      <p style={{ margin: 0, fontSize: "var(--fs-12)", color: MUTED }}>
        Rental department expense lines as the books count them. A voucher line names its unit when it is for Rental; lines from before 2 Nov 2026 have none.
      </p>
    </div>
  );
}
