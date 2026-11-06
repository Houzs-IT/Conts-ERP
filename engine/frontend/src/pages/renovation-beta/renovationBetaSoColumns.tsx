/* The sales order's columns on the project list (owner, 5 Nov 2026): every header field of the SO list, hidden until
   picked in Columns, each with its filter. Line fields stay on the SO list: a project row is one project, not one line. */

import type { ReactNode } from "react";
import { fmtDate } from "@2990s/shared";
import type { Column } from "../../components/dataTableTypes";
import { customerRefOf } from "../../lib/customer-ref";
import { resolveSoLocation } from "../../lib/soLocation";
import { money } from "../projects/renovation/renovationModel";
import { soListStatusWord } from "../../vendor/scm/lib/so-line-export-columns";
import { fetchSoExportRows } from "../../vendor/scm/lib/so-list-export";

export type ProjectSo = Parameters<typeof resolveSoLocation>[0] & Parameters<typeof customerRefOf>[0] & {
  doc_no: string; so_date: string | null; debtor_name: string | null; debtor_code: string | null; agent: string | null;
  ac_doc_no?: string | null; ac_agent?: string | null; ac_branding?: string | null; ac_debtor_code?: string | null; ac_venue?: string | null;
  branding: string | null; status: string; currency?: string | null; local_total_sen: number | null;
  balance_sen: number | null; balance_sen_live?: number | null; paid_sen: number | null; paid_total_sen?: number | null; deposit_sen?: number | null;
  phone: string | null; email: string | null; address1: string | null; address2: string | null; city: string | null; postcode: string | null;
  customer_state: string | null; payment_method: string | null; payment_methods_summary?: string; venue: string | null; note: string | null;
  customer_type: string | null; building_type: string | null; customer_country: string | null; do_nos?: string[] | null; stock_remark?: string;
  processing_date?: string | null; customer_delivery_date?: string | null; sales_exemption_expiry?: string | null;
  delivery_state?: "none" | "partial" | "full" | null; lifecycle_state?: "none" | "delivered" | "invoiced" | "returned" | null; on_hold?: boolean | null;
};

export const fetchProjectSos = (): Promise<ProjectSo[]> => fetchSoExportRows<ProjectSo>({});

type Field = { key: string; label: string; group: string; value: (s: ProjectSo) => string | number | null | undefined; kind?: "date" | "money" };
const FIELDS: readonly Field[] = [
  { key: "so_doc_no", label: "SO No.", group: "Basic", value: (s) => s.ac_doc_no ?? s.doc_no },
  { key: "so_date", label: "Date", group: "Basic", value: (s) => s.so_date, kind: "date" },
  { key: "so_reference", label: "Ref No.", group: "Basic", value: (s) => customerRefOf(s) },
  { key: "so_agent", label: "Agent", group: "Basic", value: (s) => s.ac_agent ?? s.agent },
  { key: "so_debtor_name", label: "Debtor Name", group: "Basic", value: (s) => s.debtor_name },
  { key: "so_debtor_code", label: "Debtor Code", group: "Basic", value: (s) => s.ac_debtor_code ?? s.debtor_code },
  { key: "so_branding", label: "Branding", group: "Basic", value: (s) => s.ac_branding ?? s.branding },
  { key: "so_exemption", label: "Sales Exemption Expiry Date", group: "Basic", value: (s) => s.sales_exemption_expiry, kind: "date" },
  { key: "so_status", label: "Status", group: "Basic", value: (s) => soListStatusWord(s.status, s.delivery_state ?? null, s.lifecycle_state ?? null, s.on_hold ?? null) },
  { key: "so_note", label: "Note", group: "Basic", value: (s) => s.note },
  { key: "so_currency", label: "Curr. Code", group: "Amounts", value: (s) => s.currency ?? "MYR" },
  { key: "so_total", label: "Total", group: "Amounts", value: (s) => s.local_total_sen, kind: "money" },
  { key: "so_paid", label: "Paid", group: "Amounts", value: (s) => s.paid_total_sen ?? s.paid_sen, kind: "money" },
  { key: "so_balance", label: "Balance", group: "Amounts", value: (s) => s.balance_sen_live ?? s.balance_sen, kind: "money" },
  { key: "so_deposit", label: "Deposit", group: "Amounts", value: (s) => s.deposit_sen, kind: "money" },
  { key: "so_payment_method", label: "Payment Method", group: "Amounts", value: (s) => s.payment_methods_summary || s.payment_method },
  { key: "so_location", label: "Sales Location", group: "Logistics", value: (s) => resolveSoLocation(s).label },
  { key: "so_do_no", label: "DO No.", group: "Logistics", value: (s) => (s.do_nos ?? []).join(", ") },
  { key: "so_venue", label: "Venue", group: "Logistics", value: (s) => s.ac_venue ?? s.venue },
  { key: "so_stock", label: "Stock Status", group: "Logistics", value: (s) => s.stock_remark },
  { key: "so_processing", label: "Processing Date", group: "Logistics", value: (s) => s.processing_date, kind: "date" },
  { key: "so_delivery", label: "Customer Delivery Date", group: "Logistics", value: (s) => s.customer_delivery_date, kind: "date" },
  { key: "so_phone", label: "Phone", group: "Customer", value: (s) => s.phone },
  { key: "so_email", label: "Email", group: "Customer", value: (s) => s.email },
  { key: "so_address1", label: "Address 1", group: "Customer", value: (s) => s.address1 },
  { key: "so_address2", label: "Address 2", group: "Customer", value: (s) => s.address2 },
  { key: "so_city", label: "City", group: "Customer", value: (s) => s.city },
  { key: "so_postcode", label: "Postcode", group: "Customer", value: (s) => s.postcode },
  { key: "so_state", label: "State", group: "Customer", value: (s) => s.customer_state },
  { key: "so_country", label: "Country", group: "Customer", value: (s) => s.customer_country },
  { key: "so_customer_type", label: "Customer Type", group: "Customer", value: (s) => s.customer_type },
  { key: "so_building_type", label: "Building Type", group: "Customer", value: (s) => s.building_type },
];

export function soColumns<T>(soOf: (row: T) => ProjectSo | undefined): Column<T>[] {
  return FIELDS.map((f) => {
    const read = (row: T): string | number | null => {
      const s = soOf(row);
      return s ? f.value(s) ?? null : null;
    };
    const show = (v: string | number | null): ReactNode => {
      if (v === null || v === "") return "-";
      if (f.kind === "date") return fmtDate(String(v));
      return f.kind === "money" ? money(Number(v)) : v;
    };
    return {
      key: f.key, label: f.label, group: `Sales order: ${f.group}`, width: "140px", defaultHidden: true, align: f.kind === "money" ? "right" : undefined,
      getValue: read, render: (row: T) => <span style={{ fontSize: 12.5 }}>{show(read(row))}</span>,
      ...(f.kind === "date" ? { filterType: "date" as const, dateValue: (row: T) => { const v = read(row); return v === null ? null : String(v); } } : {}),
      ...(f.kind === "money" ? { filterType: "number" as const, numberValue: (row: T) => { const v = read(row); return v === null ? null : Number(v); } } : {}),
    };
  });
}
