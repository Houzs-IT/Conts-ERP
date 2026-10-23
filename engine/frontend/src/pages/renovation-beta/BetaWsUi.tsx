/* The building blocks of the Beta project workspace, copied from the owner's mockup ("Renovation Project
   Workspace", 23 Oct 2026): its card, badge, button, field and dialog styles. The values are the mockup's inline
   styles, so the workspace looks like the mockup and not like the rest of the engine. */

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { api } from "../../api/client";
import { BETA, type BetaTone } from "./renovationBetaTheme";

/** Fixed colours the mockup uses besides the shared palette in renovationBetaTheme.ts. */
export const WS = {
  text2: "#3F4947",
  rowLine: "#E8EDEC",
  chip: "#EEF2F1",
  head: "#F2F5F4",
  panel: "#F6F8F8",
  tealSoft: "#F3F9F8",
  tealLine: "#A9CFCB",
  dash: "#A9B4B2",
  green: "#1E6B3A",
  red: "#A12622",
  redDot: "#C62828",
  amber: "#8A4A00",
  amberDot: "#D98A1F",
  amberBtn: "#B86A0B",
  blue: "#1F4E8C",
} as const;

export const TONE_PAID: BetaTone = [WS.green, "#DDF0E3"];
export const TONE_DONE: BetaTone = [WS.green, "#E5F3EA"];
export const TONE_ALERT: BetaTone = [WS.red, "#FADCDA"];
export const TONE_QUIET: BetaTone = [WS.text2, WS.chip];
export const TONE_WAIT: BetaTone = [WS.amber, "#FDF1E2"];
export const TONE_WAIT_STRONG: BetaTone = [WS.amber, "#FBE3C2"];
export const TONE_INFO: BetaTone = [WS.blue, "#E8F0FB"];
export const TONE_ACCENT: BetaTone = [BETA.accent, "#E4F1EF"];

/* Hover, focus and the tab bar cannot be inline styles; the rules are the mockup's styles.css. */
const CSS = `
.bws{color:${BETA.ink};font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px;line-height:1.4}
.bws *{box-sizing:border-box}
.bws h1,.bws h2,.bws h3,.bws p,.bws ol,.bws ul,.bws dl,.bws dd{margin:0}
.bws a{color:${BETA.accent}}
.bws a:focus-visible,.bws button:focus-visible,.bws input:focus-visible,.bws select:focus-visible,.bws textarea:focus-visible,.bws label:focus-within,.bws [role=dialog]:focus-visible{outline:3px solid ${BETA.focus};outline-offset:2px}
.bws button:disabled{opacity:.55;cursor:not-allowed}
.bws .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.bws .ws-input{min-height:40px;width:100%;border:1px solid ${BETA.border};border-radius:8px;padding:0 8px;font:inherit;font-size:14px;background:${BETA.surface};color:${BETA.ink}}
.bws .ws-input-sm{min-height:38px;width:100%;min-width:0;border:1px solid ${BETA.border};border-radius:8px;padding:0 8px;font:inherit;font-size:14px;background:${BETA.surface};color:${BETA.ink}}
@media (max-width:720px){.bws .h1{font-size:22px!important}.bws .tab{padding:0 12px}.bws .chips{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))}.bws .chips>*{min-width:0}}
.bws .tabs{display:flex;flex-wrap:nowrap;gap:4px;border-bottom:1px solid ${BETA.line};overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.bws .tabs::-webkit-scrollbar{display:none}
.bws .tab{display:flex;flex:none;white-space:nowrap;align-items:center;min-height:44px;padding:0 16px;border:0;border-bottom:3px solid transparent;background:transparent;font:inherit;color:${WS.text2};font-weight:500;cursor:pointer}
.bws .tab[aria-current="page"]{border-bottom-color:${BETA.accent};color:${BETA.accentInk};font-weight:700}
.bws .tab:hover{color:${BETA.accentInk}}
.bws .link{padding:0;border:0;background:transparent;font:inherit;font-size:13px;font-weight:600;color:${BETA.accent};cursor:pointer;text-decoration:underline}
.bws .link:hover{color:${BETA.accentInk}}
@media (prefers-reduced-motion:no-preference){.bws .fade{animation:bwsfade .18s ease-out}@keyframes bwsfade{from{opacity:.4}to{opacity:1}}}
`;

