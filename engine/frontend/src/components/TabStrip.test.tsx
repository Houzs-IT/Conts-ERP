import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TabStrip } from "./TabStrip";

function renderTabs(): void {
  render(
    <TabStrip<"requests" | "bills">
      value="requests"
      onChange={() => undefined}
      options={[
        { value: "requests", label: "Requests & claims", count: 4 },
        { value: "bills", label: "Utility bills", count: 159 },
      ]}
    />,
  );
}

describe("TabStrip count", () => {
  it("an unselected tab's count is an outlined chip in secondary ink, never grey on a grey fill", () => {
    renderTabs();
    const count = screen.getByText("159");
    expect(count.className).toContain("border-ink-muted");
    expect(count.className).toContain("text-ink-secondary");
    expect(count.className).not.toContain("bg-surface-dim");
    expect(count.className).toContain("text-[11px]");
  });

  it("the selected tab's count is a solid primary chip", () => {
    renderTabs();
    const count = screen.getByText("4");
    expect(count.className).toContain("bg-primary");
    expect(count.className).toContain("text-white");
  });
});
