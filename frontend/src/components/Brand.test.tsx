import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BrandMark } from "./Brand";

afterEach(cleanup);

describe("BrandMark", () => {
  it("zeigt ohne Logo das Zeichen der Werkbank", () => {
    const { container } = render(<BrandMark logoUrl={null} />);
    expect(container.querySelector(".brand-mark svg")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("zeigt das Logo und fällt bei einem Ladefehler auf das Zeichen zurück", () => {
    const { container } = render(<BrandMark logoUrl="/api/branding/assets/logo-dunkel?v=1" />);
    const image = container.querySelector("img");
    expect(image).toHaveAttribute("alt", "");
    fireEvent.error(image!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".brand-mark")).not.toBeNull();
  });
});
