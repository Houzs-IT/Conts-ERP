import { createContext, useContext, useEffect, useState, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthContext";
import { errorText } from "../projects/renovation/renovationModel";
import { invalidateBeta } from "./renovationBetaBoardApi";
import { WS, WsBadge, WsBtn, TONE_DONE } from "./BetaWsUi";
import { LineProgressDialog } from "./BetaLineProgressDialog";
import { requirementsApi, type RequirementLine } from "./renovationBetaRequirementsApi";
import { formatQty, isLineDone, lineProgressText } from "./renovationBetaRequirementsModel";
import { dayMonth } from "./renovationBetaModel";
import { BETA } from "./renovationBetaTheme";

const UNDO_WINDOW_MILLISECONDS = 8_000;

interface SavedProgress {
  lineId: string;
  lineLabel: string;
  previousDoneQty: number;
  doneQty: number;
  qty: number;
  hasClosedTrade: boolean;
}

export interface LineProgressControls {
  canUpdate: boolean;
  openLine: (line: RequirementLine) => void;
}

export const LineProgressContext = createContext<LineProgressControls>({ canUpdate: false, openLine: () => undefined });

export interface LineProgressState extends LineProgressControls {
  editingLine: RequirementLine | null;
  isSaving: boolean;
  error: string | null;
  saved: SavedProgress | null;
  save: (doneQty: number) => void;
  undo: () => void;
  closeEditor: () => void;
  dismissSaved: () => void;
}

const lineLabelOf = (line: RequirementLine): string => line.remark ?? line.name;

export function useLineProgress(isReady: boolean): LineProgressState {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [editingLine, setEditingLine] = useState<RequirementLine | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedProgress | null>(null);

  useEffect(() => {
    if (!saved || saved.hasClosedTrade) return undefined;
    const timer = window.setTimeout(() => setSaved(null), UNDO_WINDOW_MILLISECONDS);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const send = async (lineId: string, doneQty: number): Promise<{ previousDoneQty: number; completedTaskIds: number[] }> => {
    const answer = await requirementsApi.setProgress(lineId, doneQty);
    await invalidateBeta(queryClient);
    return answer;
  };

  const save = async (line: RequirementLine, doneQty: number): Promise<void> => {
    setIsSaving(true);
    setError(null);
    try {
      const { previousDoneQty, completedTaskIds } = await send(line.id, doneQty);
      setSaved({ lineId: line.id, lineLabel: lineLabelOf(line), previousDoneQty, doneQty, qty: line.qty, hasClosedTrade: completedTaskIds.length > 0 });
      setEditingLine(null);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setIsSaving(false);
    }
  };

  const undo = async (undone: SavedProgress): Promise<void> => {
    setSaved(null);
    setError(null);
    try {
      await send(undone.lineId, undone.previousDoneQty);
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  return {
    canUpdate: isReady && can("projects.write"),
    openLine: (line) => { setError(null); setEditingLine(line); },
    editingLine,
    isSaving,
    error,
    saved,
    save: (doneQty) => { if (editingLine) void save(editingLine, doneQty); },
    undo: () => { if (saved) void undo(saved); },
    closeEditor: () => setEditingLine(null),
    dismissSaved: () => setSaved(null),
  };
}

export function LineProgressCell({ line }: { line: RequirementLine }): ReactElement | null {
  const { canUpdate, openLine } = useContext(LineProgressContext);
  const isDone = isLineDone(line);
  const share = line.qty > 0 ? Math.min(1, line.doneQty / line.qty) : 0;
  if (!canUpdate && line.doneQty === 0) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", maxWidth: "100%" }}>
      {isDone
        ? <WsBadge tone={TONE_DONE}>Done {dayMonth(line.doneAt)}</WsBadge>
        : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: WS.text2, whiteSpace: "nowrap" }}>
            <span aria-hidden="true" style={{ width: 56, height: 6, borderRadius: 3, background: BETA.line, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${share * 100}%`, background: WS.green }} />
            </span>
            {lineProgressText(line)} done
          </span>
        )}
      {canUpdate && <WsBtn size="lg" onClick={() => openLine(line)} style={{ minHeight: 44 }}>Update</WsBtn>}
    </span>
  );
}

function savedText(saved: SavedProgress): string {
  if (saved.hasClosedTrade) return `${saved.lineLabel}: all done. Every line of its trade is done, so the site task is closed.`;
  return `${saved.lineLabel}: ${formatQty(saved.doneQty)} of ${formatQty(saved.qty)} done`;
}

export function LineProgressLayer({ progress }: { progress: LineProgressState }): ReactElement {
  const { editingLine, isSaving, error, saved } = progress;
  return (
    <>
      {editingLine && <LineProgressDialog key={editingLine.id} line={editingLine} isSaving={isSaving} onSave={progress.save} onClose={progress.closeEditor} />}
      {error && <p role="alert" style={{ margin: 0, fontSize: 14, color: WS.red }}>That change did not save: {error}</p>}
      {saved && (
        <div role="status" style={{
          position: "fixed", left: 16, right: 16, bottom: 88, zIndex: 50, margin: "0 auto", maxWidth: 520, display: "flex", alignItems: "center", gap: 12,
          padding: "8px 8px 8px 16px", borderRadius: 14, background: BETA.ink, color: BETA.surface, fontSize: 14, boxShadow: BETA.glassShadow,
        }}>
          <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{savedText(saved)}</span>
          {saved.hasClosedTrade
            ? <WsBtn size="lg" onClick={progress.dismissSaved}>OK</WsBtn>
            : <WsBtn size="lg" onClick={progress.undo}>Undo</WsBtn>}
        </div>
      )}
    </>
  );
}
