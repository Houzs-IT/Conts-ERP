import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Ledger setup → Departments (SOP 1.1; chew 4 Nov 2026): finance keeps the sub-departments under Rental, Renovation and
// Company, each mapped to a staff department. Built-in ones are renamed, never retired; retiring asks first.
const saveAsync = vi.fn(async (b: unknown) => b);
const confirmFn = vi.fn(async (_: { title: string; body: string }) => true);
const LIST = {
  subDepartments: [
    { id: "s-gen", department: "rental", name: "Rental (general)", fixedKey: "rental_general", staffDepartmentId: null, active: true, sort: 10 },
    { id: "s-cln", department: "rental", name: "Cleaning", fixedKey: null, staffDepartmentId: "dept-cln", active: true, sort: 30 },
    { id: "s-old", department: "rental", name: "Laundry", fixedKey: null, staffDepartmentId: null, active: false, sort: 40 },
    { id: "s-dc", department: "supply", name: "Renovation (Dream Crafter)", fixedKey: "dreamcrafter", staffDepartmentId: null, active: true, sort: 10 },
    { id: "s-co", department: "shared", name: "Company", fixedKey: "company", staffDepartmentId: null, active: true, sort: 10 },
  ],
};
const STAFF = { departments: [{ id: "dept-cln", name: "Cleaning" }, { id: "dept-mnt", name: "Maintenance" }] };
vi.mock("./subDepartmentQueries", () => ({
  useSubDepartments: () => ({ data: LIST, isSuccess: true, isError: false }),
  useStaffDepartments: () => ({ data: STAFF }),
  useSaveSubDepartment: () => ({ mutateAsync: saveAsync, isPending: false }),
}));
vi.mock("../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => confirmFn }));

import { SubDepartments } from "./SubDepartments";

describe("the department list", () => {
  beforeEach(() => { saveAsync.mockClear(); confirmFn.mockClear(); confirmFn.mockResolvedValue(true); });

  it("groups the sub-departments under Rental, Renovation and Company", () => {
    render(<SubDepartments canSave />);
    const rental = screen.getByRole("group", { name: "Rental" });
    expect(within(rental).getByLabelText("Name of Cleaning")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Renovation" })).getByLabelText("Name of Renovation (Dream Crafter)")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Company" })).getByLabelText("Name of Company")).toBeTruthy();
  });

  it("adds one under Rental", async () => {
    render(<SubDepartments canSave />);
    const rental = screen.getByRole("group", { name: "Rental" });
    fireEvent.change(within(rental).getByLabelText("New Rental department"), { target: { value: "Laundry room" } });
    fireEvent.click(within(rental).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(saveAsync).toHaveBeenCalledWith({ department: "rental", name: "Laundry room" }));
  });

  it("renames on leaving the field, and maps a staff department", async () => {
    render(<SubDepartments canSave />);
    const name = screen.getByLabelText("Name of Cleaning");
    fireEvent.change(name, { target: { value: "Housekeeping" } });
    fireEvent.blur(name);
    await waitFor(() => expect(saveAsync).toHaveBeenCalledWith({ id: "s-cln", name: "Housekeeping" }));
    fireEvent.change(screen.getByLabelText("Staff department for Cleaning"), { target: { value: "dept-mnt" } });
    await waitFor(() => expect(saveAsync).toHaveBeenCalledWith({ id: "s-cln", staffDepartmentId: "dept-mnt" }));
  });

  it("built-in rows cannot be retired; retiring another asks first; a retired one comes back", async () => {
    render(<SubDepartments canSave />);
    expect(screen.queryByRole("button", { name: "Retire Rental (general)" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retire Cleaning" }));
    await waitFor(() => expect(saveAsync).toHaveBeenCalledWith({ id: "s-cln", active: false }));
    expect(confirmFn.mock.calls[0]![0].title).toBe("Retire Cleaning?");
    expect(screen.getByText("Retired")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Bring back Laundry" }));
    await waitFor(() => expect(saveAsync).toHaveBeenCalledWith({ id: "s-old", active: true }));
  });

  it("without the post key every field is read only", () => {
    render(<SubDepartments canSave={false} />);
    expect((screen.getByLabelText("Name of Cleaning") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retire Cleaning" })).toBeNull();
  });
});
