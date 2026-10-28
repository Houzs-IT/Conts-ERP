/* The building blocks of the Beta project workspace, copied from the owner's mockup ("Renovation Project
   Workspace", 23 Oct 2026): its card, badge, button, field and dialog styles. The values are the mockup's inline
   styles, so the workspace looks like the mockup and not like the rest of the engine. */

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { motion } from "motion/react";
import { api } from "../../api/client";
import { BetaMotion, RISE } from "./betaMotion";
import { BETA, BETA_SKIN_CSS, GLASS, PILL_CONFIRM, PILL_GLASS, PILL_MAIN, PILL_SELECTED, TONES, type BetaTone } from "./renovationBetaTheme";

/** The mockup's other colours, now all from the shared palette in renovationBetaTheme.ts so both skins reach them. */
export const WS = {
  text2: BETA.text2,
  rowLine: BETA.lineSoft,
  chip: BETA.chip,
  head: BETA.head,
  panel: BETA.panel,
  tealSoft: BETA.tealSoft,
  tealLine: TONES.accent.line,
  dash: BETA.dash,
  /* "Done" and "paid" are the accent green; there is no second green (owner, 24 Oct 2026). */
  green: BETA.accent,
  greenDot: TONES.accent.dot,
  red: TONES.red.ink,
  redDot: TONES.red.dot,
  amber: TONES.amber.ink,
  amberDot: TONES.amber.dot,
  /* A solid amber under white text, so it stays the same on both skins. */
  amberBtn: "#A35C06",
  /* What was blue (information, deliveries, "waiting for the check") is now the neutral dark grey. */
  blue: TONES.grey.ink,
  blueDot: TONES.grey.dot,
} as const;

/* Every status pill in Beta takes one of these. */
export const TONE_PAID: BetaTone = [TONES.accent.ink, TONES.accent.soft];
export const TONE_DONE: BetaTone = [TONES.accent.ink, TONES.accent.soft];
export const TONE_ALERT: BetaTone = [TONES.red.ink, TONES.red.strong];
export const TONE_QUIET: BetaTone = [TONES.grey.ink, TONES.grey.soft];
export const TONE_WAIT: BetaTone = [TONES.amber.ink, TONES.amber.soft];
export const TONE_WAIT_STRONG: BetaTone = [TONES.amber.ink, TONES.amber.strong];
export const TONE_INFO: BetaTone = [TONES.grey.ink, TONES.grey.soft];
export const TONE_ACCENT: BetaTone = [TONES.accent.ink, TONES.accent.soft];

