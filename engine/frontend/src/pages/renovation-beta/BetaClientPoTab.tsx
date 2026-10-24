/* Beta workspace > Client PO (owner, 24 Oct 2026): every line the client buys themselves, which is every SO line
   whose SKU's supplier is "Customer" (the CUS-* SKUs) or that is marked supplied by the owner, plus such lines on a VO
   not on the SO yet. Grouped by category and sub-category, or by area. Each line shows its SKU, the photos uploaded
   on the order line and the SKU's catalog photos; the client link shows the same photos. The client gets the list as a PDF or as a read-only link (Preview, Send by WhatsApp). */

import { useMemo, useState, type ReactElement } from "react";
import { Download, ExternalLink, Send } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { SoLinePhotoStrip } from "../../components/scm-v2/SoLinePhotoStrip";
import { resolveApiAssetUrl } from "../../components/scm-v2/PhotoGallery";
import { PlainPhotoStrip } from "./BetaClientPhotos";
import { errorText } from "../projects/renovation/renovationModel";
import { TONE_WAIT, WS, WsBadge, WsEmpty, WsFilterPill, WsPageHead, btnStyle } from "./BetaWsUi";
import { WsNarrow, WsNarrowStyle, WsTable, metaStyle, narrowBandStyle, narrowItemStyle, numStyle, tdStyle, thStyle } from "./BetaVoPoUi";
import type { BetaTabProps } from "./betaShared";
import { downloadClientPdf } from "./renovationBetaClientPdf";
import { whatsappLink } from "./renovationBetaModel";
import { BETA } from "./renovationBetaTheme";
import { byArea, byCategory, clientLinkUrl, skuPhotoPath, voPoApi, type ClientItem } from "./renovationBetaVoPo";

/** The line's photos (uploaded on the order line, carried to its PO) and the SKU's catalog photos, as the client link shows them. */
function LinePhotos({ i }: { i: ClientItem }): ReactElement {
  const line = i.soItemId && i.soDocNo && (i.photoKeys?.length ?? 0) > 0;
  const sku = (i.skuPhotos ?? []).map((ph) => ({
    thumb: resolveApiAssetUrl(skuPhotoPath(ph.productId, ph.thumbKey ?? ph.key)),
    full: resolveApiAssetUrl(skuPhotoPath(ph.productId, ph.key)),
    label: `SKU photo of ${i.itemCode ?? i.description}`,
  }));
  if (!line && sku.length === 0) return <span style={metaStyle}>None</span>;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      {line && <SoLinePhotoStrip source="so" docId={i.soDocNo ?? ""} itemId={i.soItemId ?? ""} photoKeys={i.photoKeys ?? []} edit={null} />}
      {sku.length > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={metaStyle}>SKU</span><PlainPhotoStrip photos={sku} label={`SKU photos of ${i.description || i.itemCode || "item"}`} /></span>}
    </span>
  );
}

type View = "category" | "area";

