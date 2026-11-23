/* The Production Order outstanding-SO read re-runs the whole MRP plan on the server on every try. A slow or failed
   load must be shown, not silently sent up to four times (audit 20 Nov 2026, item 3; same rule as the PO hook). */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const { authedFetch } = vi.hoisted(() => ({ authedFetch: vi.fn() }));
vi.mock("./authed-fetch", async (orig) => ({ ...(await orig<typeof import("./authed-fetch")>()), authedFetch }));

import { useOutstandingSoItems } from "./production-order-queries";

describe("useOutstandingSoItems (Production Order)", () => {
  it("does not retry a failed load, even where the client default would", async () => {
    authedFetch.mockRejectedValue(new Error("That took too long"));
    // The client default retries 3 times with no delay: only the hook's own retry:false keeps it to one call.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } });
    const { result } = renderHook(() => useOutstandingSoItems(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(authedFetch).toHaveBeenCalledTimes(1);
  });
});
