import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DataTable, type Column } from "./DataTable";

/* Conts (2026-10-26): coming back to the Suppliers list scrolls to the supplier you opened. The app scrolls
   inside its <main> panel, not the window, so a row not drawn yet must be brought near through that panel;
   scrolling the window did nothing and the row was never found. */

type Row = { id: string };
const columns: Column<Row>[] = [{ key: "id", label: "Id", render: (r) => r.id, getValue: (r) => r.id }];
const rows: Row[] = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }));

beforeEach(() => {
  localStorage.clear();
  if (!(globalThis as { CSS?: unknown }).CSS) (globalThis as { CSS?: unknown }).CSS = { escape: (v: string) => v };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  });
});
afterEach(cleanup);

describe("DataTable scroll to a row that is not drawn yet", () => {
  it("scrolls the panel the table sits in, not the window", () => {
    const winScroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const again = render(
      <main style={{ overflowY: "auto" }}>
        <DataTable tableId="scroll-to-row" columns={columns} rows={rows} getRowKey={(r) => r.id} scrollToRow={null} />
      </main>,
    );
    const main = again.container.querySelector("main") as HTMLElement;
    Object.defineProperty(main, "scrollHeight", { configurable: true, value: 5000 });
    Object.defineProperty(main, "clientHeight", { configurable: true, value: 600 });
    again.rerender(
      <main style={{ overflowY: "auto" }}>
        <DataTable tableId="scroll-to-row" columns={columns} rows={rows} getRowKey={(r) => r.id} scrollToRow={{ key: "80", nonce: 2 }} />
      </main>,
    );
    expect(main.scrollTop).toBeGreaterThan(0);
    expect(winScroll).not.toHaveBeenCalled();
    winScroll.mockRestore();
  });
});
