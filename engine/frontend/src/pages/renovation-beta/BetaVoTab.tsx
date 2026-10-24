/* Beta workspace > VO (owner, 24 Oct 2026). A VO is a sales order amendment: every SO amendment and every renovation
   variation order on the project's SOs is listed here as VO-01, VO-02, ... Pick one to see exactly what it added and
   deducted, and where each line goes (PO: we buy it; Client PO: the client buys it). "New VO" opens the VO screen of
   the project's current SO. No approval step is added here; each VO's own screen keeps its existing flow. */

import { useEffect, useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ExternalLink, FilePlus2 } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { useQuery } from "../../hooks/useQuery";
import { refusalOf, renoSend } from "../../lib/renovation/api";
import { money } from "../projects/renovation/renovationModel";
import { TONE_ACCENT, TONE_ALERT, TONE_DONE, TONE_QUIET, TONE_WAIT, WS, WsBadge, WsCard, WsEmpty, WsFilterPill, WsPageHead, btnStyle } from "./BetaWsUi";
import { WsNarrow, WsNarrowStyle, WsStat, WsStats, WsTable, metaStyle, narrowItemStyle, numStyle, tdStyle, thStyle } from "./BetaVoPoUi";
import type { BetaTabProps } from "./betaShared";
import { dayMonthYear, mytDay } from "./renovationBetaModel";
import { BETA, type BetaTone } from "./renovationBetaTheme";
import { signedQty, voPoApi, type VoAnswer, type VoLine, type VoRow } from "./renovationBetaVoPo";

/* Where a line goes: we buy it (PO), the client buys it (Client PO), or it is our own works with no supplier. */
const GOES_TO_LABEL: Record<VoLine["goesTo"], string> = { po: "PO", client: "Client PO", works: "Our works" };
const goesToTone = (l: VoLine): BetaTone => (l.goesTo === "client" ? TONE_ACCENT : l.goesTo === "po" && l.change === "deduct" ? TONE_ALERT : TONE_QUIET);

const bucketTone = (v: VoRow): BetaTone => (v.bucket === "approved" ? TONE_DONE : v.bucket === "closed" ? TONE_QUIET : TONE_WAIT);

export function BetaVoTab(p: BetaTabProps): ReactElement {
  const q = useQuery(["renovation-beta", "vo", p.projectId], () => voPoApi.vo(p.projectId), [p.projectId]);
  if (q.error) return <p role="alert" style={{ fontSize: 14, color: WS.red }}>The VO list could not be loaded: {q.error}</p>;
  if (!q.data) return <p style={{ padding: "40px 0", textAlign: "center", fontSize: 14, color: BETA.muted }}>Loading VO...</p>;
  return <VoBody p={p} d={q.data} />;
}

function VoBody({ p, d }: { p: BetaTabProps; d: VoAnswer }): ReactElement {
  const [sel, setSel] = useState<string>("all");
  const latest = d.vos.length ? d.vos[d.vos.length - 1].key : "all";
  useEffect(() => { setSel(latest); }, [latest]);
  const chosen = d.vos.find((v) => v.key === sel) ?? null;
  const shown = chosen ? [chosen] : d.vos.filter((v) => v.bucket !== "closed");

  return (
    <>
      <WsNarrowStyle />
      <WsPageHead
        title="VO"
        sub="Changes after the sales order. Each line goes to PO (we buy it), Client PO (the client buys it) or is our own works."
        right={<NewVo p={p} so={d.so} />}
      />

      <WsStats>
        {d.totals ? (
          <>
            <WsStat label="Added" value={money(d.totals.addedSen)} tone={WS.green} meta="Recorded and approved VOs" />
            <WsStat label="Deducted" value={money(d.totals.deductedSen)} tone={WS.red} meta="Recorded and approved VOs" />
            <WsStat label="Net change" value={money(d.totals.netSen)} meta={d.counts.pending ? `Pending VOs: ${money(d.totals.pendingNetSen)}` : "Nothing pending"} />
          </>
        ) : null}
        <WsStat label="VOs" value={d.vos.length} meta={`${d.counts.approved} in force · ${d.counts.pending} pending${d.counts.closed ? ` · ${d.counts.closed} closed` : ""}`} />
      </WsStats>

      {d.vos.length === 0 ? (
        <WsEmpty>No VO on this project yet.{d.so ? ` Press "New VO" to change ${d.so.docNo}.` : " The project has no sales order yet."}</WsEmpty>
      ) : (
        <>
          <nav aria-label="Choose a VO" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <WsFilterPill on={sel === "all"} onClick={() => setSel("all")}>All</WsFilterPill>
            {d.vos.map((v) => (
              <WsFilterPill key={v.key} on={sel === v.key} onClick={() => setSel(v.key)}>
                {v.label}
                <span style={{ marginLeft: 6, fontWeight: 500, opacity: 0.8 }}>{v.bucket === "approved" ? "" : v.statusLabel.toLowerCase()}</span>
              </WsFilterPill>
            ))}
          </nav>
          {chosen ? <VoCard v={chosen} finance={d.finance} /> : (
            <WsCard title="All VO lines" sub="Every line of the open and approved VOs. Pick a VO above to see one.">
              <LineTable lines={shown.flatMap((v) => v.lines.map((l) => ({ l, vo: v })))} finance={d.finance} withVo />
            </WsCard>
          )}
        </>
      )}
    </>
  );
}

