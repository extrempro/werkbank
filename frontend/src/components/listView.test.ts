import { describe, expect, it } from "vitest";
import { listViewPage } from "./Layout";

describe("Seiten mit Liste und Ansicht", () => {
  it("erkennt Evergreen und Verleih, auch mit gewähltem Eintrag", () => {
    expect(listViewPage("/evergreen/m365")).toBe("/evergreen/m365");
    expect(listViewPage("/evergreen/m365/12")).toBe("/evergreen/m365");
    expect(listViewPage("/bestand/verleih/3")).toBe("/bestand/verleih");
    expect(listViewPage("/bestand/vorgaenge")).toBeNull();
    expect(listViewPage("/budget/posten")).toBeNull();
  });
});
