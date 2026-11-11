// Delete project on the workspace header (chew, 10 Nov 2026: "我要我能删除，刚刚不小心开错了"). What is pinned:
//   • it asks first, naming the project; saying no changes nothing;
//   • a deleted project leaves for the project list, is no longer the "last project", and a notice says so;
//   • a refusal (the project already has documents) shows the server's words and stays on the page.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const confirm = vi.fn(async (_o: unknown) => true);
vi.mock("../../hooks/useDialog", () => ({ useDialog: () => ({ confirm }) }));
const success = vi.fn();
vi.mock("../../hooks/useToast", () => ({ useToast: () => ({ success, error: vi.fn(), info: vi.fn(), warning: vi.fn(), show: vi.fn() }) }));
const deleteProject = vi.fn(async (_id: number) => ({ ok: true as const, code: "RN-2611-015", name: "ASTRUM R-54-16" }));
vi.mock("../projects/renovation/simpleApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../projects/renovation/simpleApi")>()),
  simpleApi: { deleteProject: (id: number) => deleteProject(id) },
}));
const forgetLastProject = vi.fn();
const invalidateBeta = vi.fn(async () => {});
vi.mock("./renovationBetaBoardApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./renovationBetaBoardApi")>()),
  forgetLastProject: () => forgetLastProject(),
  invalidateBeta: () => invalidateBeta(),
}));

import { DeleteProjectButton } from "./BetaDeleteProject";

function show(onError = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/beta/projects/326"]}>
        <Routes>
          <Route path="/beta/projects/:id" element={<DeleteProjectButton project={{ id: 326, code: "RN-2611-015", name: "ASTRUM R-54-16" }} onError={onError} />} />
          <Route path="/beta/projects" element={<p>Project list</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onError };
}

beforeEach(() => {
  for (const f of [confirm, success, deleteProject, forgetLastProject, invalidateBeta]) f.mockClear();
  confirm.mockResolvedValue(true);
});

describe("Delete project", () => {
  test("asks first, naming the project; then deletes it and goes to the project list", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    await waitFor(() => expect(screen.getByText("Project list")).toBeTruthy());
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Delete RN-2611-015?", confirmLabel: "Delete project", danger: true }));
    expect(deleteProject).toHaveBeenCalledWith(326);
    expect(forgetLastProject).toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith("RN-2611-015 deleted.");
    expect(invalidateBeta).toHaveBeenCalled();
  });

  test("saying no changes nothing", async () => {
    confirm.mockResolvedValue(false);
    show();
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(deleteProject).not.toHaveBeenCalled();
    expect(screen.queryByText("Project list")).toBeNull();
  });

  test("a refusal shows the server's words and stays on the page", async () => {
    const words = "RN-2611-015 already has a quotation, so it cannot be deleted. Only a project with nothing made on it can be deleted.";
    deleteProject.mockRejectedValueOnce(Object.assign(new Error("409"), { rawBody: JSON.stringify({ error: "project_has_documents", message: words, documents: [{ label: "quotation", count: 1 }] }) }));
    const { onError } = show();
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(words));
    expect(screen.queryByText("Project list")).toBeNull();
    expect(forgetLastProject).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Delete project" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