export function WsStyle(): ReactElement {
  return <style>{CSS}</style>;
}

/* ---------- Cards, headings, badges ---------- */

export const cardStyle: CSSProperties = {
  background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 14,
};

export const h2Style: CSSProperties = { margin: 0, fontSize: 18, fontWeight: 700 };
export const subStyle: CSSProperties = { fontSize: 13, color: BETA.muted };

interface WsCardProps {
  title: string;
  sub?: ReactNode;
  /** The sub line sits next to the title (Payments) instead of under it. */
  subInline?: boolean;
  right?: ReactNode;
  gap?: number;
  children?: ReactNode;
}

export function WsCard({ title, sub, subInline = false, right, gap = 14, children }: WsCardProps): ReactElement {
  const id = useId();
  return (
    <section aria-labelledby={id} style={{ ...cardStyle, gap }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={subInline ? { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" } : undefined}>
          <h2 id={id} style={h2Style}>{title}</h2>
          {sub != null && <div style={subStyle}>{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function WsBadge({ tone, children, size = 12 }: { tone: BetaTone; children: ReactNode; size?: number }): ReactElement {
  return (
    <span style={{ padding: "3px 8px", borderRadius: 6, background: tone[1], color: tone[0], fontSize: size, fontWeight: 600, whiteSpace: "nowrap" }}>{children}</span>
  );
}

/** A page-level section heading (22px) with its sub line and an optional right side, as the Site, Defects and Timeline views open. */
export function WsPageHead({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }): ReactElement {
  return (
    <section style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{title}</h2>
        {sub != null && <div style={{ marginTop: 4, fontSize: 13, color: BETA.muted }}>{sub}</div>}
      </div>
      {right}
    </section>
  );
}

export function WsEmpty({ children }: { children: ReactNode }): ReactElement {
  return <div style={{ padding: 24, textAlign: "center", color: BETA.muted, background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12 }}>{children}</div>;
}

/** The mockup's small tag, for example RECORD. */
export function WsTag({ children }: { children: ReactNode }): ReactElement {
  return <span style={{ padding: "1px 6px", borderRadius: 4, background: BETA.ink, color: "#FFFFFF", fontSize: 10, fontWeight: 700, letterSpacing: ".04em" }}>{children}</span>;
}

/* ---------- Buttons ---------- */

export type WsBtnKind = "dark" | "teal" | "outline" | "amber" | "danger";
export type WsBtnSize = "sm" | "md" | "lg";

const HEIGHT: Record<WsBtnSize, number> = { sm: 36, md: 40, lg: 44 };

export function btnStyle(kind: WsBtnKind, size: WsBtnSize = "md"): CSSProperties {
  const base: CSSProperties = {
    minHeight: HEIGHT[size], padding: size === "sm" ? "0 12px" : size === "md" ? "0 14px" : "0 18px", borderRadius: 8, font: "inherit",
    fontSize: size === "sm" ? 13 : 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, textDecoration: "none",
  };
  if (kind === "dark") return { ...base, border: 0, background: BETA.ink, color: "#FFFFFF" };
  if (kind === "teal") return { ...base, border: 0, background: BETA.accent, color: "#FFFFFF" };
  if (kind === "amber") return { ...base, border: 0, background: WS.amberBtn, color: "#FFFFFF" };
  if (kind === "danger") return { ...base, border: `1px solid #E8A5A2`, background: BETA.surface, color: WS.red };
  return { ...base, border: `1px solid ${BETA.border}`, background: BETA.surface, color: BETA.ink };
}

interface WsBtnProps {
  kind?: WsBtnKind;
  size?: WsBtnSize;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  style?: CSSProperties;
  children: ReactNode;
}

export function WsBtn({ kind = "outline", size = "md", disabled, onClick, type = "button", style, children }: WsBtnProps): ReactElement {
  return <button type={type} disabled={disabled} onClick={onClick} style={{ ...btnStyle(kind, size), ...style }}>{children}</button>;
}

/** A pill that filters (All, a room, a category): the chosen one is dark. */
export function WsFilterPill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        minHeight: 36, padding: "0 14px", borderRadius: 18, border: `1px solid ${on ? BETA.ink : BETA.border}`, background: on ? BETA.ink : BETA.surface,
        color: on ? "#FFFFFF" : BETA.ink, font: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/* ---------- Fields ---------- */

export const inputStyle: CSSProperties = {
  minHeight: 40, border: `1px solid ${BETA.border}`, borderRadius: 8, padding: "0 10px", font: "inherit", fontSize: 14, background: BETA.surface, width: "100%", color: BETA.ink,
};
export const textareaStyle: CSSProperties = { ...inputStyle, padding: "8px 10px", minHeight: 64, resize: "vertical" };
export const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: BETA.muted };

export function WsField({ label, children, style }: { label: string; children: ReactNode; style?: CSSProperties }): ReactElement {
  return <label style={{ ...labelStyle, ...style }}>{label}{children}</label>;
}

/* ---------- Dialog (the mockup's #calModal) ---------- */

interface WsDialogProps { title: string; sub?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }

export function WsDialog({ title, sub, onClose, children, footer, wide = false }: WsDialogProps): ReactElement {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(23,32,31,.55)", overflowY: "auto", padding: "24px 16px" }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ maxWidth: wide ? 720 : 520, margin: "0 auto", background: BETA.surface, borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 12, color: BETA.ink }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{title}</h2>
            {sub && <div style={{ fontSize: 14, color: WS.text2 }}>{sub}</div>}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ ...btnStyle("outline", "sm"), minWidth: 36, padding: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {children}
        {footer && <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 }}>{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Small shapes ---------- */

export function WsCheck({ size = 14, stroke = 3 }: { size?: number; stroke?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={stroke} aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
  );
}

export function WsAvatar({ text, size = 30, bg = BETA.ink, color = "#FFFFFF" }: { text: string; size?: number; bg?: string; color?: string }): ReactElement {
  return (
    <span aria-hidden="true" style={{ flex: "none", width: size, height: size, borderRadius: size / 2, background: bg, color, fontSize: size > 28 ? 11 : 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      {text}
    </span>
  );
}

/** The 36px by 44px PDF tile of the mockup's file rows. */
export function WsPdfTile(): ReactElement {
  return (
    <span aria-hidden="true" style={{ flex: "none", width: 36, height: 44, borderRadius: 4, background: "#FDF1F0", border: "1px solid #F2D3D1", color: WS.red, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 6 }}>
      PDF
    </span>
  );
}

/** Success or error notice under the tabs; the text is announced to a screen reader. */
export function WsNotice({ tone, children }: { tone: "ok" | "err"; children: ReactNode }): ReactElement {
  const ok = tone === "ok";
  return (
    <div
      role={ok ? "status" : "alert"}
      style={{ padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, background: ok ? "#F1F8F3" : "#FDF4F3", border: `1px solid ${ok ? "#B7DCC3" : "#E8A5A2"}`, color: ok ? WS.green : WS.red }}
    >
      {children}
    </div>
  );
}

/* ---------- Photos ---------- */

/** A photo kept in R2: the browser's img tag cannot carry the sign-in header, so the file is fetched first. A failed load says so. */
export function WsPhoto({ path, alt, style, onClick }: { path: string; alt: string; style?: CSSProperties; onClick?: () => void }): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    api.fetchBlobUrl(path)
      .then((u) => { made = u; if (live) setUrl(u); else URL.revokeObjectURL(u); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [path]);
  const box: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", background: WS.chip, color: BETA.muted, fontSize: 12, ...style };
  if (failed) return <div style={box}>Photo unavailable</div>;
  if (!url) return <div style={box} aria-busy="true" />;
  const img = <img src={url} alt={alt} style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", ...style }} />;
  return onClick ? <button type="button" onClick={onClick} style={{ display: "block", width: "100%", height: "100%", padding: 0, border: 0, background: "transparent", cursor: "pointer" }}>{img}</button> : img;
}
