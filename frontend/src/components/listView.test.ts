import { describe, expect, it } from "vitest";
import { listViewPage } from "./Layout";

describe("Seiten mit Liste und Ansicht", () => {
  it("erkennt den Verleih, auch mit gewähltem Eintrag; die Neuerungen nutzen die volle Breite", () => {
    expect(listViewPage("/m365/neuerungen")).toBeNull();
    expect(listViewPage("/m365/neuerungen/12")).toBeNull();
    expect(listViewPage("/bestand/verleih/3")).toBe("/bestand/verleih");
    expect(listViewPage("/bestand/vorgaenge")).toBeNull();
    expect(listViewPage("/budget/posten")).toBeNull();
  });
});
