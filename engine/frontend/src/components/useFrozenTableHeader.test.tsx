import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useFrozenTableHeader } from "./useFrozenTableHeader";

/* A 40-line sales order has payments and the contract below its line table. The table must not be held in a small
   box to fit them: the page scrolls and every line shows (owner's SO line table, 4 Nov 2026). */

const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });

function Harness({ onBox }: { onBox: (box: unknown) => void }) {
  const { rootRef, scrollWrapRef, freezeBox } = useFrozenTableHeader(true);
  onBox(freezeBox);
  return (
    <main data-testid="main">
      <div ref={rootRef} data-testid="root">
        <div ref={scrollWrapRef} data-testid="wrap" />
      </div>
    </main>
  );
}

function boxWith(pageBelow: number) {
  const tableH = 3000;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect(200, 200 + tableH));
  const size = (el: HTMLElement, name: string) => {
    if (el.tagName === "MAIN") return name === "scrollHeight" ? 200 + tableH + pageBelow : 800;
    return tableH;
  };
  for (const name of ["scrollHeight", "clientHeight"]) {
    vi.spyOn(HTMLElement.prototype, name as "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return size(this, name);
    });
  }
  let box: unknown = "unset";
  render(<Harness onBox={(b) => { box = b; }} />);
  return box as { maxH: number } | null;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useFrozenTableHeader", () => {
  it("keeps a table frozen when little of the page sits below it", () => {
    const box = boxWith(100);
    expect(box?.maxH).toBeGreaterThanOrEqual(360);
  });

  it("leaves a long table in the page when a lot sits below it", () => {
    expect(boxWith(1500)).toBeNull();
  });
});
