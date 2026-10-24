/* One status wording for a delivery order on every screen (owner live check, 24 Oct 2026): the DO list, the DO
   detail (header pill, Delivery status card, Key dates) and the Beta workspace DO tab all said different things for
   the same row ("Confirmed" / "Ready to dispatch" / "Loaded"). Every one of them now reads the stored status through
   the shared DO status map (status-pill.ts), the words the DO list uses, so DELIVERED reads "Delivered" everywhere.
   Invoiced / Returned still win when a later document says so (computed lifecycle, not the stored status). */
import { statusLabel } from "../../vendor/scm/lib/status-pill";

export type DoStatusTone = "success" | "warning" | "error" | "neutral";

const DONE = new Set(["SIGNED", "DELIVERED"]);

export function doStatusWords(
  status: string | null | undefined,
  lifecycle?: string | null,
): { label: string; tone: DoStatusTone; delivered: boolean } {
  const s = String(status ?? "").trim().toUpperCase();
  if (s === "CANCELLED") return { label: statusLabel("do", s), tone: "error", delivered: false };
  if (s === "DRAFT") return { label: statusLabel("do", s), tone: "warning", delivered: false };
  if (lifecycle === "returned") return { label: "Returned", tone: "error", delivered: true };
  if (lifecycle === "invoiced" || s === "INVOICED") return { label: "Invoiced", tone: "success", delivered: true };
  if (DONE.has(s)) return { label: statusLabel("do", s), tone: "success", delivered: s === "DELIVERED" };
  return { label: statusLabel("do", s), tone: "warning", delivered: false };
}

/** The day a delivery arrived: the date the office or driver recorded, else the delivered moment. */
export function doDeliveredDay(h: { customer_delivered_date?: string | null; delivered_at?: string | null }): string | null {
  if (h.customer_delivered_date) return String(h.customer_delivered_date).slice(0, 10);
  if (!h.delivered_at) return null;
  return new Date(new Date(h.delivered_at).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}
