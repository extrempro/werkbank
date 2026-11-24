import { describe, expect, it } from "vitest";
import { AREAS } from "./content";
import {
  areasFor,
  findTopic,
  parseHandbookPath,
  searchHandbook,
  topicPath,
  topicsFor,
  topicText,
} from "./index";

describe("Handbuch", () => {
  it("hat eindeutige Kennungen und keine leeren Themen", () => {
    const areaIds = AREAS.map((area) => area.id);
    expect(new Set(areaIds).size).toBe(areaIds.length);
    for (const area of AREAS) {
      expect(area.id).toMatch(/^[a-z0-9-]+$/);
      const ids = area.parts.flatMap((part) => part.topics.map((topic) => topic.id));
      expect(new Set(ids).size, area.id).toBe(ids.length);
      for (const part of area.parts) {
        expect(part.topics.length, `${area.id}/${part.title}`).toBeGreaterThan(0);
        for (const topic of part.topics) {
          expect(topic.blocks.length, `${area.id}/${topic.id}`).toBeGreaterThan(0);
          expect(topic.id).toMatch(/^[a-z0-9-]+$/);
          for (const link of topic.links ?? []) {
            expect(link.to.startsWith("/") && !link.to.startsWith("//")).toBe(true);
          }
        }
      }
    }
  });

  it("spricht die Lesenden mit du an und nennt keine Firmen-Interna", () => {
    for (const ref of topicsFor(["Werkbank.Admin"])) {
      const text = topicText(ref.topic);
      expect(text, `${ref.area.id}/${ref.topic.id}`).not.toMatch(
        /\b(Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer)\b/,
      );
      expect(text).not.toMatch(/https?:\/\/\w/);
    }
  });

  it("ordnet die Bereiche wie die Bereichsleiste", () => {
    expect(AREAS.map((area) => area.id)).toEqual([
      "grundlagen",
      "m365",
      "evergreen",
      "it-monitoring",
      "tickets",
      "it-bestand",
      "doku",
      "it-budget",
      "it-projekte",
      "it-tools",
      "verwaltung",
      "hilfe",
    ]);
  });

  it("zeigt allen die Grundlagen und sonst nur Themen der eigenen Rollen", () => {
    const reader = areasFor(["Evergreen.Reader"]).map((area) => area.id);
    expect(reader).toEqual(["grundlagen", "evergreen", "hilfe"]);
    const evergreen = areasFor(["Evergreen.Reader"]).find((area) => area.id === "evergreen");
    const topics = evergreen?.parts.flatMap((part) => part.topics.map((topic) => topic.id));
    expect(topics).toContain("lesen");
    expect(topics).not.toContain("notizen");
    // Teile mit eigenen Rollen: Tenant sieht nur, wer die Rolle hat
    const m365 = areasFor(["Tenant.Reader"]).find((area) => area.id === "m365");
    expect(m365?.parts.map((part) => part.title)).toEqual(["Tenant"]);
  });

  it("zeigt Admins alles", () => {
    const all = topicsFor(["Werkbank.Admin"]);
    expect(all.length).toBe(AREAS.flatMap((area) => area.parts.flatMap((p) => p.topics)).length);
  });

  it("sucht nur in sichtbaren Themen, Titel zuerst", () => {
    const hits = searchHandbook("glocke", ["Budget.Reader"]);
    expect(hits[0]?.topic.id).toBe("benachrichtigungen");
    expect(searchHandbook("Kündigungsfrist", ["Evergreen.Reader"])).toEqual([]);
    expect(
      searchHandbook("rechnungen buchen", ["Budget.Manager"]).map((hit) => hit.topic.id),
    ).toContain("buchen");
    expect(searchHandbook("  ", ["Budget.Manager"])).toEqual([]);
  });

  it("baut und liest Adressen", () => {
    expect(topicPath("evergreen")).toBe("/handbuch/evergreen");
    expect(topicPath("evergreen", "bewerten")).toBe("/handbuch/evergreen/bewerten");
    expect(parseHandbookPath("/handbuch")).toEqual({ area: null, topic: null });
    expect(parseHandbookPath("/handbuch/it-budget/posten")).toEqual({
      area: "it-budget",
      topic: "posten",
    });
    expect(parseHandbookPath("/handbuch/a/b/c")).toBeNull();
    expect(parseHandbookPath("/handbuchx")).toBeNull();
    expect(findTopic(["Budget.Reader"], "it-budget", "buchen")).toBeNull();
    expect(findTopic(["Budget.Manager"], "it-budget", "buchen")?.part.title).toBe("Ausgaben");
  });
});
