/* Beta workspace > Client PO (owner, 24 Oct 2026): every line the client buys themselves, which is every SO line
   whose SKU's supplier is "Customer" (the CUS-* SKUs) or that is marked supplied by the owner, plus such lines on a VO
   not on the SO yet. Grouped by category and sub-category, or by area.

   The PO tab's twin (owner, 24 Oct 2026): the same columns, read from the same places. Processing and delivery dates
   are the line's dates as the PO tab shows them (set there, in Edit), GR and DO are the documents that carried the
   line (BetaLineDocs.tsx). The share panel gives the client the list as a PDF or as a read-only link (Preview, Copy,
   WhatsApp); the client sees the items, quantities, dates and photos, never prices or suppliers. */

import { useMemo, useState, type ReactElement } from "react";
import { Check, Copy, Download, ExternalLink, Send } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { LinePhotoThumbs, photoCount } from "./BetaLinePhotos";
import { DocCell, useOpenDoc } from "./BetaLineDocs";
import { errorText } from "../projects/renovation/renovationModel";
import { TONE_WAIT, WS, WsBadge, WsEmpty, WsFilterPill, WsPageHead, btnStyle, cardStyle } from "./BetaWsUi";
import { WsNarrow, WsNarrowStyle, WsTable, metaStyle, narrowBandStyle, narrowItemStyle, numStyle, tdStyle, thStyle } from "./BetaVoPoUi";
import type { BetaTabProps } from "./betaShared";
import { downloadClientPdf } from "./renovationBetaClientPdf";
import { lineDocs, type LineDoc } from "./renovationBetaDocsModel";
import { lineDates, lineLate, linesApi, type ManagedLine } from "./renovationBetaLines";
import { dayMonthYear, whatsappLink } from "./renovationBetaModel";
import { betaSiteApi, type SiteDelivery } from "./renovationBetaSiteApi";
import { BETA, TONES } from "./renovationBetaTheme";
import { byArea, byCategory, clientLinkUrl, voPoApi, type ClientItem } from "./renovationBetaVoPo";

/** The line's photos (uploaded on the order line, carried to its PO) and the SKU's catalog photos, as the client link
    shows them: up to three, then "+N" (BetaLinePhotos.tsx, shared with the PO tab). */
function LinePhotos({ i }: { i: ClientItem }): ReactElement {
  const set = {
    so: i.soItemId && i.soDocNo && (i.photoKeys?.length ?? 0) > 0 ? { docNo: i.soDocNo, itemId: i.soItemId, keys: i.photoKeys ?? [] } : null,
    po: [],
    sku: i.skuPhotos ?? [],
  };
  if (photoCount(set) === 0) return <span style={metaStyle}>None</span>;
  return <LinePhotoThumbs photos={set} label={i.description || i.itemCode || "item"} />;
}

type View = "category" | "area";

/** One client item with what the PO tab knows of the same SO line. */
interface Row {
  i: ClientItem;
  orderOn: string | null;
  deliverOn: string | null;
  late: "order" | "deliver" | null;
  doState: "yes" | "part" | "no" | null;
  grDocs: LineDoc[];
  doDocs: LineDoc[];
}

function rowOf(i: ClientItem, byId: ReadonlyMap<string, ManagedLine>, deliveries: readonly SiteDelivery[], today: string): Row {
  const l = i.soItemId ? byId.get(i.soItemId) : undefined;
  const d = l ? lineDates(l) : { orderOn: i.orderOn ?? null, deliverOn: i.deliverOn ?? null };
  return {
    i, orderOn: d.orderOn, deliverOn: d.deliverOn, late: l ? lineLate(l, today) : null, doState: l ? l.do : null,
    grDocs: i.soItemId ? lineDocs(i.soItemId, deliveries, "goods_received") : [],
    doDocs: i.soItemId ? lineDocs(i.soItemId, deliveries, "delivery_order") : [],
  };
}

const qtyText = (i: ClientItem): string => i.measure ?? `${i.qty}${i.uom ? ` ${i.uom}` : ""}`;

