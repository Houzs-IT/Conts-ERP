/* The raw materials of one SO line (owner, 5 Nov 2026): preset from the SKU's composition times the line's qty, changed
   here for this line. When the line reaches a production order they come with it. Read-only once a live PO holds it. */

import { useEffect, useState, type ReactElement } from "react";
import { Trash2 } from "lucide-react";
import { WS, WsDialog, btnStyle, inputStyle } from "./BetaWsUi";
import { metaStyle } from "./BetaVoPoUi";
import { linesApi, refusalText, type LineMaterial, type ManagedLine, type RawMaterialSku } from "./renovationBetaLines";

interface Props {
  projectId: number;
  line: ManagedLine;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function BetaLineMaterials({ projectId, line, canEdit, onClose, onSaved }: Props): ReactElement {
  const [rows, setRows] = useState<LineMaterial[]>(line.materials ?? []);
  const [skus, setSkus] = useState<RawMaterialSku[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canEdit) return;
    let live = true;
    linesApi.rawMaterials().then((r) => { if (live) setSkus(r.skus); }).catch((e: unknown) => { if (live) setError(refusalText(e)); });
    return () => { live = false; };
  }, [canEdit]);

  const label = (s: RawMaterialSku): string => (s.name ? `${s.code} · ${s.name}` : s.code);
  const toggle = (s: RawMaterialSku): void => setRows((x) => (x.some((r) => r.code === s.code)
    ? x.filter((r) => r.code !== s.code)
    : [...x, { code: s.code, name: s.name, uom: s.uom, qty: 1 }]));
  const term = search.trim().toLowerCase();
  const shown = skus.filter((s) => !term || label(s).toLowerCase().includes(term));
  const valid = rows.every((r) => r.qty > 0);
  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await linesApi.saveMaterials(projectId, line.id, rows.map((r) => ({ code: r.code, qty: r.qty })));
      onSaved();
    } catch (e) {
      setError(refusalText(e));
      setSaving(false);
    }
  };

  return (
    <WsDialog
      title={`Raw materials: ${line.itemCode}`}
      sub={`${line.description} · qty ${line.qty}`}
      onClose={onClose}
      wide
      footer={canEdit ? (
        <>
          <button type="button" style={btnStyle("outline")} disabled={saving} onClick={onClose}>Cancel</button>
          <button type="button" style={btnStyle("teal")} disabled={saving || !valid} onClick={() => void save()}>{saving ? "Saving..." : "Save"}</button>
        </>
      ) : <button type="button" style={btnStyle("outline")} onClick={onClose}>Close</button>}
    >
      {rows.length === 0 && <p style={{ ...metaStyle, margin: 0 }}>No raw material on this line yet.</p>}
      {rows.map((r) => (
        <div key={r.code} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${WS.rowLine}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, fontWeight: 600 }}>{r.code}</div>
            <div style={{ ...metaStyle }}>{r.name}</div>
          </div>
          {canEdit ? (
            <input aria-label={`Quantity of ${r.code}`} type="number" min="0" step="any" value={Number.isNaN(r.qty) ? "" : r.qty} style={{ ...inputStyle, width: 84, textAlign: "right" }}
              onChange={(e) => { const qty = e.target.value === "" ? Number.NaN : Number(e.target.value); setRows((x) => x.map((y) => (y.code === r.code ? { ...y, qty } : y))); }} />
          ) : <span style={{ fontSize: 13 }}>{r.qty}</span>}
          <span style={{ ...metaStyle, width: 40 }}>{r.uom ?? ""}</span>
          {canEdit && (
            <button type="button" aria-label={`Remove ${r.code}`} onClick={() => setRows((x) => x.filter((y) => y.code !== r.code))}
              style={{ background: "none", border: "none", cursor: "pointer", color: WS.text2, padding: 4 }}><Trash2 size={14} aria-hidden="true" /></button>
          )}
        </div>
      ))}
      {canEdit && (
        <div style={{ marginTop: 10 }}>
          <label style={{ display: "block" }}>
            <span style={metaStyle}>Add raw materials: tick as many as you need</span>
            <input aria-label="Search raw materials" value={search} placeholder="Search raw materials" style={{ ...inputStyle, width: "100%" }} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div role="group" aria-label="Raw materials" style={{ maxHeight: 220, overflowY: "auto", marginTop: 6, border: `1px solid ${WS.rowLine}`, borderRadius: 8 }}>
            {shown.map((s) => (
              <label key={s.code} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer", fontSize: 13 }}>
                <input type="checkbox" checked={rows.some((r) => r.code === s.code)} onChange={() => toggle(s)} />
                <span style={{ minWidth: 0 }}>{label(s)}</span>
              </label>
            ))}
            {shown.length === 0 && <p style={{ ...metaStyle, margin: 0, padding: "6px 10px" }}>No raw material matches.</p>}
          </div>
        </div>
      )}
      {!canEdit && (line.materials ?? []).length > 0 && <p style={{ ...metaStyle, margin: "8px 0 0" }}>Change these on the production order.</p>}
      {error && <p role="alert" style={{ margin: "8px 0 0", fontSize: 13, color: WS.red }}>{error}</p>}
    </WsDialog>
  );
}
