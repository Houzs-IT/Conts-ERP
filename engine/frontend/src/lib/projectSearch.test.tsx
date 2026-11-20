import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectSearchUrl } from "./projectSearch";
import { SearchableSelect } from "../vendor/scm/components/SearchableSelect";

afterEach(cleanup);

/* Audit 20 Nov 2026: the project pickers on Sales entry and New Delivery Job read the newest 200 projects and filtered
   them in the browser, so an older project could not be picked. They now search the server. */
describe("project search", () => {
  it("sends what is typed as the list's own search, one small page", () => {
    expect(projectSearchUrl("")).toBe("/api/projects?per_page=30");
    expect(projectSearchUrl(" KL 48 ")).toBe("/api/projects?per_page=30&search=KL%2048");
  });

  it("SearchableSelect in server mode hands the term to the caller and shows its rows unfiltered", () => {
    const onSearch = vi.fn();
    const onChange = vi.fn();
    render(
      <SearchableSelect
        value=""
        onChange={onChange}
        /* The server matched this row on a field its label does not show (the venue): it must still be offered. */
        options={[{ value: "7", label: "P-007 — Old Expo" }]}
        onSearchChange={onSearch}
        ariaLabel="Project"
      />,
    );
    const input = screen.getByLabelText("Project");
    fireEvent.focus(input);
    expect(onSearch).toHaveBeenLastCalledWith("");
    fireEvent.change(input, { target: { value: "Mid Valley" } });
    expect(onSearch).toHaveBeenLastCalledWith("Mid Valley");
    const row = screen.getByText("P-007 — Old Expo");
    fireEvent.mouseDown(row);
    expect(onChange).toHaveBeenCalledWith("7");
  });

  it("without server mode it still filters the options it holds", () => {
    render(<SearchableSelect value="" onChange={() => {}} options={[{ value: "1", label: "Alpha" }, { value: "2", label: "Beta" }]} ariaLabel="Pick" />);
    const input = screen.getByLabelText("Pick");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "alp" } });
    expect(screen.queryByText("Beta")).toBeNull();
    expect(screen.getByText("Alpha")).toBeTruthy();
  });
});