function DateText({ value, late }: { value: string | null; late: boolean }): ReactElement {
  return <span style={{ fontSize: 13, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", ...(late ? { color: WS.red, fontWeight: 600 } : value ? {} : { color: BETA.muted }) }}>{value ? dayMonthYear(value) : "Not set"}</span>;
}

export function BetaClientPoTab(p: BetaTabProps): ReactElement {
  const q = useQuery(["renovation-beta", "client-po", p.projectId], () => voPoApi.clientPo(p.projectId), [p.projectId]);
  const lines = useQuery(["renovation-beta", "lines", p.projectId], () => linesApi.lines(p.projectId), [p.projectId]);
  const site = useQuery(["renovation-beta", "site", p.projectId], () => betaSiteApi.site(p.projectId), [p.projectId]);
  const openDoc = useOpenDoc();
  const [view, setView] = useState<View>("category");
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const rows = useMemo(() => {
    const byId = new Map((lines.data?.lines ?? []).map((l) => [l.id, l] as const));
    return new Map(items.map((i) => [i.key, rowOf(i, byId, site.data?.deliveries ?? [], p.today)] as const));
  }, [items, lines.data, site.data, p.today]);
  const groups = useMemo(() => (view === "category"
    ? byCategory(items).map((c) => ({ key: c.key, label: c.label, subs: c.subs }))
    : byArea(items).map((a) => ({ key: a.key, label: a.label, subs: [{ key: `${a.key}/all`, label: "", items: a.items }] }))), [items, view]);

  if (q.error) return <p role="alert" style={{ fontSize: 14, color: WS.red }}>The client items could not be loaded: {q.error}</p>;
  if (!q.data) return <p style={{ padding: "40px 0", textAlign: "center", fontSize: 14, color: BETA.muted }}>Loading Client PO...</p>;

  const dated = [...rows.values()].filter((r) => r.orderOn && r.deliverOn).length;
  const COLS = 9;
  return (
    <>
      <WsNarrowStyle />
      <WsPageHead
        title="Client PO"
        sub={`What the client buys: ${items.length} item${items.length === 1 ? "" : "s"}, ${dated} with both dates set. Lines with supplier "Customer" come here by themselves; their dates are set in the PO tab.`}
      />
      {q.data.categoryRestricted && <p style={{ margin: 0, fontSize: 13, color: BETA.muted }}>Some categories are hidden for your role.</p>}
      {q.data.categoryRestricted
        ? <p style={{ margin: 0, fontSize: 13, color: BETA.muted }}>Sharing with the client is not available for a role limited to some categories.</p>
        : <SharePanel p={p} rows={[...rows.values()]} />}

      <div role="group" aria-label="Group by" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <WsFilterPill on={view === "category"} onClick={() => setView("category")}>By category</WsFilterPill>
        <WsFilterPill on={view === "area"} onClick={() => setView("area")}>By area</WsFilterPill>
      </div>

      {items.length === 0 ? <WsEmpty>Nothing for the client to buy yet. Lines whose SKU supplier is "Customer" show here.</WsEmpty> : (
        <WsTable minWidth={980} label="Client items">
          <thead>
            <tr>
              <th style={thStyle}>Item</th>
              <th style={thStyle}>SKU</th>
              <th style={thStyle}>{view === "category" ? "Area" : "Category"}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Qty</th>
              <th style={thStyle} title="Processing date: when the client should buy it">Processing</th>
              <th style={thStyle} title="Delivery date: when it should reach the site">Delivery</th>
              <th style={thStyle}>GR</th>
              <th style={thStyle}>DO</th>
              <th style={thStyle}>Photos</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => [
              <tr key={g.key}><td colSpan={COLS} style={{ padding: "8px 10px", background: TONES.accent.soft, borderLeft: `4px solid ${BETA.accent}`, color: BETA.accentInk, fontWeight: 700, fontSize: 15 }}>{g.label}</td></tr>,
              ...g.subs.flatMap((s) => [
                ...(s.label ? [<tr key={s.key}><td colSpan={COLS} style={{ padding: "6px 10px 6px 28px", background: BETA.tealSoft, borderLeft: `4px solid ${TONES.accent.line}`, color: WS.text2, fontWeight: 600 }}>{s.label}</td></tr>] : []),
                ...s.items.map((i) => {
                  const r = rows.get(i.key);
                  return r ? <ItemRow key={i.key} r={r} view={view} openDoc={openDoc} /> : null;
                }),
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
                    {s.items.map((i) => {
                      const r = rows.get(i.key);
                      if (!r) return null;
                      const field = (label: string, child: ReactElement): ReactElement => (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}><span style={metaStyle}>{label}</span>{child}</div>
                      );
                      return (
                        <li key={i.key} style={{ ...narrowItemStyle, gap: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontWeight: 600 }}>{i.description || "-"}</span>
                            <span style={{ whiteSpace: "nowrap" }}>{qtyText(i)}</span>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, ...metaStyle }}>
                            <span style={{ fontFamily: "ui-monospace, monospace" }}>{i.itemCode ?? "-"}</span>
                            <span>{view === "category" ? (i.area ?? "No area") : `${i.categoryLabel} · ${i.subLabel}`}</span>
                            {i.pending && <span>Not confirmed yet</span>}
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                            {field("Processing", <DateText value={r.orderOn} late={r.late === "order"} />)}
                            {field("Delivery", <DateText value={r.deliverOn} late={r.late === "deliver"} />)}
                            {field("GR", <DocCell docs={r.grDocs} state={null} tab="gr" open={openDoc} />)}
                            {field("DO", <DocCell docs={r.doDocs} state={r.doState} tab="do" open={openDoc} />)}
                          </div>
                          {((i.photoKeys?.length ?? 0) > 0 || (i.skuPhotos?.length ?? 0) > 0) && <LinePhotos i={i} />}
                        </li>
                      );
                    })}
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

function ItemRow({ r, view, openDoc }: { r: Row; view: View; openDoc: ReturnType<typeof useOpenDoc> }): ReactElement {
  const i = r.i;
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
      <td style={numStyle}>{qtyText(i)}</td>
      <td style={tdStyle}><DateText value={r.orderOn} late={r.late === "order"} /></td>
      <td style={tdStyle}><DateText value={r.deliverOn} late={r.late === "deliver"} /></td>
      <td style={{ ...tdStyle, maxWidth: 150 }}><DocCell docs={r.grDocs} state={null} tab="gr" open={openDoc} /></td>
      <td style={{ ...tdStyle, maxWidth: 150 }}><DocCell docs={r.doDocs} state={r.doState} tab="do" open={openDoc} /></td>
      <td style={tdStyle}><LinePhotos i={i} /></td>
    </tr>
  );
}

/* ---------- sharing with the client ---------- */

/** The client's copy of the list: a PDF to download, or a read-only link to preview, copy or send on WhatsApp. The
    link is made once per visit and lasts 120 days (routes/renovationBeta.ts client-link). */
function SharePanel({ p, rows }: { p: BetaTabProps; rows: readonly Row[] }): ReactElement {
  const [link, setLink] = useState<{ url: string; until: string } | null>(null);
  const [busy, setBusy] = useState<"link" | "pdf" | null>(null);
  const [copied, setCopied] = useState(false);
  const project = p.detail.project;
  const none = rows.length === 0;

  async function getLink(): Promise<string | null> {
    if (link) return link.url;
    setBusy("link");
    try {
      const r = await voPoApi.clientLink(p.projectId);
      const url = clientLinkUrl(window.location.origin, r.token);
      setLink({ url, until: r.expiresAt.slice(0, 10) });
      return url;
    } catch (e) {
      p.onError(errorText(e));
      return null;
    } finally {
      setBusy(null);
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
    const text = `Hi${project.customer_name ? ` ${project.customer_name}` : ""}, here is the list of items to buy for ${project.name}, with the dates we need them by: ${url}`;
    const wa = whatsappLink(project.customer_phone, text);
    if (w) w.location.href = wa; else window.location.href = wa;
  }
  async function copy(): Promise<void> {
    const url = await getLink();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      p.onError("The link could not be copied. Select it below and copy it by hand.");
    }
  }
  async function pdf(): Promise<void> {
    setBusy("pdf");
    try {
      await downloadClientPdf({
        projectName: project.name, clientName: project.customer_name ?? null, today: p.today,
        items: rows.map((r) => ({ ...r.i, orderOn: r.orderOn, deliverOn: r.deliverOn })),
      });
    } catch (e) { p.onError(errorText(e)); }
    finally { setBusy(null); }
  }

  return (
    <section aria-label="Share with the client" style={{ ...cardStyle, padding: "14px 16px", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Share with {project.customer_name || "the client"}</div>
          <div style={{ fontSize: 13, color: BETA.muted }}>The client sees each item with its quantity, dates and photos. No prices, no suppliers.</div>
        </div>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" style={btnStyle("outline", "md")} disabled={none || busy !== null} onClick={() => void pdf()}><Download size={15} aria-hidden="true" />{busy === "pdf" ? "Making PDF..." : "Download PDF"}</button>
          {p.canWrite && <button type="button" style={btnStyle("outline", "md")} disabled={none || busy !== null} onClick={() => void preview()}><ExternalLink size={15} aria-hidden="true" />Preview</button>}
          {p.canWrite && <button type="button" style={btnStyle("outline", "md")} disabled={none || busy !== null} onClick={() => void copy()}>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? "Copied" : "Copy link"}</button>}
          {p.canWrite && <button type="button" style={btnStyle("teal", "md")} disabled={none || busy !== null} onClick={() => void send()}><Send size={15} aria-hidden="true" />Send on WhatsApp</button>}
        </span>
      </div>
      {link && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: WS.panel, border: `1px solid ${BETA.line}` }}>
          <input readOnly aria-label="Client link" value={link.url} onFocus={(e) => e.currentTarget.select()}
            style={{ flex: "1 1 280px", minWidth: 0, border: 0, background: "transparent", font: "inherit", fontSize: 13, color: BETA.ink, outline: "none" }} />
          <span style={{ ...metaStyle, whiteSpace: "nowrap" }}>Read only · valid until {dayMonthYear(link.until)}</span>
        </div>
      )}
    </section>
  );
}
