/* Beta workspace > DO and GR (owner, 24 Oct 2026). A vertical timeline, newest first, drawn like Site & photos: the
   day and time on the left, a dot on a line, and on the right one delivery order of the project's sales order(s), or
   one goods receipt of its POs. DO and GR are twins (owner, 24 Oct 2026) and show the same fields in the same order:
   number and status, PO (or "Client PO") and delivery date as the PO tab shows them (renovationBetaDocsModel.ts),
   lines and quantity, the other side's documents (a DO's GRs, a GR's DOs, each a link), where it came from, the
   rooms, the document's own note, and its photos with "Upload POD". "By category" and "By area" list the delivered
   lines instead, each with the documents that delivered it. ?do=<no> or ?gr=<no> opens the tab on that document. */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { Camera, PackageCheck, StickyNote, Truck } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { MediaStrip, type MediaItem } from "./BetaMedia";
import { PhotoUploadDialog, type UploadTarget } from "./BetaPhotoUpload";
import { TONE_DONE, TONE_QUIET, TONE_WAIT, WS, WsBadge, WsEmpty, WsFilterPill, WsPageHead, btnStyle, cardStyle } from "./BetaWsUi";
import type { BetaTabProps } from "./betaShared";
import { datesText, deliveredGroups, docSummary, type DeliveredLine, type DocRef, type DocView } from "./renovationBetaDocsModel";
import { linesApi, type ManagedLine } from "./renovationBetaLines";
import { dayMonth, mytDay } from "./renovationBetaModel";
import { clockOf, dayTitle } from "./renovationBetaPhotosModel";
import { betaMediaApi } from "./renovationBetaMediaApi";
import { betaSiteApi, type SiteDelivery, type SitePhoto } from "./renovationBetaSiteApi";
import { BETA, TONES } from "./renovationBetaTheme";
import { doStatusWords } from "../scm-v2/renovationDoStatus";
import { statusLabel } from "../../vendor/scm/lib/status-pill";
import { BetaLoading } from "./BetaLoading";

export function photoAsMedia(p: SitePhoto): MediaItem {
  return { id: p.id, path: p.path, kind: p.kind ?? (p.image ? "image" : "file"), name: p.name, label: p.source === "pod" ? "POD" : null, at: p.at, caption: p.area };
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

/* The words the DO and GR screens use for the same stored status (status-pill.ts via renovationDoStatus.ts), so a
   confirmed DO reads "Confirmed" here as on the DO list, not the raw "Loaded" value. */
export function statusTone(d: Pick<SiteDelivery, "type" | "status">): { tone: readonly [string, string]; text: string } {
  const s = d.status.toUpperCase();
  if (d.type === "delivery_order") {
    const w = doStatusWords(s);
    return { tone: w.tone === "success" ? TONE_DONE : w.tone === "error" || s === "DRAFT" ? TONE_QUIET : TONE_WAIT, text: w.label };
  }
  const text = statusLabel("grn", s);
  if (["RECEIVED", "POSTED", "CLOSED", "COMPLETED"].includes(s)) return { tone: TONE_DONE, text };
  if (s === "DRAFT" || s === "CANCELLED") return { tone: TONE_QUIET, text };
  return { tone: TONE_WAIT, text };
}

const chip = { padding: "2px 10px", borderRadius: 10, fontSize: 12, fontWeight: 600, background: WS.chip, color: WS.text2, whiteSpace: "nowrap" } as const;
const metaLabel = { fontSize: 12, color: BETA.muted } as const;
const metaValue = { fontSize: 13, fontWeight: 600, color: BETA.ink, overflowWrap: "anywhere" } as const;

function Meta({ label, children }: { label: string; children: ReactElement | string }): ReactElement {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
      {label && <span style={metaLabel}>{label}</span>}
      <span style={metaValue}>{children}</span>
    </span>
  );
}

/** Links to documents: a click opens the DO (or GR) tab on that document's row. */
function DocLinks({ docs, onOpen }: { docs: ReadonlyArray<DocRef & { qty?: number }>; onOpen: (no: string) => void }): ReactElement {
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8 }}>
      {docs.map((x) => (
        <button key={x.id} type="button" className="link" onClick={() => onOpen(x.no)} style={{ fontSize: 13, fontWeight: 600 }}>
          {x.no}{x.qty != null ? ` (${x.qty})` : ""}
        </button>
      ))}
    </span>
  );
}

