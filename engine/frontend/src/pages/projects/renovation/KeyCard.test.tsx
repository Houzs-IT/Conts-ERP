import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  keyLog: vi.fn(),
  addKeyMove: vi.fn(),
  editKeyMove: vi.fn(),
  deleteKeyMove: vi.fn(),
  people: vi.fn(),
}));
vi.mock("./simpleApi", () => ({ simpleApi: api }));
vi.mock("../../../hooks/useDialog", () => ({ useDialog: () => ({ confirm: vi.fn(async () => true) }) }));
vi.mock("../../../hooks/useQuery", async () => {
  const React = await import("react");
  return {
    useQuery: (_key: unknown, fn: () => Promise<unknown>) => {
      const [state, setState] = React.useState<{ data: unknown; loading: boolean }>({ data: null, loading: true });
      const load = React.useCallback(() => void fn().then((d) => setState({ data: d, loading: false })), [fn]);
      React.useEffect(() => { load(); }, []);
      return { ...state, error: null, fetching: false, placeholder: false, reload: load };
    },
  };
});

import { KeyCard } from "./ProjectRecords";
import type { ProjectDetailV2 } from "./simpleApi";
import { keyDraftRefusal } from "./keyLog";

const detail = { project: { id: 7 }, keyHolder: null } as unknown as ProjectDetailV2;
const people = [{ id: 1, name: "Alex", roles: ["reno_pic"], active: true }, { id: 2, name: "ZAINAL", roles: ["site_crew"], active: true }];

beforeEach(() => {
  vi.clearAllMocks();
  api.people.mockResolvedValue({ data: people });
  api.keyLog.mockResolvedValue({ data: [{ id: 5, project_id: 7, moved_on: "2026-10-01", from_person_id: null, from_person_name: null, to_person_id: 1, to_person_name: "Alex", note: null, recorded_by_name: null }] });
  api.addKeyMove.mockResolvedValue({ id: 6 });
  api.editKeyMove.mockResolvedValue({ ok: true });
  api.deleteKeyMove.mockResolvedValue({ ok: true });
});

describe("unit key card", () => {
  it("Add is never silently dead: without a receiver it says so in the card and sends nothing", async () => {
    render(<KeyCard d={detail} canWrite onDone={() => {}} />);
    await screen.findByText("Alex", { selector: "td" });
    fireEvent.click(screen.getByRole("button", { name: "Record key pass" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Pick who received the key.");
    expect(api.addKeyMove).not.toHaveBeenCalled();
  });

  it("adds a key pass with only the receiver, and shows the server's refusal in the card", async () => {
    const onDone = vi.fn();
    render(<KeyCard d={detail} canWrite onDone={onDone} />);
    fireEvent.click(await screen.findByRole("button", { name: "Record key pass" }));
    const to = await screen.findByLabelText("New key pass received by");
    await waitFor(() => expect((to as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(to, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(api.addKeyMove).toHaveBeenCalledWith(7, expect.objectContaining({ fromPersonId: null, toPersonId: 2 })));
    expect((await screen.findByRole("status")).textContent).toBe("Key pass recorded.");
    expect(onDone).toHaveBeenCalled();

    api.addKeyMove.mockRejectedValueOnce(new Error("A key move cannot be in the future."));
    fireEvent.click(screen.getByRole("button", { name: "Record key pass" }));
    await waitFor(() => expect((screen.getByLabelText("New key pass received by") as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("New key pass received by"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect((await screen.findByRole("alert")).textContent).toContain("cannot be in the future");
  });

  it("edits and deletes an existing key pass", async () => {
    render(<KeyCard d={detail} canWrite onDone={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Edit key pass of/ }));
    const to = screen.getByLabelText("Edit key pass received by");
    await waitFor(() => expect((to as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(to, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.editKeyMove).toHaveBeenCalledWith(5, { movedOn: "2026-10-01", fromPersonId: null, toPersonId: 2 }));
    fireEvent.click(await screen.findByRole("button", { name: /Delete key pass of/ }));
    await waitFor(() => expect(api.deleteKeyMove).toHaveBeenCalledWith(5));
  });
});

describe("record key pass form", () => {
  it("opens from the button with Passed by prefilled with the current holder, and closes on Cancel", async () => {
    const withHolder = { project: { id: 7 }, keyHolder: { personId: 1, name: "Alex", movedOn: "2026-10-01" } } as unknown as ProjectDetailV2;
    render(<KeyCard d={withHolder} canWrite onDone={() => {}} />);
    expect(screen.queryByLabelText("New key pass date")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Record key pass" }));
    const from = screen.getByLabelText("New key pass passed by") as HTMLSelectElement;
    await waitFor(() => expect(from.value).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("New key pass date")).toBeNull();
  });
  it("is open from the start when no key pass was ever recorded", async () => {
    api.keyLog.mockResolvedValue({ data: [] });
    render(<KeyCard d={detail} canWrite onDone={() => {}} />);
    expect(await screen.findByLabelText("New key pass date")).toBeTruthy();
  });
});

describe("key pass rules on the screen", () => {
  it("needs a date not in the future and a receiver, never the same person twice", () => {
    expect(keyDraftRefusal({ on: "2026-10-10", from: null, to: 2 }, "2026-10-14")).toBeNull();
    expect(keyDraftRefusal({ on: "", from: null, to: 2 }, "2026-10-14")).toMatch(/date/);
    expect(keyDraftRefusal({ on: "2026-10-15", from: null, to: 2 }, "2026-10-14")).toMatch(/future/);
    expect(keyDraftRefusal({ on: "2026-10-10", from: 1, to: null }, "2026-10-14")).toMatch(/received/);
    expect(keyDraftRefusal({ on: "2026-10-10", from: 2, to: 2 }, "2026-10-14")).toMatch(/same person/);
  });
});
