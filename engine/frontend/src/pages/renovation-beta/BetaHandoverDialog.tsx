/* Handover (owner, 7 Nov 2026): the customer signs and takes the keys. Unfinished tasks do not stop it, they stay open; only
   an open defect does, because the server refuses until every defect is closed. */

import { useRef, useState, type ReactElement } from "react";
import { renovationApi } from "../projects/renovation/renovationApi";
import { errorText } from "../projects/renovation/renovationModel";
import { SignaturePad, canvasBlob } from "../projects/renovation/renovationUi";
import { WS, WsDialog, WsField, btnStyle, inputStyle } from "./BetaWsUi";
import { useGuarded } from "./betaShared";

interface Props { projectId: number; customerName: string | null; onClose: () => void; onDone: (text: string) => void }

export function BetaHandoverDialog({ projectId, customerName, onClose, onDone }: Props): ReactElement {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [signer, setSigner] = useState(customerName ?? "");
  const [keys, setKeys] = useState("");
  const [signed, setSigned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useGuarded();
  const save = (): Promise<void> => run(async () => {
    setError(null);
    try {
      if (!canvas.current) return;
      const { key } = await renovationApi.upload(projectId, "handover", await canvasBlob(canvas.current));
      await renovationApi.handover(projectId, { customerSignerName: signer.trim(), customerSignatureR2Key: key, keysReturned: keys === "" ? undefined : Number(keys) });
      onDone("Handed over. The project moves to Closed once the last payment is in.");
    } catch (e) {
      setError(errorText(e));
    }
  });
  return (
    <WsDialog title="Hand over to the customer" sub="Tasks not finished yet stay open" onClose={onClose}
      footer={(
        <>
          <button type="button" style={btnStyle("outline")} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" style={btnStyle("teal")} disabled={busy || !signed || !signer.trim()} onClick={() => void save()}>{busy ? "Saving..." : "Hand over"}</button>
        </>
      )}>
      <WsField label="Signed by"><input value={signer} style={inputStyle} onChange={(e) => setSigner(e.target.value)} /></WsField>
      <WsField label="Keys handed over"><input type="number" min="0" value={keys} style={inputStyle} onChange={(e) => setKeys(e.target.value)} /></WsField>
      <SignaturePad canvasRef={canvas} onChange={setSigned} label="Customer signature" />
      {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: WS.red }}>{error}</p>}
    </WsDialog>
  );
}
