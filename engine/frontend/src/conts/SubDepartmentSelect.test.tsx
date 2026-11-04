import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

// The sub-department picker on bill, journal and receipt lines (SOP 1.1; chew 4 Nov 2026): grouped by Rental,
// Renovation and Company; picking one sets the line's department too; a retired one shows only on its own line; an
// older line with a department and no sub-department shows its department until one is picked.
vi.mock("./subDepartmentQueries", () => ({
  useSubDepartments: () => ({ data: { subDepartments: [
    { id: "s-gen", department: "rental", name: "Rental (general)", fixedKey: "rental_general", staffDepartmentId: null, active: true, sort: 10 },
    { id: "s-mnt", department: "rental", name: "Maintenance", fixedKey: null, staffDepartmentId: null, active: true, sort: 20 },
    { id: "s-old", department: "rental", name: "Laundry", fixedKey: null, staffDepartmentId: null, active: false, sort: 40 },
    { id: "s-dc", department: "supply", name: "Renovation (Dream Crafter)", fixedKey: "dreamcrafter", staffDepartmentId: null, active: true, sort: 10 },
    { id: "s-co", department: "shared", name: "Company", fixedKey: "company", staffDepartmentId: null, active: true, sort: 10 },
  ] } }),
}));

import { nextLineSub, SubDepartmentSelect } from "./SubDepartmentSelect";

describe("the sub-department picker", () => {
  it("shows the three department headings, and picking one sets both", () => {
    const onChange = vi.fn();
    render(<SubDepartmentSelect label="Line 1 department" value={{ department: "", subDepartmentId: null }} onChange={onChange} />);
    const sel = screen.getByLabelText("Line 1 department");
    expect(within(sel).getAllByRole("group").map((g) => g.getAttribute("label"))).toEqual(["Rental", "Renovation", "Company"]);
    expect(within(sel).queryByText("Laundry")).toBeNull();
    fireEvent.change(sel, { target: { value: "s-mnt" } });
    expect(onChange).toHaveBeenCalledWith({ department: "rental", subDepartmentId: "s-mnt" });
  });

  it("a retired one shows on its own line; an older line shows its department until one is picked", () => {
    render(<>
      <SubDepartmentSelect label="a" value={{ department: "rental", subDepartmentId: "s-old" }} onChange={vi.fn()} />
      <SubDepartmentSelect label="b" value={{ department: "supply", subDepartmentId: null }} onChange={vi.fn()} />
    </>);
    expect((screen.getByLabelText("a") as HTMLSelectElement).value).toBe("s-old");
    const b = screen.getByLabelText("b") as HTMLSelectElement;
    expect(b.value).toBe("");
    expect(b.options[b.selectedIndex]!.textContent).toBe("Renovation");
  });

  it("a new line takes the nearest line above's", () => {
    expect(nextLineSub([{ department: "rental", subDepartmentId: "s-mnt" }, { department: "", subDepartmentId: null }])).toEqual({ department: "rental", subDepartmentId: "s-mnt" });
    expect(nextLineSub([])).toEqual({ department: "", subDepartmentId: null });
  });
});
