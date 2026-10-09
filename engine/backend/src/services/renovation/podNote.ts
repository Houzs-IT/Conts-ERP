/* Printable delivery / completion note for a renovation project: every site
   receipt (or one, by grnId) with its lines, who signed, where and when, and
   the warehouse deliveries that carry a POD. Plain HTML, A4, print from the
   browser. Every value is escaped. */

import type { EvidenceGroup } from "./pod";
import type { ProjectRow } from "./load";

const esc = (x: unknown): string =>
  String(x ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const when = (x: unknown): string => {
  if (!x) return "";
  const d = new Date(String(x));
  if (Number.isNaN(d.getTime())) return esc(x);
  return d.toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "short" });
};

export interface PodNoteInput {
  project: ProjectRow;
  receipts: Array<Record<string, unknown>>;
  deliveries: Array<Record<string, unknown>>;
  rooms: EvidenceGroup[];
  grnId: string | null;
}

export function renderPodNoteHtml(i: PodNoteInput): string {
  const receipts = i.grnId ? i.receipts.filter((r) => r.id === i.grnId) : i.receipts;
  const p = i.project;
  const blocks = receipts.map((r) => {
    const lines = (Array.isArray(r.lines) ? r.lines : []) as Array<{ item_code?: string; name?: string; qty?: number }>;
    const gps = r.site_lat != null && r.site_lng != null
      ? `${Number(r.site_lat).toFixed(5)}, ${Number(r.site_lng).toFixed(5)}${r.site_accuracy_m != null ? ` (±${Math.round(Number(r.site_accuracy_m))} m)` : ""}`
      : "not captured";
    return `<section class="rcpt">
      <h2>${esc(r.grn_number)} <small>${esc(r.po_number)} &middot; ${esc(r.supplier_name)}</small></h2>
      <table><thead><tr><th>Item</th><th>Description</th><th class="n">Qty received</th></tr></thead><tbody>
      ${lines.map((l) => `<tr><td>${esc(l.item_code)}</td><td>${esc(l.name)}</td><td class="n">${esc(l.qty)}</td></tr>`).join("")}
      </tbody></table>
      <p>Received at the unit: ${when(r.site_received_at)} &middot; Location: ${esc(gps)}</p>
      <p>Site supervisor: ${esc(r.supervisor_name ?? "")} (signed)${r.customer_signer_name ? ` &middot; Customer: ${esc(r.customer_signer_name)} (signed)` : ""}</p>
      ${r.site_notes ? `<p>Notes: ${esc(r.site_notes)}</p>` : ""}
    </section>`;
  });
  const dos = i.grnId ? [] : i.deliveries.map((d) => `<tr><td>${esc(d.do_number)}</td><td>${when(d.delivered_at)}</td><td>${d.signed ? "Signed" : ""}${d.pod_r2_key ? " / photo" : ""}</td></tr>`);
  const rooms = i.grnId ? "" : i.rooms.map((g) => `<li>${esc(g.room)}: ${g.photos.length} photo${g.photos.length === 1 ? "" : "s"}</li>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.code)} delivery and completion note</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  body { font: 12px/1.45 system-ui, sans-serif; color: #111; margin: 0 auto; max-width: 780px; padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 14px; margin: 18px 0 6px; } h2 small { font-weight: normal; color: #555; }
  table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid #ddd; padding: 4px 6px; text-align: left; }
  .n { text-align: right; } .meta { color: #444; } .rcpt { page-break-inside: avoid; }
</style></head><body>
<h1>Delivery and completion note</h1>
<p class="meta">${esc(p.code)} &middot; ${esc(p.name)} &middot; ${esc([p.building, p.unit_no].filter(Boolean).join(" "))} &middot; ${esc(p.customer_name ?? "")}</p>
${blocks.join("") || "<p>No site receipts yet.</p>"}
${dos.length ? `<h2>Delivered from our warehouse</h2><table><thead><tr><th>Delivery order</th><th>Delivered</th><th>Proof</th></tr></thead><tbody>${dos.join("")}</tbody></table>` : ""}
${rooms ? `<h2>Photos by room</h2><ul>${rooms}</ul>` : ""}
</body></html>`;
}