export function BetaClientPoTab(p: BetaTabProps): ReactElement {
  const q = useQuery(["renovation-beta", "client-po", p.projectId], () => voPoApi.clientPo(p.projectId), [p.projectId]);
  const [view, setView] = useState<View>("category");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const items = q.data?.items ?? [];
  const groups = useMemo(() => (view === "category"
    ? byCategory(items).map((c) => ({ key: c.key, label: c.label, subs: c.subs }))
    : byArea(items).map((a) => ({ key: a.key, label: a.label, subs: [{ key: `${a.key}/all`, label: "", items: a.items }] }))), [items, view]);

  if (q.error) return <p role="alert" style={{ fontSize: 14, color: WS.red }}>The client items could not be loaded: {q.error}</p>;
  if (!q.data) return <p style={{ padding: "40px 0", textAlign: "center", fontSize: 14, color: BETA.muted }}>Loading Client PO...</p>;

  const project = p.detail.project;
  async function getLink(): Promise<string | null> {
    if (link) return link;
    setBusy(true);
    try {
      const r = await voPoApi.clientLink(p.projectId);
      const url = clientLinkUrl(window.location.origin, r.token);
      setLink(url);
      return url;
    } catch (e) {
      p.onError(errorText(e));
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function preview(): Promise<void> {
    const w = window.open("", "_blank");
    const url = await getLink();
    if (url && w) w.location.href = url; else w?.close();
  }
  async function send(): Promise<void> {
    const w = window.open("", "_blank");
    const url = await getLink();
    if (!url) { w?.close(); return; }
    const text = `Hi${project.customer_name ? ` ${project.customer_name}` : ""}, here is the list of items to buy for ${project.name}: ${url}`;
    const wa = whatsappLink(project.customer_phone, text);
    if (w) w.location.href = wa; else window.location.href = wa;
  }
  async function pdf(): Promise<void> {
    try { await downloadClientPdf({ projectName: project.name, clientName: project.customer_name ?? null, items, today: p.today }); }
    catch (e) { p.onError(errorText(e)); }
  }

  return (
    <>
      <WsNarrowStyle />
      <WsPageHead
        title="Client PO"
        sub={`What the client buys: ${items.length} item${items.length === 1 ? "" : "s"}. Lines with supplier "Customer" come here by themselves.`}
        right={
          <span style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" style={btnStyle("outline", "md")} disabled={items.length === 0} onClick={() => void pdf()}><Download size={15} aria-hidden="true" />Client PDF</button>
            {p.canWrite && <button type="button" style={btnStyle("outline", "md")} disabled={busy || items.length === 0} onClick={() => void preview()}><ExternalLink size={15} aria-hidden="true" />Preview link</button>}
            {p.canWrite && <button type="button" style={btnStyle("teal", "md")} disabled={busy || items.length === 0} onClick={() => void send()}><Send size={15} aria-hidden="true" />Send link to client</button>}
          </span>
        }
      />
      {link && <p style={{ ...metaStyle, overflowWrap: "anywhere" }}>Client link (read only, valid 120 days): <a href={link} target="_blank" rel="noreferrer">{link}</a></p>}

      <div role="group" aria-label="Group by" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <WsFilterPill on={view === "category"} onClick={() => setView("category")}>By category</WsFilterPill>
        <WsFilterPill on={view === "area"} onClick={() => setView("area")}>By area</WsFilterPill>
      </div>

      {items.length === 0 ? <WsEmpty>Nothing for the client to buy yet. Lines whose SKU supplier is "Customer" show here.</WsEmpty> : (
        <WsTable minWidth={760} label="Client items">
          <thead>
            <tr>
              <th style={thStyle}>Item</th>
              <th style={thStyle}>SKU</th>
              <th style={thStyle}>{view === "category" ? "Area" : "Category"}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Qty</th>
              <th style={thStyle}>Photos</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => [
              <tr key={g.key}><td colSpan={5} style={{ padding: "8px 10px", background: "#E1F1EE", borderLeft: `4px solid ${BETA.accent}`, color: BETA.accentInk, fontWeight: 700, fontSize: 15 }}>{g.label}</td></tr>,
              ...g.subs.flatMap((s) => [
                ...(s.label ? [<tr key={s.key}><td colSpan={5} style={{ padding: "6px 10px 6px 28px", background: "#F3F9F8", borderLeft: "4px solid #A9CFCB", color: WS.text2, fontWeight: 600 }}>{s.label}</td></tr>] : []),
                ...s.items.map((i) => <ItemRow key={i.key} i={i} view={view} />),
              ]),
            ])}
          </tbody>
        </WsTable>
      )}
      {items.length > 0 && (
        <WsNarrow label="Client items">
          {groups.map((g) => (
            <li key={g.key}>
              <div style={narrowBandStyle("cat")}>{g.label}</div>
              {g.subs.map((s) => (
                <div key={s.key}>
                  {s.label && <div style={narrowBandStyle("sub")}>{s.label}</div>}
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {s.items.map((i) => (
                      <li key={i.key} style={narrowItemStyle}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontWeight: 600 }}>{i.description || "-"}</span>
                          <span style={{ whiteSpace: "nowrap" }}>{i.measure ?? `${i.qty}${i.uom ? ` ${i.uom}` : ""}`}</span>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, ...metaStyle }}>
                          <span style={{ fontFamily: "ui-monospace, monospace" }}>{i.itemCode ?? "-"}</span>
                          <span>{view === "category" ? (i.area ?? "No area") : `${i.categoryLabel} · ${i.subLabel}`}</span>
                          {i.pending && <span>Not confirmed yet</span>}
                        </div>
                        {((i.photoKeys?.length ?? 0) > 0 || (i.skuPhotos?.length ?? 0) > 0) && <LinePhotos i={i} />}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </li>
          ))}
        </WsNarrow>
      )}
    </>
  );
}

function ItemRow({ i, view }: { i: ClientItem; view: View }): ReactElement {
  return (
    <tr>
      <td style={{ ...tdStyle, paddingLeft: 40 }}>
        {i.description || "-"}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
          {i.voNo && <span style={metaStyle}>From {i.voNo}</span>}
          {i.pending && <WsBadge tone={TONE_WAIT} size={11}>VO not approved yet</WsBadge>}
        </div>
      </td>
      <td style={{ ...tdStyle, whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace", fontSize: 13 }}>{i.itemCode ?? "-"}</td>
      <td style={tdStyle}>{view === "category" ? (i.area ?? "-") : `${i.categoryLabel} · ${i.subLabel}`}</td>
      <td style={numStyle}>{i.measure ?? `${i.qty}${i.uom ? ` ${i.uom}` : ""}`}</td>
      <td style={tdStyle}>
        <LinePhotos i={i} />
      </td>
    </tr>
  );
}
