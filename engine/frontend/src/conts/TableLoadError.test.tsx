// Conts only. A list whose request failed must come back when Retry is pressed: run it, do not assume it.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { TableLoadError } from "./TableLoadError";

function List({ fetcher }: { fetcher: () => Promise<string[]> }) {
  const q = useQuery({ queryKey: ["rows"], queryFn: fetcher, retry: false });
  if (q.isError) return <TableLoadError error={(q.error as Error).message} />;
  return <div>{q.data?.join(",") ?? "waiting"}</div>;
}

describe("TableLoadError", () => {
  it("Retry refetches the failed query and the rows appear", async () => {
    const fetcher = vi.fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error("Network down"))
      .mockResolvedValue(["DO-1", "DO-2"]);
    render(<QueryClientProvider client={new QueryClient()}><List fetcher={fetcher} /></QueryClientProvider>);

    expect(await screen.findByText("Couldn't load this list.")).toBeTruthy();
    expect(screen.getByText("Network down")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("DO-1,DO-2")).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not repeat the generic fallback under the headline", () => {
    render(<QueryClientProvider client={new QueryClient()}><TableLoadError error="Failed to load" /></QueryClientProvider>);
    expect(screen.queryByText("Failed to load")).toBeNull();
  });

  it("without a query client, Retry reloads the page", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<TableLoadError error="x" />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
