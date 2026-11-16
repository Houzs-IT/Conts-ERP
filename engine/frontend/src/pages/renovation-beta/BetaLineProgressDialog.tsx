import { useState, type ReactElement } from "react";
import { Minus, Plus } from "lucide-react";
import { WS, WsBtn, WsDialog, inputStyle } from "./BetaWsUi";
import type { RequirementLine } from "./renovationBetaRequirementsApi";
import { NO_ROOM, clampDoneQty, formatQty } from "./renovationBetaRequirementsModel";
import { BETA } from "./renovationBetaTheme";

interface LineProgressDialogProps {
  line: RequirementLine;
  isSaving: boolean;
  onSave: (doneQty: number) => void;
  onClose: () => void;
}

const stepButtonStyle = { width: 48, height: 48, minWidth: 48, padding: 0, borderRadius: 24 } as const;

export function LineProgressDialog({ line, isSaving, onSave, onClose }: LineProgressDialogProps): ReactElement {
  const [doneQty, setDoneQty] = useState(line.doneQty);
  const changeBy = (step: number): void => setDoneQty((current) => clampDoneQty(current + step, line.qty));
  const isUnchanged = doneQty === line.doneQty;
  return (
    <WsDialog
      title={line.remark ?? line.name}
      sub={`${line.room ?? NO_ROOM} · ${line.itemCode} · qty ${formatQty(line.qty)} ${line.uom.toLowerCase()}`}
      onClose={onClose}
      footer={(
        <>
          <WsBtn size="lg" onClick={onClose}>Cancel</WsBtn>
          <WsBtn kind="dark" size="lg" disabled={isSaving || isUnchanged} onClick={() => onSave(doneQty)}>
            {isSaving ? "Saving" : `Save ${formatQty(doneQty)} of ${formatQty(line.qty)}`}
          </WsBtn>
        </>
      )}
    >
      {line.isTradeClosed && doneQty < line.doneQty && <p style={{ margin: 0, fontSize: 14, color: WS.text2 }}>Saving a lower count reopens this trade.</p>}
      <p style={{ margin: 0, fontSize: 14, color: WS.text2 }}>How many are done?</p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
        <WsBtn style={stepButtonStyle} disabled={doneQty <= 0} onClick={() => changeBy(-1)}>
          <Minus size={20} aria-hidden="true" /><span className="sr">One less</span>
        </WsBtn>
        <label style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="sr">Units done</span>
          <input type="number" inputMode="decimal" min={0} max={line.qty} step={1} value={doneQty}
            onChange={(event) => setDoneQty(clampDoneQty(Number(event.target.value), line.qty))}
            style={{ ...inputStyle, width: 96, minHeight: 48, fontSize: 24, fontWeight: 700, textAlign: "center" }} />
          <span style={{ fontSize: 15, color: BETA.muted, whiteSpace: "nowrap" }}>of {formatQty(line.qty)}</span>
        </label>
        <WsBtn style={stepButtonStyle} disabled={doneQty >= line.qty} onClick={() => changeBy(1)}>
          <Plus size={20} aria-hidden="true" /><span className="sr">One more</span>
        </WsBtn>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
        <WsBtn size="lg" onClick={() => setDoneQty(line.qty)}>All {formatQty(line.qty)} done</WsBtn>
        <WsBtn size="lg" onClick={() => setDoneQty(0)}>None</WsBtn>
      </div>
    </WsDialog>
  );
}
