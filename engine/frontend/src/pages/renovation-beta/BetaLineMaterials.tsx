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
  const add = (text: string): void => {
    setSearch(text);
    const s = skus.find((x) => label(x) === text || x.code === text);
    if (!s || rows.some((r) => r.code === s.code)) return;
    setRows((x) => [...x, { code: s.code, name: s.name, uom: s.uom, qty: 1 }]);
    setSearch("");
  };
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
        <label style={{ display: "block", marginTop: 10 }}>
          <span style={metaStyle}>Add a raw material</span>
          <input aria-label="Add a raw material" list={`line-materials-${line.id}`} value={search} placeholder="Search raw materials" style={{ ...inputStyle, width: "100%" }} onChange={(e) => add(e.target.value)} />
          <datalist id={`line-materials-${line.id}`}>
            {skus.filter((s) => !rows.some((r) => r.code === s.code)).map((s) => <option key={s.code} value={label(s)} />)}
          </datalist>
        </label>
      )}
      {!canEdit && (line.materials ?? []).length > 0 && <p style={{ ...metaStyle, margin: "8px 0 0" }}>Change these on the production order.</p>}
      {error && <p role="alert" style={{ margin: "8px 0 0", fontSize: 13, color: WS.red }}>{error}</p>}
    </WsDialog>
  );
}
