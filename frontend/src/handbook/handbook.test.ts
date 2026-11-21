import { describe, expect, it } from "vitest";
import { CHAPTERS } from "./content";
import { chapterPath, chaptersFor, searchHandbook, sectionText } from "./index";

describe("Handbuch", () => {
  it("hat eindeutige Kennungen und keine leeren Abschnitte", () => {
    const chapterIds = CHAPTERS.map((chapter) => chapter.id);
    expect(new Set(chapterIds).size).toBe(chapterIds.length);
    for (const chapter of CHAPTERS) {
      const ids = chapter.sections.map((section) => section.id);
      expect(new Set(ids).size, chapter.id).toBe(ids.length);
      for (const section of chapter.sections) {
        expect(section.blocks.length, `${chapter.id}/${section.id}`).toBeGreaterThan(0);
        expect(section.id).toMatch(/^[a-z0-9-]+$/);
        for (const link of section.links ?? []) {
          expect(link.to.startsWith("/") && !link.to.startsWith("//")).toBe(true);
        }
      }
    }
  });

  it("spricht die Lesenden mit du an und nennt keine Firmen-Interna", () => {
    for (const chapter of CHAPTERS) {
      for (const section of chapter.sections) {
        const text = sectionText(section);
        expect(text, `${chapter.id}/${section.id}`).not.toMatch(
          /\b(Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer)\b/,
        );
        expect(text).not.toMatch(/https?:\/\/\w/);
      }
    }
  });

  it("zeigt allen die allgemeinen Kapitel und sonst nur die der eigenen Rollen", () => {
    const reader = chaptersFor(["Evergreen.Reader"]).map((chapter) => chapter.id);
    expect(reader).toEqual(["erste-schritte", "evergreen", "hilfe"]);
    const evergreen = chaptersFor(["Evergreen.Reader"]).find((c) => c.id === "evergreen");
    const sections = evergreen?.sections.map((section) => section.id) ?? [];
    expect(sections).toContain("lesen");
    expect(sections).not.toContain("notizen");
  });

  it("zeigt Admins alles", () => {
    const all = chaptersFor(["Werkbank.Admin"]);
    expect(all.map((chapter) => chapter.id)).toEqual(CHAPTERS.map((chapter) => chapter.id));
    expect(all.flatMap((chapter) => chapter.sections).length).toBe(
      CHAPTERS.flatMap((chapter) => chapter.sections).length,
    );
  });

  it("sucht nur in sichtbaren Abschnitten, Titel zuerst", () => {
    const hits = searchHandbook("glocke", ["Budget.Reader"]);
    expect(hits[0]?.section.id).toBe("benachrichtigungen");
    expect(searchHandbook("Kündigungsfrist", ["Evergreen.Reader"])).toEqual([]);
    expect(
      searchHandbook("rechnungen buchen", ["Budget.Manager"]).map((hit) => hit.section.id),
    ).toContain("buchen");
    expect(searchHandbook("  ", ["Budget.Manager"])).toEqual([]);
  });

  it("baut Adressen für Kapitel und Abschnitte", () => {
    expect(chapterPath("evergreen")).toBe("/handbuch/evergreen");
    expect(chapterPath("evergreen", "ablauf")).toBe("/handbuch/evergreen#ablauf");
  });
});