/* Hover, focus and the tab bar cannot be inline styles; the rules are the mockup's styles.css. */
const CSS = `
.bws{color:${BETA.ink};font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px;line-height:1.4}
.bws *{box-sizing:border-box}
.bws h1,.bws h2,.bws h3,.bws p,.bws ol,.bws ul,.bws dl,.bws dd{margin:0}
.bws a{color:${BETA.accent}}
.bws a:focus-visible,.bws button:focus-visible,.bws input:focus-visible,.bws select:focus-visible,.bws textarea:focus-visible,.bws label:has(input.sr:focus-visible),.bws [role=dialog]:focus-visible{outline:3px solid ${BETA.focus};outline-offset:2px}
.bws button:disabled{opacity:.55;cursor:not-allowed}
.bws .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.bws .ws-input{min-height:40px;width:100%;border:1px solid ${BETA.border};border-radius:10px;padding:0 8px;font:inherit;font-size:14px;background:${BETA.field};color:${BETA.ink}}
.bws .ws-input-sm{min-height:38px;width:100%;min-width:0;border:1px solid ${BETA.border};border-radius:10px;padding:0 8px;font:inherit;font-size:14px;background:${BETA.field};color:${BETA.ink}}
@media (max-width:720px){.bws .h1{font-size:22px!important}.bws .tab{padding:0 12px}.bws .chips{display:grid!important;grid-template-columns:minmax(0,1fr)}.bws .chips>*{min-width:0;width:auto!important}}
.bws .pay-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
@media (max-width:1100px){.bws .pay-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.bws .ov-four{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}
@media (max-width:1100px){.bws .ov-four{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.bws .ov-four{grid-template-columns:minmax(0,1fr)}}
.bws .pay-totals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px}
@media (max-width:560px){.bws .pay-grid{gap:8px}.bws .pay-totals{grid-template-columns:minmax(0,1fr)}.bws .pay-totals>div{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;column-gap:8px;padding:10px 14px!important}.bws .pay-totals dd{margin:0!important}.bws .pay-totals dd:nth-of-type(1){font-size:16px!important}.bws .pay-totals dd:nth-of-type(2){grid-column:1/-1}}
.bws .no-bar{scrollbar-width:none}.bws .no-bar::-webkit-scrollbar{display:none}
.bws .tabs{display:flex;flex-wrap:nowrap;gap:4px;border-bottom:1px solid ${BETA.line};background:${BETA.glassSolid};padding:4px 8px 0;border-radius:12px 12px 0 0;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.bws .tabs::-webkit-scrollbar{display:none}
.bws .tab{position:relative;display:flex;flex:none;white-space:nowrap;align-items:center;min-height:44px;padding:0 16px;border:0;border-bottom:3px solid transparent;margin-bottom:-1px;background:transparent;font:inherit;color:${BETA.muted};font-weight:500;cursor:pointer}
.bws .tab:focus:not(:focus-visible){outline:none}
.bws .tab[aria-current="page"]{color:${BETA.ink};font-weight:600}
.bws .tab-ink{position:absolute;left:10px;right:10px;bottom:-3px;height:3px;border-radius:3px 3px 0 0;background:${BETA.selInk}}
.bws .tab:hover{color:${BETA.ink}}
.bws .link{padding:0;border:0;background:transparent;font:inherit;font-size:13px;font-weight:600;color:${BETA.accent};cursor:pointer;text-decoration:underline}
.bws .link:hover{color:${BETA.accentInk}}
/* The picked card (site measure, 3D, 2D): a band of colour that travels round the border. Nothing else moves. */
@property --ang{syntax:"<angle>";inherits:false;initial-value:0deg}
.bws .pickcard-on{border-color:transparent;background:linear-gradient(${BETA.tealSoft},${BETA.tealSoft}) padding-box,linear-gradient(${BETA.surface},${BETA.surface}) padding-box,conic-gradient(from var(--ang),${BETA.accent},${TONES.accent.line},${BETA.accent} 35%,${TONES.accent.dot} 60%,${TONES.accent.line} 80%,${BETA.accent}) border-box}
@media (prefers-reduced-motion:no-preference){
.bws .pickcard-on{animation:bwsspin 3.2s linear infinite}
@keyframes bwsspin{to{--ang:360deg}}
.bws .tab{transition:color .18s}
.bws button:not(.tab):not(.link):not(.mo):not(:disabled){transition:transform .18s cubic-bezier(.2,.8,.2,1),filter .18s}
.bws button:not(.tab):not(.link):not(.mo):not(:disabled):hover{transform:translateY(-1px);filter:brightness(1.05)}
.bws button:not(.tab):not(.link):not(.mo):not(:disabled):active{transform:translateY(0) scale(.97);filter:none}
.bws .ring{position:absolute;inset:0;border-radius:50%;border:2px solid ${BETA.stepNow};animation:bwsring 2.2s ease-out infinite;pointer-events:none}
@keyframes bwsring{0%{transform:scale(1);opacity:.55}100%{transform:scale(1.9);opacity:0}}
}
`;

export function WsStyle(): ReactElement {
  return <style>{CSS}</style>;
}

/** The light and dark values of every Beta colour, and the page backdrop. Every Beta screen renders this once, outside its
    early returns, so a loading line or an error already has its colours. The backdrop goes on while a Beta screen is open
    (a class on <html>), so the other engine pages keep their own page background. */
export function BetaSkin(): ReactElement {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("beta-page");
    return () => root.classList.remove("beta-page");
  }, []);
  return <style>{BETA_SKIN_CSS}</style>;
}

/* ---------- Cards, headings, badges ---------- */

export const cardStyle: CSSProperties = {
  ...GLASS, borderRadius: 20, padding: 20, display: "flex", flexDirection: "column", gap: 14,
};

