import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShowMore, useShowMore } from "./ShowMore";

const ITEMS = Array.from({ length: 7 }, (_, index) => `Eintrag ${index + 1}`);

function List({ filter }: { filter: string }) {
  const shown = ITEMS.filter((item) => item.includes(filter));
  const paging = useShowMore(3, filter);
  return (
    <>
      <ul>
        {shown.slice(0, paging.limit).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <ShowMore
        shown={Math.min(paging.limit, shown.length)}
        total={shown.length}
        onMore={paging.more}
        onAll={paging.all}
      />
    </>
  );
}

afterEach(cleanup);

describe("ShowMore", () => {
  it("zeigt stückweise mehr und auf Wunsch alles", () => {
    const { rerender } = render(<List filter="" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("3 von 7")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Weitere anzeigen" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Alle anzeigen" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.queryByRole("button", { name: "Weitere anzeigen" })).toBeNull();

    // Neuer Filter: wieder von vorn
    rerender(<List filter="Eintrag" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    rerender(<List filter="1" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