function poText(pos: readonly string[], client: boolean): string | null {
  return [...pos, ...(client ? ["Client PO"] : [])].join(", ") || null;
}

/** One document on the timeline. The left column shows the day on the first document of each day, then the time. */
function DocRow({ d, day, today, last, lines, all, focused, canWrite, onAdd, openDo, openGr }: {
  d: SiteDelivery; day: string | null | undefined; today: string; last: boolean; lines: readonly ManagedLine[]; all: readonly SiteDelivery[];
  focused: boolean; canWrite: boolean; onAdd: () => void; openDo: (no: string) => void; openGr: (no: string) => void;
}): ReactElement {
  const isDo = d.type === "delivery_order";
  const st = statusTone(d);
  const media = d.photos.map(photoAsMedia);
  const s = docSummary(d, lines, all);
  const po = poText(s.pos, s.clientPo);
  const due = datesText(s.deliverOn, dayMonth);
  const other = isDo ? s.grs : s.dos;
  const from = isDo
    ? [d.from ? `Sales order ${d.from}` : null, d.driver ? `Driver ${d.driver}` : null]
    : [d.from ? `Supplier ${d.from}` : null, d.supplierRef ? `Supplier DO ${d.supplierRef}` : null];
  const isToday = day === today;
  return (
    <li id={`beta-doc-${d.no}`} aria-label={`${isDo ? "Delivery order" : "Goods receipt"} ${d.no}`} aria-current={focused ? "true" : undefined}
      style={{ display: "grid", gridTemplateColumns: "72px 18px minmax(0, 1fr)", columnGap: 10, scrollMarginTop: 96 }}>
      <div style={{ padding: last ? 0 : "0 0 22px", fontSize: 13, color: BETA.muted, lineHeight: 1.35 }}>
        {day !== undefined && (day ? dayTitle(day, today).split(" · ") : ["No date"]).map((t) => <div key={t} style={{ fontWeight: 700, color: isToday ? BETA.accentInk : BETA.ink }}>{t}</div>)}
        <div>{clockOf(d.at) ?? ""}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <span aria-hidden="true" style={{ flex: "none", marginTop: 4, width: 12, height: 12, borderRadius: 6, background: day !== undefined ? BETA.accent : BETA.surface, border: `2px solid ${BETA.accent}` }} />
        {!last && <span aria-hidden="true" style={{ flex: 1, width: 2, background: BETA.line }} />}
      </div>
      <div style={{ padding: last ? 0 : "0 0 22px", minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", borderRadius: 12, background: BETA.surface, border: `1px solid ${focused ? BETA.accent : BETA.line}`,
          ...(focused ? { boxShadow: `0 0 0 2px color-mix(in srgb, ${BETA.accent} 20%, transparent)` } : {}) }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <span aria-hidden="true" style={{ flex: "none", width: 28, height: 28, borderRadius: 14, background: isDo ? TONES.grey.soft : TONES.accent.soft, color: isDo ? WS.blue : BETA.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {isDo ? <Truck size={14} /> : <PackageCheck size={14} />}
            </span>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, overflowWrap: "anywhere" }}>{d.no}</h3>
            <WsBadge tone={st.tone}>{st.text}</WsBadge>
            {canWrite && <button type="button" onClick={onAdd} style={{ ...btnStyle("outline", "sm"), marginLeft: "auto" }}><Camera size={14} aria-hidden="true" />Upload POD</button>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", columnGap: 18, rowGap: 4 }}>
            <Meta label={po && s.pos.length === 0 ? "" : "PO"}>{po ?? "No PO"}</Meta>
            <Meta label="Delivery">{due ?? "Not set"}</Meta>
            <Meta label="Qty">{s.lineCount > 0 ? `${plural(s.lineCount, "line")} · ${s.units}` : "No lines"}</Meta>
            <Meta label={isDo ? "GR" : "DO"}>{other.length > 0 ? <DocLinks docs={other} onOpen={isDo ? openGr : openDo} /> : "None yet"}</Meta>
          </div>
          {(from.some(Boolean) || d.areas.length > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
              {from.filter(Boolean).map((t) => <span key={t} style={{ fontSize: 12.5, color: BETA.muted, marginRight: 6 }}>{t}</span>)}
              {d.areas.map((a) => <span key={a} style={chip}>{a}</span>)}
            </div>
          )}
          {d.note && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", borderRadius: 8, background: TONES.amber.soft, borderLeft: `3px solid ${WS.amberDot}`, fontSize: 13, color: WS.text2, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
              <StickyNote size={14} aria-hidden="true" style={{ flex: "none", marginTop: 2, color: WS.amber }} />
              <span><span style={{ fontWeight: 600, color: BETA.ink }}>Note </span>{d.note}</span>
            </div>
          )}
          {media.length > 0 ? <MediaStrip items={media} label={`Photos of ${d.no}`} size={88} max={8} />
            : <span style={metaLabel}>{isDo ? "No proof of delivery photo yet" : "No photos on this receipt yet"}</span>}
        </div>
      </div>
    </li>
  );
}

function LineRow({ r, isDo, view, openDoc, openDo }: { r: DeliveredLine; isDo: boolean; view: "category" | "area"; openDoc: (no: string) => void; openDo: (no: string) => void }): ReactElement {
  const l = r.line;
  const po = poText(r.poNumber ? [r.poNumber] : [], r.clientPo);
  const where = view === "category" ? l.area : l.categoryLabel;
  const media = r.photos.map(photoAsMedia);
  return (
    <li style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${WS.rowLine}` }}>
      <div style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{l.description || l.itemCode}</span>
          <span style={{ fontSize: 12, color: BETA.muted }}>{l.itemCode} · {r.qty} of {l.qty} {l.uom}</span>
          {where && <span style={chip}>{where}</span>}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", columnGap: 16, rowGap: 4 }}>
          <Meta label={isDo ? "Delivered by" : "Received on"}><DocLinks docs={r.docs.map((x) => ({ id: x.d.id, no: x.d.no, qty: x.qty }))} onOpen={openDoc} /></Meta>
          <Meta label={po && !r.poNumber ? "" : "PO"}>{po ?? "No PO"}</Meta>
          <Meta label="Delivery">{r.deliverOn ? dayMonth(r.deliverOn) : "Not set"}</Meta>
          {!isDo && <Meta label="DO">{r.dos.length > 0 ? <DocLinks docs={r.dos} onOpen={openDo} /> : "None yet"}</Meta>}
        </div>
      </div>
      <div style={{ flex: "1 1 280px", minWidth: 0 }}>
        {media.length > 0 ? <MediaStrip items={media} label={`Photos of ${l.description || l.itemCode}`} size={56} max={6} />
          : <span style={metaLabel}>{isDo ? "No proof of delivery photo yet" : "No photos yet"}</span>}
      </div>
    </li>
  );
}

const VIEWS: ReadonlyArray<{ key: DocView; label: (isDo: boolean) => string }> = [
  { key: "doc", label: (isDo) => (isDo ? "By DO" : "By GR") },
  { key: "category", label: () => "By category" },
  { key: "area", label: () => "By area" },
];

function DocList({ p, type }: { p: BetaTabProps; type: SiteDelivery["type"] }): ReactElement {
  const site = useQuery(["renovation-beta", "site", p.projectId], () => betaSiteApi.site(p.projectId), [p.projectId]);
  const lines = useQuery(["renovation-beta", "lines", p.projectId], () => linesApi.lines(p.projectId), [p.projectId]);
  const photos = useQuery(["renovation-beta", "photos", p.projectId], () => betaMediaApi.photos(p.projectId), [p.projectId]);
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState<UploadTarget | null>(null);
  const [view, setView] = useState<DocView>("doc");
  const isDo = type === "delivery_order";
  const param = isDo ? "do" : "gr";
  const focus = params.get(param);
  const all = useMemo(() => site.data?.deliveries ?? [], [site.data]);
  const list = all.filter((d) => d.type === type);
  const soLines = lines.data?.lines ?? [];
  const groups = useMemo(() => (view === "doc" ? [] : deliveredGroups(all.filter((d) => d.type === type), soLines, view, all)), [all, soLines, view, type]);
  const title = isDo ? "Delivery orders" : "Goods received";

  useEffect(() => {
    if (!focus || !site.data) return;
    setView("doc");
    const t = window.setTimeout(() => document.getElementById(`beta-doc-${focus}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
    return () => window.clearTimeout(t);
  }, [focus, site.data]);

  const open = (tab: "do" | "gr", no: string): void => setParams((prev) => {
    const next = new URLSearchParams(prev);
    next.set("tab", tab);
    next.delete(tab === "do" ? "gr" : "do");
    next.set(tab, no);
    return next;
  }, { replace: true });
  const openDo = (no: string): void => open("do", no);
  const openOwn = (no: string): void => open(param, no);

  if (site.error && !site.data) return <p role="alert" style={{ fontSize: 14, color: WS.red }}>The {isDo ? "delivery orders" : "goods receipts"} could not be loaded: {site.error}</p>;
  return (
    <>
      <WsPageHead title={title} sub={isDo ? "Every DO of this project's sales order, with its proof of delivery photos and videos, newest first" : "Every goods receipt of this project's POs, with the photos taken on site, newest first"} />
      {site.data?.ready && list.length > 0 && (
        <div role="group" aria-label="Show" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {VIEWS.map((v) => <WsFilterPill key={v.key} on={view === v.key} onClick={() => setView(v.key)}>{v.label(isDo)}</WsFilterPill>)}
        </div>
      )}
      {!site.data ? <BetaLoading label="Loading" size="inline" />
        : !site.data.ready ? <WsEmpty>Deliveries are not switched on for this system yet.</WsEmpty>
        : list.length === 0 ? <WsEmpty>{isDo ? "No delivery orders yet. Each DO made from this project's sales order shows here with its POD." : "No goods receipts yet. Each GR of this project's POs shows here with its photos."}</WsEmpty>
        : view === "doc" ? (
          <ol aria-label={`${title} timeline`} style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {list.map((d, i) => {
              const day = d.at ? mytDay(d.at) : null;
              const before = i > 0 ? list[i - 1].at : null;
              const prev = i > 0 ? (before ? mytDay(before) : null) : undefined;
              return (
                <DocRow key={d.id} d={d} day={i === 0 || prev !== day ? day : undefined} today={p.today} last={i === list.length - 1} lines={soLines} all={all}
                  focused={focus === d.no} canWrite={p.canWrite} openDo={openDo} openGr={(no) => open("gr", no)}
                  onAdd={() => setAdding({ kind: isDo ? "do" : "gr", id: d.id })} />
              );
            })}
          </ol>
        ) : lines.error && !lines.data ? <p role="alert" style={{ fontSize: 14, color: WS.red }}>The order lines could not be loaded: {lines.error}</p>
        : !lines.data ? <BetaLoading label="Loading" size="inline" />
        : groups.length === 0 ? <WsEmpty>None of the lines on these {isDo ? "delivery orders" : "goods receipts"} is on the project's sales order.</WsEmpty>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label} style={{ ...cardStyle, padding: "12px 16px", gap: 0 }}>
                <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700 }}>{g.label} <span style={{ fontWeight: 400, color: BETA.muted }}>· {g.lines.length} {g.lines.length === 1 ? "line" : "lines"}</span></h3>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {g.lines.map((r) => <LineRow key={r.key} r={r} isDo={isDo} view={view} openDoc={openOwn} openDo={openDo} />)}
                </ul>
              </section>
            ))}
          </div>
        )}
      {adding && (
        <PhotoUploadDialog projectId={p.projectId} initial={adding} areas={site.data?.areas ?? []}
          docs={photos.data?.docs ?? { dos: list.filter(() => isDo).map((d) => ({ id: d.id, no: d.no })), grs: list.filter(() => !isDo).map((d) => ({ id: d.id, no: d.no })), pos: [] }}
          tasks={photos.data?.tasks ?? []}
          onClose={() => setAdding(null)} onDone={(t) => { setAdding(null); p.onDone(t); site.reload(); photos.reload(); }} />
      )}
    </>
  );
}

export function BetaDoTab(p: BetaTabProps): ReactElement {
  return <DocList p={p} type="delivery_order" />;
}

export function BetaGrTab(p: BetaTabProps): ReactElement {
  return <DocList p={p} type="goods_received" />;
}
