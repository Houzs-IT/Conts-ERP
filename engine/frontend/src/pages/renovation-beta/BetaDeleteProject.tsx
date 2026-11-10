/* Delete a project opened by mistake (chew, 10 Nov 2026: "我要我能删除，刚刚不小心开错了"). The workspace header shows
   it to those who manage projects while the project has no contract. The server still refuses once anything is
   made on the project and says what is there (backend services/renovation/deleteProject.ts); that answer shows in
   the page's notice. A deleted project leaves for the project list. */

import { useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useDialog } from "../../hooks/useDialog";
import { useToast } from "../../hooks/useToast";
import { errorText } from "../projects/renovation/renovationModel";
import { simpleApi } from "../projects/renovation/simpleApi";
import { btnStyle } from "./BetaWsUi";
import { forgetLastProject, invalidateBeta } from "./renovationBetaBoardApi";

export function DeleteProjectButton({ project, onError }: {
  project: { id: number; code: string | null; name: string };
  onError: (text: string) => void;
}): ReactElement {
  const dialog = useDialog();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const label = project.code || project.name;

  async function remove(): Promise<void> {
    const ok = await dialog.confirm({
      title: `Delete ${label}?`,
      message: `${project.name} is deleted with its stages, checklist, notes and photos. This cannot be undone.`,
      confirmLabel: "Delete project",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await simpleApi.deleteProject(project.id);
    } catch (e) {
      setBusy(false);
      onError(errorText(e));
      return;
    }
    forgetLastProject();
    navigate("/beta/projects", { replace: true });
    toast.success(`${label} deleted.`);
    void invalidateBeta(queryClient);
  }

  return (
    <button type="button" onClick={() => void remove()} disabled={busy} style={{ ...btnStyle("danger"), opacity: busy ? 0.6 : 1 }}>
      <Trash2 size={16} aria-hidden="true" />
      {busy ? "Deleting…" : "Delete project"}
    </button>
  );
}
