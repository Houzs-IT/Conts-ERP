import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Pagination } from "./Pagination";

afterEach(cleanup);

describe("Pagination", () => {
  test("moves a page beyond the last back to the last page", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={6} perPage={25} total={30} onPageChange={onPageChange} />);
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  test("leaves an in-range page alone", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} perPage={25} total={30} onPageChange={onPageChange} />);
    expect(onPageChange).not.toHaveBeenCalled();
  });

  test("leaves the page alone while total is still 0", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={6} perPage={25} total={0} onPageChange={onPageChange} />);
    expect(onPageChange).not.toHaveBeenCalled();
  });
});
