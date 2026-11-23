/* All projects > Design > Variants as a list of SKUs (owner, 20 Nov 2026: "应该直接 show SKU 然后我填写就跳不见了, project 是我们的
   column, 好像 SO details listing 那样"). One row per sales order line still missing a required variant, the project as a
   column. Pick variants opens the SO tab's own picker and saves on the line (renovation-so-info spec route, no VO);
   once every required field is picked the board reloads and the row is gone. */

import { useState, type CSSProperties, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { DataTable } from "../../components/DataTable";
import type { Column } from "../../components/dataTableTypes";
import { authedFetch } from "../../vendor/scm/lib/authed-fetch";
import { RenovationVariantPicker } from "../../vendor/scm/components/renovationVariantPicker";
import { WsDialog, btnStyle } from "./BetaWsUi";
import { BETA, TONES, betaTagTone } from "./renovationBetaTheme";
import { rememberLastProject } from "./renovationBetaBoardApi";
import { refusalText } from "./renovationBetaLines";
import type { DesignProject, VariantPending } from "./renovationBetaBoard";

export interface VariantRow {
  key: string;
  p: DesignProject;
  line: VariantPending & { id: string; docNo: string };
}

/** Every line still to pick across the projects shown, in the projects' order. */
export function variantRows(projects: readonly DesignProject[]): VariantRow[] {
  return projects.flatMap((p) => p.variants.pending
    .filter((l): l is VariantPending & { id: string; docNo: string } => !!l.id && !!l.docNo)
    .map((line) => ({ key: `${p.id}:${line.id}`, p, line })));
}

const MUTED = BETA.muted;

function columns(onPick: (r: VariantRow) => void, canWrite: boolean): Column<VariantRow>[] {
  return [
    { key: "project", label: "Project", width: "260px", getValue: (r) => r.p.title, render: (r) => (
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3, minWidth: 0 }}>
        <Link to={`/beta/projects/${r.p.id}?tab=po`} onClick={() => rememberLastProject(r.p.id)} style={{ color: BETA.ink, textDecoration: "none", fontWeight: 600, overflowWrap: "anywhere" }}>{r.p.title}</Link>
        {r.p.customer && <span style={{ color: MUTED, fontSize: 12, overflowWrap: "anywhere" }}>{r.p.customer}</span>}
      </span>
    ) },
    { key: "building", label: "Building", width: "150px", defaultHidden: true, getValue: (r) => r.p.tag, render: (r) => {
      const [ink, bg] = betaTagTone(r.p.tag);
      return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, background: bg, color: ink, fontSize: 12, fontWeight: 600 }}>{r.p.tag.toUpperCase()}</span>;
    } },
    { key: "so", label: "SO", width: "140px", getValue: (r) => r.line.docNo, render: (r) => <span style={{ fontSize: 13 }}>{r.line.docNo}</span> },
    { key: "sku", label: "SKU", width: "200px", getValue: (r) => r.line.itemCode, render: (r) => <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{r.line.itemCode}</span> },
    { key: "description", label: "Description", width: "280px", getValue: (r) => r.line.description, render: (r) => <span style={{ overflowWrap: "anywhere" }}>{r.line.description ?? "-"}</span> },
    { key: "missing", label: "To pick", width: "200px", getValue: (r) => r.line.missing.join(", "), render: (r) => (
      <span style={{ color: TONES.amber.ink, fontWeight: 600 }}>{r.line.missing.join(", ")}</span>
    ) },
    { key: "pick", label: "", width: "140px", getValue: () => "", render: (r) => (canWrite
      ? <button type="button" onClick={(e) => { e.stopPropagation(); onPick(r); }} style={btnStyle("teal")}>Pick variants</button>
      : <span style={{ color: MUTED, fontSize: 12 }}>View only</span>) },
  ];
}

export function VariantsSkuList({ projects, canWrite, cardStyle, onSaved }: {
  projects: readonly DesignProject[]; canWrite: boolean; cardStyle: CSSProperties; onSaved: () => void;
}): ReactElement {
  const rows = variantRows(projects);
  const [picking, setPicking] = useState<VariantRow | null>(null);
  // The dialog sits outside the card: the card clips its overflow, which cut the dialog in half.
  return (
    <>
      <div style={cardStyle}>
      <DataTable<VariantRow>
        tableId="projects-home-variants-skus"
        documentLabel="Variants to pick"
        rows={rows}
        columns={columns(setPicking, canWrite)}
        getRowKey={(r) => r.key}
        onRowClick={canWrite ? setPicking : undefined}
        emptyLabel="Every SKU has its variants picked."
      />
      </div>
      {picking && <PickDialog row={picking} onClose={() => setPicking(null)} onSaved={() => { setPicking(null); onSaved(); }} />}
    </>
  );
}

function PickDialog({ row, onClose, onSaved }: { row: VariantRow; onClose: () => void; onSaved: () => void }): ReactElement {
  const { line } = row;
  const [variants, setVariants] = useState<Record<string, unknown>>(line.variants ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/renovation-so-info/${encodeURIComponent(line.docNo)}/lines/${encodeURIComponent(line.id)}/spec`, {
        method: "PUT", body: JSON.stringify({ variants }),
      });
      onSaved();
    } catch (e) {
      setError(refusalText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <WsDialog title={`Variants: ${line.itemCode}`} sub={`${row.p.title} · ${line.docNo}${line.description ? ` · ${line.description}` : ""}`} onClose={onClose} wide
      footer={
        <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={btnStyle("outline")} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" style={btnStyle("teal")} onClick={() => void save()} disabled={busy}>{busy ? "Saving..." : "Save"}</button>
        </span>
      }>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <RenovationVariantPicker category={line.category ?? ""} itemCode={line.itemCode} variants={variants}
          onPatch={(patch) => setVariants((v) => ({ ...v, ...patch }))} />
        <p style={{ margin: 0, fontSize: 13, color: MUTED }}>Saves on the sales order line, as the project's SO tab does. The row leaves this list once every required field is picked.</p>
        {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: TONES.red.ink }}>{error}</p>}
      </div>
    </WsDialog>
  );
}
