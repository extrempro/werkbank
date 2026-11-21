import { describe, expect, it } from "vitest";
import { findTopic } from "../handbook";
import { HELP, PAGE_HELP, pageTopics } from "./terms";

const ADMIN = ["Werkbank.Admin"];

describe("Erklärungen der Info-Symbole", () => {
  it("führt jede Erklärung zu einem Thema im Handbuch", () => {
    for (const [key, help] of Object.entries(HELP)) {
      expect(findTopic(ADMIN, help.topic[0], help.topic[1]), key).not.toBeNull();
    }
  });

  it("hält die Regeln: kurz, höchstens zwei Sätze, du statt Sie", () => {
    const terms = Object.values(HELP).map((help) => help.term);
    expect(new Set(terms).size).toBe(terms.length);
    for (const [key, help] of Object.entries(HELP)) {
      expect(help.text.length, key).toBeLessThanOrEqual(240);
      const sentences = help.text.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length, key).toBeLessThanOrEqual(2);
      expect(help.text, key).not.toMatch(/\b(Sie|Ihnen|Ihr|Ihre)\b/);
    }
  });

  it("hat für jede Seite ein Thema, das es gibt", () => {
    for (const [path, topics] of Object.entries(PAGE_HELP)) {
      expect(topics.length, path).toBeGreaterThan(0);
      for (const [area, topic] of topics) {
        expect(findTopic(ADMIN, area, topic), `${path} → ${area}/${topic}`).not.toBeNull();
      }
    }
  });

  it("findet die Hilfe auch für Unterseiten", () => {
    expect(pageTopics("/budget/posten")).toEqual([["it-budget", "posten"]]);
    expect(pageTopics("/evergreen/m365/12")).toEqual([["evergreen", "liste"]]);
    expect(pageTopics("/it-tools/verlauf")).toEqual([["it-tools", "verlauf"]]);
    expect(pageTopics("/it-tools/netzwerk")).toEqual([["it-tools", "ueberblick"]]);
    expect(pageTopics("/handbuch")).toEqual([]);
    expect(pageTopics("/x")).toEqual([]);
  });
});
