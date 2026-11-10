/* Worker hours on a production order (TODO item 16): actual against budget, Start / Stop time per worker, entries. */
import { afterEach, describe, expect, test, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ProductionHours } from "../../vendor/scm/lib/production-order-queries";

const mutate = vi.fn();
let data: ProductionHours;
vi.mock("../../vendor/scm/lib/production-order-queries", async (original) => ({
  ...(await original<typeof import("../../vendor/scm/lib/production-order-queries")>()),
  useProductionHours: () => ({ data, isLoading: false, isError: false }),
  useProductionHoursAction: () => ({ mutate, isPending: false }),
}));
vi.mock("../../vendor/scm/components/NotifyDialog", () => ({ useNotify: () => vi.fn() }));
vi.mock("../../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => vi.fn(async () => true) }));

import { ProductionHoursPanel, budgetWords, clockPeople, isoFromMyt, timeBoxOf } from "./ProductionHours";

const base = (over: Partial<ProductionHours> = {}): ProductionHours => ({
  budgetHours: 10,
  summary: { actualMinutes: 750, budgetMinutes: 600, varianceMinutes: 150, overBudget: true, running: 1, people: [
    { personKey: "tech-1", name: "Ali", minutes: 540, running: true, entries: 2 },
  ] },
  entries: [
    { id: "e1", person_key: "tech-1", name: "Ali", started_at: "2026-11-09T01:00:00Z", stopped_at: "2026-11-09T09:00:00Z", notes: null, how: "TIMER", minutes: 480, created_by_name: null, updated_by_name: null },
    { id: "e2", person_key: "tech-1", name: "Ali", started_at: "2026-11-10T01:15:00Z", stopped_at: null, notes: null, how: "TIMER", minutes: 60, created_by_name: null, updated_by_name: null },
  ],
  me: "user:9", canTime: true, canEnter: true, ...over,
});

beforeEach(() => { mutate.mockReset(); data = base(); });
afterEach(cleanup);

describe("helpers", () => {
  test("Malaysia times in and out of the time boxes", () => {
    expect(isoFromMyt("2026-11-10", "09:15")).toBe("2026-11-10T01:15:00.000Z");
    expect(timeBoxOf("2026-11-10T01:15:00Z")).toBe("09:15");
  });
  test("the budget line: over, left, none", () => {
    expect(budgetWords(base())).toEqual({ text: "2.5 h over budget", over: true });
    expect(budgetWords(base({ summary: { ...base().summary, varianceMinutes: -90, overBudget: false } }))).toEqual({ text: "1.5 h left", over: false });
    expect(budgetWords(base({ budgetHours: null, summary: { ...base().summary, varianceMinutes: null } }))).toEqual({ text: "No production time set", over: false });
  });
  test("you first, then each worker once", () => {
    const people = clockPeople(base(), [{ id: "w1", person_key: "tech-1", name: "Ali", trade: null, how: "ASSIGNED" }], "You");
    expect(people.map((p) => p.key)).toEqual(["user:9", "tech-1"]);
  });
});

describe("the panel", () => {
  const workers = [{ id: "w1", person_key: "tech-1", name: "Ali", trade: null, how: "ASSIGNED" as const }];
  test("shows budget, actual, and who is on the clock; Stop and Start send the right person", () => {
    render(<ProductionHoursPanel orderId="o1" workers={workers} canAct />);
    expect(screen.getByText("10 h")).toBeTruthy();
    expect(screen.getByText("12.5 h")).toBeTruthy();
    expect(screen.getByText("2.5 h over budget")).toBeTruthy();
    expect(screen.getByText("On the clock since 9:15")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop time" }));
    expect(mutate.mock.calls[0]![0]).toEqual({ kind: "stop", personKey: "tech-1" });
    fireEvent.click(screen.getByRole("button", { name: "Start time" }));
    expect(mutate.mock.calls[1]![0]).toEqual({ kind: "start", personKey: "user:9" });
  });
  test("no buttons for someone who may only look, or once timing is closed", () => {
    render(<ProductionHoursPanel orderId="o1" workers={workers} canAct={false} />);
    expect(screen.queryByRole("button", { name: /time$/ })).toBeNull();
    expect(screen.queryByText("Add time")).toBeNull();
  });
  test("Add time sends a typed entry in Malaysia time", () => {
    data = base({ canTime: false });
    render(<ProductionHoursPanel orderId="o1" workers={workers} canAct />);
    expect(screen.queryByRole("button", { name: "Start time" })).toBeNull();
    fireEvent.click(screen.getByText("Add time"));
    fireEvent.change(screen.getByLabelText("Worker"), { target: { value: "tech-1" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-09" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "13:00" } });
    fireEvent.change(screen.getByLabelText("Stop"), { target: { value: "15:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutate.mock.calls[0]![0]).toEqual({ kind: "add", personKey: "tech-1", startedAt: "2026-11-09T05:00:00.000Z", stoppedAt: "2026-11-09T07:30:00.000Z", notes: "" });
  });
});
