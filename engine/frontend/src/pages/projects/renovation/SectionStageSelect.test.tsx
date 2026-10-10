import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SectionStageSelect } from "./SectionStageSelect";

describe("SectionStageSelect", () => {
  it("lists every stage in order, plus 'No stage'", () => {
    render(<SectionStageSelect value={null} onChange={() => {}} label="Stage of Safety" />);
    const sel = screen.getByLabelText("Stage of Safety") as HTMLSelectElement;
    const opts = Array.from(sel.options).map((o) => o.textContent);
    expect(opts[0]).toBe("No stage (not copied)");
    expect(opts).toHaveLength(12);
    expect(opts[1]).toBe("Design");
    expect(sel.value).toBe("");
  });

  it("sends the stage key, and null for 'No stage'", () => {
    const onChange = vi.fn();
    render(<SectionStageSelect value="hardware" onChange={onChange} label="Stage of Safety" />);
    const sel = screen.getByLabelText("Stage of Safety") as HTMLSelectElement;
    expect(sel.value).toBe("hardware");
    fireEvent.change(sel, { target: { value: "furniture" } });
    expect(onChange).toHaveBeenLastCalledWith("furniture");
    fireEvent.change(sel, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
