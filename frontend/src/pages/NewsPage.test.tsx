import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CURRENT_VERSION, hasUnseenRelease, RELEASES } from "../release-notes";
import { NewsPage } from "./NewsPage";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Neuigkeiten", () => {
  it("zeigt die Versionen mit Datum und Einträgen", () => {
    render(<NewsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Neuigkeiten" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Version 0.1.0" })).toBeVisible();
    expect(screen.getAllByText("14. November 2026").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("heading", { level: 3, name: "Evergreen" }).length).toBeGreaterThan(
      0,
    );
  });

  it("merkt sich, dass die aktuelle Version gesehen wurde", () => {
    expect(hasUnseenRelease()).toBe(true);
    const onSeen = vi.fn();
    render(<NewsPage onSeen={onSeen} />);
    expect(hasUnseenRelease()).toBe(false);
    expect(onSeen).toHaveBeenCalled();
  });

  it("führt die Version aus package.json als neueste Version", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };
    expect(CURRENT_VERSION).toBe(pkg.version);
  });

  it("hat je Version ein gültiges Datum und mindestens einen Eintrag", () => {
    for (const release of RELEASES) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(release.sections.flatMap((section) => section.entries).length).toBeGreaterThan(0);
    }
  });
});
