/* The client's read-only Client PO page, /cpo/:token, no login (owner, 24 Oct 2026). Shows the company, the project
   and the items the client buys, by category or by area, each with its photos (the order line's and the SKU's, the
   same ones the staff Client PO tab shows). The token is the only credential, for the list and for every photo
   (engine/backend/src/routes/renovationBetaClientPublic.ts). */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { WsFilterPill, WsStyle } from "./BetaWsUi";
import { WsNarrow, WsNarrowStyle, WsTable, metaStyle, narrowBandStyle, narrowItemStyle, numStyle, tdStyle, thStyle } from "./BetaVoPoUi";
import { BETA } from "./renovationBetaTheme";
import { byArea, byCategory, clientPhotoUrl, type ClientItem, type ClientPublicAnswer } from "./renovationBetaVoPo";
import { PlainPhotoStrip } from "./BetaClientPhotos";

const API_BASE: string = (import.meta.env.VITE_API_URL as string) || (import.meta.env.PROD ? "" : "https://conts-scm-engine.invalid");

function Photos({ token, i, size }: { token: string; i: ClientItem; size: number }): ReactElement | null {
  const photos = (i.photos ?? []).map((ph, n) => ({
    thumb: clientPhotoUrl(API_BASE, token, ph.ref, true),
    full: clientPhotoUrl(API_BASE, token, ph.ref, false),
    label: `${i.description || i.itemCode || "Item"}, photo ${n + 1}`,
  }));
  return <PlainPhotoStrip photos={photos} size={size} label={`Photos of ${i.description || i.itemCode || "item"}`} />;
}

export function BetaClientLinkPage(): ReactElement {
  const token = window.location.pathname.split("/")[2] ?? "";
  const [data, setData] = useState<ClientPublicAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"category" | "area">("category");
  useEffect(() => {
    let live = true;
    fetch(`${API_BASE}/api/public/beta-client/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j as { message?: string }).message ?? "This link is not valid.");
        return j as ClientPublicAnswer;
      })
      .then((j) => { if (live) setData(j); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : "This link is not valid."); });
    return () => { live = false; };
  }, [token]);
  const groups = useMemo(() => {
    const items = data?.items ?? [];
    return view === "category"
      ? byCategory(items).map((c) => ({ key: c.key, label: c.label, subs: c.subs }))
      : byArea(items).map((a) => ({ key: a.key, label: a.label, subs: [{ key: `${a.key}/all`, label: "", items: a.items }] }));
  }, [data, view]);

  return (
    <div className="bws" style={{ minHeight: "100vh", background: BETA.bg }}>
      <WsStyle />
      <WsNarrowStyle />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px 48px", display: "flex", flexDirection: "column", gap: 16 }}>
        {error ? <p role="alert" style={{ padding: 24, fontSize: 15 }}>{error}</p> : !data ? <p style={{ padding: 24, color: BETA.muted }}>Loading...</p> : (
          <>
            <header>
              <div style={metaStyle}>{data.company ?? ""}</div>
              <h1 style={{ fontSize: 24, fontWeight: 700, margin: "4px 0" }}>Items to buy</h1>
              <div style={{ fontSize: 14, color: BETA.muted }}>{data.project} · {data.items.length} item{data.items.length === 1 ? "" : "s"}</div>
            </header>
            <div role="group" aria-label="Group by" style={{ display: "flex", gap: 8 }}>
              <WsFilterPill on={view === "category"} onClick={() => setView("category")}>By category</WsFilterPill>
              <WsFilterPill on={view === "area"} onClick={() => setView("area")}>By area</WsFilterPill>
            </div>
            {data.items.length === 0 ? <p style={{ fontSize: 14, color: BETA.muted }}>Nothing to buy yet.</p> : (
              <WsTable minWidth={640} label="Items to buy">
                <thead>
                  <tr>
                    <th style={thStyle}>Item</th>
                    <th style={thStyle}>SKU</th>
                    <th style={thStyle}>{view === "category" ? "Area" : "Category"}</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Qty</th>
                    <th style={thStyle}>Photos</th>
                  </tr>
                </thead>
                <tbody style={{ background: BETA.surface }}>
                  {groups.map((g) => [
                    <tr key={g.key}><td colSpan={5} style={{ padding: "8px 10px", background: "#E1F1EE", borderLeft: `4px solid ${BETA.accent}`, color: BETA.accentInk, fontWeight: 700 }}>{g.label}</td></tr>,
                    ...g.subs.flatMap((s) => [
                      ...(s.label ? [<tr key={s.key}><td colSpan={5} style={{ padding: "6px 10px 6px 24px", background: "#F3F9F8", fontWeight: 600 }}>{s.label}</td></tr>] : []),
                      ...s.items.map((i) => (
                        <tr key={i.key}>
                          <td style={{ ...tdStyle, paddingLeft: 32 }}>{i.description || "-"}{i.pending && <div style={metaStyle}>Not confirmed yet</div>}</td>
                          <td style={{ ...tdStyle, fontFamily: "ui-monospace, monospace", fontSize: 13 }}>{i.itemCode ?? "-"}</td>
                          <td style={tdStyle}>{view === "category" ? (i.area ?? "-") : `${i.categoryLabel} · ${i.subLabel}`}</td>
                          <td style={numStyle}>{i.measure ?? `${i.qty}${i.uom ? ` ${i.uom}` : ""}`}</td>
                          <td style={tdStyle}>{(i.photos?.length ?? 0) > 0 ? <Photos token={token} i={i} size={48} /> : <span style={metaStyle}>-</span>}</td>
                        </tr>
                      )),
                    ]),
                  ])}
                </tbody>
              </WsTable>
            )}
            {data.items.length > 0 && (
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
                        {(i.photos?.length ?? 0) > 0 && <Photos token={token} i={i} size={56} />}
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
        )}
      </main>
    </div>
  );
}
