import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InUseToggle } from "./renovationUi";

describe("InUseToggle", () => {
  it("says which state the row is in", () => {
    const { rerender } = render(<InUseToggle on name="Condo" onChange={() => undefined} />);
    expect(screen.getByRole("switch", { name: "Condo in use" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("In use")).toBeTruthy();
    rerender(<InUseToggle on={false} name="Condo" onChange={() => undefined} />);
    expect(screen.getByText("Not in use")).toBeTruthy();
  });

  it("asks for the other state when pressed", () => {
    const onChange = vi.fn();
    render(<InUseToggle on name="Condo" onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
