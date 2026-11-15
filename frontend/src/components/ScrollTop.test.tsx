import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScrollTop } from "./ScrollTop";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
});

function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

describe("ScrollTop", () => {
  it("erscheint erst nach etwas Scrollen und führt nach oben", () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    render(<ScrollTop />);
    expect(screen.queryByRole("button", { name: "Nach oben" })).toBeNull();
    scrollTo(900);
    fireEvent.click(screen.getByRole("button", { name: "Nach oben" }));
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    scrollTo(0);
    expect(screen.queryByRole("button", { name: "Nach oben" })).toBeNull();
  });
});
