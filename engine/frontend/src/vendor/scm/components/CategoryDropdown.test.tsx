import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CategoryDropdown } from "./CategoryDropdown";

afterEach(cleanup);

const options = [
  { value: "", label: "All categories (3)" },
  { value: "Bedframe", label: "Bedframe (2)" },
  { value: "Mattress", label: "Mattress (1)" },
];

describe("CategoryDropdown", () => {
  it("picks an option, closes, and closes on Escape and outside click", () => {
    const onChange = vi.fn();
    render(<CategoryDropdown value="" options={options} onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "All categories (3)" });

    fireEvent.click(trigger);
    expect(screen.getByRole("option", { selected: true }).textContent).toBe("All categories (3)");
    fireEvent.click(screen.getByRole("button", { name: "Mattress (1)" }));
    expect(onChange).toHaveBeenCalledWith("Mattress");
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
