import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Link } from "./Link";

afterEach(cleanup);

describe("Link", () => {
  it("kennzeichnet die aktuelle Seite", () => {
    render(
      <>
        <Link to="/a" aria-current="page">
          A
        </Link>
        <Link to="/b">B</Link>
      </>,
    );
    expect(screen.getByRole("link", { name: "A" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "B" })).not.toHaveAttribute("aria-current");
  });
});