export const h2Style: CSSProperties = { margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: "-.02em" };
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
    <motion.section variants={RISE} aria-labelledby={id} style={{ ...cardStyle, gap }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={subInline ? { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" } : undefined}>
          <h2 id={id} style={h2Style}>{title}</h2>
          {sub != null && <div style={subStyle}>{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </motion.section>
  );
}

export function WsBadge({ tone, children, size = 12 }: { tone: BetaTone; children: ReactNode; size?: number }): ReactElement {
  return (
    <span style={{ padding: "3px 10px", borderRadius: 999, background: tone[1], color: tone[0], fontSize: size, fontWeight: 600, whiteSpace: "nowrap" }}>{children}</span>
  );
}

/** A page-level section heading (22px) with its sub line and an optional right side, as the Site, Defects and Timeline views open. */
export function WsPageHead({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }): ReactElement {
  return (
    <section style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-.02em" }}>{title}</h2>
        {sub != null && <div style={{ marginTop: 4, fontSize: 13, color: BETA.muted }}>{sub}</div>}
      </div>
      {right}
    </section>
  );
}

export function WsEmpty({ children }: { children: ReactNode }): ReactElement {
  return <div style={{ ...GLASS, padding: 24, textAlign: "center", color: BETA.muted, borderRadius: 20 }}>{children}</div>;
}

/** The mockup's small tag, for example RECORD. */
export function WsTag({ children }: { children: ReactNode }): ReactElement {
  return <span style={{ padding: "1px 6px", borderRadius: 4, background: BETA.avatar, color: "#FFFFFF", fontSize: 10, fontWeight: 700, letterSpacing: ".04em" }}>{children}</span>;
}

/* ---------- Buttons ---------- */

export type WsBtnKind = "dark" | "teal" | "confirm" | "outline" | "amber" | "danger";
export type WsBtnSize = "sm" | "md" | "lg";

const HEIGHT: Record<WsBtnSize, number> = { sm: 36, md: 40, lg: 44 };

export function btnStyle(kind: WsBtnKind, size: WsBtnSize = "md"): CSSProperties {
  const base: CSSProperties = {
    minHeight: HEIGHT[size], padding: size === "sm" ? "0 14px" : size === "md" ? "0 16px" : "0 20px", font: "inherit",
    fontSize: size === "sm" ? 13 : 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, textDecoration: "none",
  };
  /* "dark" and "teal" were the filled main buttons; the designs draw every main action as the blue pill. */
  if (kind === "dark" || kind === "teal") return { ...base, ...PILL_MAIN };
  if (kind === "confirm") return { ...base, ...PILL_CONFIRM };
  if (kind === "amber") return { ...base, border: 0, borderRadius: 999, background: WS.amberBtn, color: "#FFFFFF" };
  if (kind === "danger") return { ...base, ...PILL_GLASS, border: `1px solid ${TONES.red.line}`, color: WS.red };
  return { ...base, ...PILL_GLASS };
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

/** A pill that filters (All, a room, a category): the chosen one is flat ink. */
export function WsFilterPill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }): ReactElement {
  return (
    <motion.button
      type="button"
      className="mo"
      aria-pressed={on}
      onClick={onClick}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.95 }}
      animate={{ scale: on ? [1, 1.08, 1] : 1 }}
      transition={{ duration: 0.28 }}
      style={{
        ...(on ? PILL_SELECTED : PILL_GLASS), minHeight: 36, padding: "0 14px", font: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer",
      }}
    >
      {children}
    </motion.button>
  );
}

/* ---------- Fields ---------- */

export const inputStyle: CSSProperties = {
  minHeight: 40, border: `1px solid ${BETA.border}`, borderRadius: 10, padding: "0 10px", font: "inherit", fontSize: 14, background: BETA.field, width: "100%", color: BETA.ink,
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
    <BetaMotion>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: BETA.scrim, overflowY: "auto", padding: "24px 16px" }}
    >
      <motion.div
        ref={panel}
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98, transition: { duration: 0.15 } }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ maxWidth: wide ? 720 : 520, margin: "0 auto", background: BETA.surface, border: `1px solid ${BETA.glassEdge}`, boxShadow: BETA.glassShadow, borderRadius: 22, padding: 20, display: "flex", flexDirection: "column", gap: 12, color: BETA.ink }}
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
      </motion.div>
    </motion.div>
    </BetaMotion>
  );
}

/* ---------- Small shapes ---------- */

export function WsCheck({ size = 14, stroke = 3 }: { size?: number; stroke?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={stroke} aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
  );
}

export function WsAvatar({ text, size = 30, bg = BETA.avatar, color = "#FFFFFF" }: { text: string; size?: number; bg?: string; color?: string }): ReactElement {
  return (
    <span aria-hidden="true" style={{ flex: "none", width: size, height: size, borderRadius: size / 2, background: bg, color, fontSize: size > 28 ? 11 : 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      {text}
    </span>
  );
}

/** The 36px by 44px PDF tile of the mockup's file rows. */
export function WsPdfTile(): ReactElement {
  return (
    <span aria-hidden="true" style={{ flex: "none", width: 36, height: 44, borderRadius: 4, background: TONES.red.soft, border: `1px solid ${TONES.red.line}`, color: WS.red, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 6 }}>
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
      style={{ padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, background: ok ? TONES.accent.soft : TONES.red.soft, border: `1px solid ${ok ? TONES.accent.line : TONES.red.line}`, color: ok ? WS.green : WS.red }}
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
