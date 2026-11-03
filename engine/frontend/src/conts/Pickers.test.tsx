import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The project and unit pickers (chew 2 Nov 2026: 打关键字眼找 project, 做成 table). Pinned: typing narrows the table;
// clicking a row picks it; completed projects stay pickable under their own heading; the button shows the name
// without "SO - ".
vi.mock("./projectLimitQueries", () => ({
  useProjectOptions: () => ({ isLoading: false, data: { projects: [
    { id: 7, code: "RN-2607-003", name: "ASTER HILL A-08-11 MS AMANDA", customer_name: "MS AMANDA", contract_status: "RENO_IN_PROGRESS", planned_handover_date: "2026-11-25", handed_over_at: null, created_at: "2026-07-03T00:00:00Z", done: false, funding: "customer" },
    { id: 8, code: "RN-2608-003", name: "BARON C-20-08 MR ALBERT", customer_name: "MR ALBERT", contract_status: "RENO_COMPLETED", planned_handover_date: null, handed_over_at: "2026-10-20T04:00:00Z", created_at: "2026-08-03T00:00:00Z", done: true, funding: "customer" },
    { id: 9, code: "RN-2610-007", name: "SO - THE HIPSTER C10-05 MS IRIS", customer_name: null, contract_status: "RENO_CONFIRMED", planned_handover_date: null, handed_over_at: null, created_at: "2026-10-07T00:00:00Z", done: false, funding: "customer" },
  ] } }),
  useUnitOptions: () => ({ isLoading: false, data: { units: [{ id: "u-a31", building: "ASTER HILL", unitNumber: "A-3-1" }, { id: "u-b", building: "BARON", unitNumber: "C-20-08" }] } }),
}));
vi.mock("../vendor/scm/components/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div role="dialog" data-testid="modal">{children}</div> }));

import { ProjectPicker, UnitPicker } from "./Pickers";

describe("ProjectPicker", () => {
  it("typing narrows the table; clicking a row picks it", () => {
    const onChange = vi.fn();
    render(<ProjectPicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    /* The heading, and the completed project's own status. */
    expect(screen.getAllByText("Completed")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "amanda" } });
    expect(screen.queryByText("BARON C-20-08 MR ALBERT")).toBeNull();
    fireEvent.click(screen.getByText("ASTER HILL A-08-11 MS AMANDA"));
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("a completed project is still pickable", () => {
    const onChange = vi.fn();
    render(<ProjectPicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    fireEvent.click(screen.getByText("BARON C-20-08 MR ALBERT"));
    expect(onChange).toHaveBeenCalledWith(8);
  });

  it("shows the chosen project without SO -", () => {
    render(<ProjectPicker value={9} onChange={() => undefined} />);
    expect(screen.getByRole("button", { name: "Project" }).textContent).toBe("THE HIPSTER C10-05 MS IRIS · RN-2610-007");
  });
});

describe("UnitPicker", () => {
  it("finds a unit by its number", () => {
    const onChange = vi.fn();
    render(<UnitPicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Unit" }));
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "a-3-1" } });
    expect(screen.queryByText("C-20-08")).toBeNull();
    fireEvent.click(screen.getByText("A-3-1"));
    expect(onChange).toHaveBeenCalledWith("u-a31");
  });
});

// chew 3 Nov 2026: "可以不可以把选project or unit 做成这样" (AutoCount's Proj. No. list), "可能是往下显示". The list drops
// down under the field instead of a box in the middle of the screen; the keyboard works it like AutoCount's.
describe("the drop-down", () => {
  afterEach(() => { cleanup(); Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 }); });

  it("opens under the field, not as a centred box, with the search ready to type in", () => {
    render(<ProjectPicker value={null} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    expect(screen.queryByTestId("modal")).toBeNull();
    const panel = screen.getByRole("dialog", { name: "Choose a project" });
    expect(panel.style.position).toBe("fixed");
    expect(document.activeElement).toBe(screen.getByLabelText("Search"));
  });

  it("arrow keys move the highlight and Enter picks it", () => {
    const onChange = vi.fn();
    render(<ProjectPicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    const search = screen.getByLabelText("Search");
    /* Rows in order: THE HIPSTER (newest open), ASTER HILL (open), BARON (completed). */
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(7);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("starts on the chosen row, and Enter after typing picks the first match", () => {
    const onChange = vi.fn();
    render(<ProjectPicker value={8} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    expect(screen.getByRole("option", { selected: true }).textContent).toContain("BARON");
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "iris" } });
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(9);
  });

  it("Esc or a click outside closes it without picking", () => {
    const onChange = vi.fn();
    render(<UnitPicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Unit" }));
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unit" }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Clear at the bottom empties the field", () => {
    const onChange = vi.fn();
    render(<UnitPicker value="u-b" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Unit" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Esc anywhere in the list closes only the list, and keys never reach the screen behind it", () => {
    const behind = vi.fn();
    render(<div onKeyDown={behind}><UnitPicker value={null} onChange={() => undefined} /></div>);
    fireEvent.click(screen.getByRole("button", { name: "Unit" }));
    fireEvent.keyDown(screen.getByText("Building"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unit" }));
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "Insert" });
    expect(behind).not.toHaveBeenCalled();
  });

  it("after picking, the field has the focus again", () => {
    render(<UnitPicker value={null} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Unit" }));
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Unit" }));
  });

  it("clicking the field again closes the list", () => {
    render(<UnitPicker value={null} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Unit" }));
    fireEvent.click(screen.getByRole("button", { name: "Unit" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("on a phone it opens as the full box instead", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    render(<UnitPicker value={null} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Unit" }));
    expect(screen.getByTestId("modal")).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "Enter" });
    expect(screen.queryByTestId("modal")).toBeNull();
  });
});