function NewVo({ p, so }: { p: BetaTabProps; so: VoAnswer["so"] }): ReactElement | null {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!so) return null;
  const style = { ...btnStyle("teal", "lg"), borderRadius: 10 };
  if (!so.renovation) {
    return <Link to={`/scm/sales-orders/${encodeURIComponent(so.docNo)}?edit=1`} style={style}><FilePlus2 size={16} aria-hidden="true" />New VO</Link>;
  }
  if (!can("scm.renovation.quote")) return null;
  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await renoSend<{ id: string }>(`/sales-orders/${encodeURIComponent(so.docNo)}/variation-orders`, "POST", {});
      navigate(`/scm/renovation/variation-orders/${r.id}`);
    } catch (e) {
      p.onError(refusalOf(e).message);
      setBusy(false);
    }
  };
  return <button type="button" disabled={busy} onClick={() => void start()} style={style}><FilePlus2 size={16} aria-hidden="true" />{busy ? "Opening..." : "New VO"}</button>;
}

function VoCard({ v, finance }: { v: VoRow; finance: boolean }): ReactElement {
  const facts = [
    v.date && `${v.recorded ? "Recorded" : "Raised"} ${dayMonthYear(mytDay(v.date))}${v.raisedBy ? ` by ${v.raisedBy}` : ""}`,
    v.approvedAt && `Approved ${dayMonthYear(mytDay(v.approvedAt))}${v.approvedBy ? ` by ${v.approvedBy}` : ""}`,
    `${v.soDocNo}`,
  ].filter(Boolean).join(" · ");
  return (
    <WsCard
      title={`${v.label}${v.title ? ` · ${v.title}` : ""}`}
      sub={<span style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}><span>{v.no}</span><WsBadge tone={bucketTone(v)}>{v.statusLabel}</WsBadge><span>{facts}</span></span>}
      right={
        <span style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {finance && v.netSen != null && <span style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(v.netSen)}</span>}
          <Link to={v.href} style={btnStyle("outline", "sm")}><ExternalLink size={14} aria-hidden="true" />Open VO</Link>
        </span>
      }
    >
      {v.lines.length === 0 ? <p style={metaStyle}>This VO has no line changes (it may change dates or the address only).</p> : (
        <LineTable lines={v.lines.map((l) => ({ l, vo: v }))} finance={finance} />
      )}
    </WsCard>
  );
}

function LineTable({ lines, finance, withVo = false }: { lines: Array<{ l: VoLine; vo: VoRow }>; finance: boolean; withVo?: boolean }): ReactElement {
  if (lines.length === 0) return <p style={metaStyle}>No line changes.</p>;
  const added = lines.filter(({ l }) => l.change === "add").length;
  const deducted = lines.filter(({ l }) => l.change === "deduct").length;
  return (
    <>
      <p style={metaStyle}>{added} added · {deducted} deducted{lines.length - added - deducted ? ` · ${lines.length - added - deducted} changed` : ""}</p>
      <WsTable minWidth={withVo ? 760 : 680} label="VO lines">
        <thead>
          <tr>
            {withVo && <th style={thStyle}>VO</th>}
            <th style={thStyle}>SKU</th>
            <th style={thStyle}>Item</th>
            <th style={thStyle}>Area</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Qty</th>
            {finance && <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>}
            <th style={thStyle}>Goes to</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(({ l, vo }, i) => {
            const tone = l.change === "add" ? WS.green : l.change === "deduct" ? WS.red : WS.text2;
            return (
              <tr key={`${vo.key}:${i}`}>
                {withVo && <td style={{ ...tdStyle, whiteSpace: "nowrap", fontWeight: 600 }}>{vo.label}</td>}
                <td style={{ ...tdStyle, whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace", fontSize: 13 }}>{l.itemCode ?? "-"}</td>
                <td style={tdStyle}>
                  {l.description || "-"}
                  {l.fromItemCode && <div style={metaStyle}>Was {l.fromItemCode}</div>}
                  {(l.changes ?? []).map((w) => <div key={w} style={metaStyle}>{w}</div>)}
                </td>
                <td style={tdStyle}>{l.room ?? "-"}</td>
                <td style={{ ...numStyle, color: tone, fontWeight: 700 }}>{signedQty(l)}</td>
                {finance && <td style={{ ...numStyle, color: tone }}>{l.amountSen == null ? "-" : money(l.amountSen)}</td>}
                <td style={tdStyle}><WsBadge tone={goesToTone(l)}>{GOES_TO_LABEL[l.goesTo]}</WsBadge></td>
              </tr>
            );
          })}
        </tbody>
      </WsTable>
      <WsNarrow label="VO lines">
        {lines.map(({ l, vo }, i) => {
          const tone = l.change === "add" ? WS.green : l.change === "deduct" ? WS.red : WS.text2;
          return (
            <li key={`${vo.key}:${i}`} style={narrowItemStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontWeight: 600 }}>{l.description || l.itemCode || "-"}</span>
                <span style={{ color: tone, fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{signedQty(l)}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", ...metaStyle }}>
                {withVo && <span style={{ fontWeight: 700 }}>{vo.label}</span>}
                <span style={{ fontFamily: "ui-monospace, monospace" }}>{l.itemCode ?? "-"}</span>
                {l.room && <span>{l.room}</span>}
                {finance && l.amountSen != null && <span style={{ color: tone, fontWeight: 600 }}>{money(l.amountSen)}</span>}
                <WsBadge tone={goesToTone(l)} size={11}>{GOES_TO_LABEL[l.goesTo]}</WsBadge>
              </div>
              {l.fromItemCode && <div style={metaStyle}>Was {l.fromItemCode}</div>}
              {(l.changes ?? []).map((w) => <div key={w} style={metaStyle}>{w}</div>)}
            </li>
          );
        })}
      </WsNarrow>
    </>
  );
}
