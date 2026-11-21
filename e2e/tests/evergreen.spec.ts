import { expect, test } from "@playwright/test";
import {
  BASE_URL,
  chooseStatus,
  expectNoA11yViolations,
  expectStatus,
  loginAs,
} from "./helpers";

const ORIGIN = new URL(BASE_URL).origin;

test("Bearbeiter legen einen Eintrag an, bewerten ihn, fügen Notizen an und schließen ab", async ({
  page,
}, testInfo) => {
  const title = `Neue Funktion ${testInfo.project.name} ${Date.now()}`;
  const wide = (page.viewportSize()?.width ?? 0) >= 1100;

  await loginAs(page, ["Evergreen.Editor"], "Ina Beispiel");
  await page.goto("/evergreen/m365");
  await expect(
    page.getByRole("heading", { level: 1, name: "Microsoft 365" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Neuer Eintrag" }).click();
  await page.getByLabel("Titel").fill(title);
  await page.getByLabel("Dienst (optional)").fill("Microsoft Teams");
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Anlegen" }).click();

  await expect(
    page.getByRole("heading", { level: 2, name: title }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/evergreen\/m365\/\d+$/);
  const entryUrl = new URL(page.url()).pathname;
  await expect(page.getByText("Noch kein Zeitplan eingetragen.")).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Unsere Bewertung" }),
  ).toHaveAttribute("aria-selected", "true");
  await expectNoA11yViolations(page);

  // Bewertung mit Steckbrief und einer Rollout-Phase
  await page
    .getByLabel("Kurzfassung")
    .fill("Teams fasst Besprechungen zusammen.");
  await page.getByRole("radio", { name: "Noch prüfen" }).check();
  await page
    .getByLabel("Standard nach dem Rollout")
    .selectOption({ label: "Eingeschaltet" });
  await page.getByRole("button", { name: "Phase hinzufügen" }).click();
  await page.getByLabel("Phase 1", { exact: true }).fill("Allgemein verfügbar");
  await page.getByLabel("Beginn", { exact: true }).first().fill("2027-01");
  await page.getByLabel("Ende", { exact: true }).first().fill("2027-02");
  await page.getByRole("button", { name: "Bewertung speichern" }).click();
  await expect(page.getByText("Gespeichert.")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Rollout-Phasen" }),
  ).toContainText("Allgemein verfügbar: Jan 2027 bis Feb 2027");
  await expect(
    page.locator(".ev-fact-warn").filter({ hasText: "Eingeschaltet" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Reiter mit der Tastatur wechseln
  await page.getByRole("tab", { name: "Unsere Bewertung" }).focus();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("tab", { name: "Notizen und Verlauf" }),
  ).toBeFocused();
  await expect(page.getByText("Bewertung geändert")).toBeVisible();

  await page
    .getByLabel("Notiz", { exact: true })
    .fill("Mit der Fachabteilung klären");
  await page.getByRole("button", { name: "Notiz anfügen" }).click();
  await expect(page.getByText("Mit der Fachabteilung klären")).toBeVisible();

  // Liste: breit daneben mit Markierung, schmal über „Zur Liste“
  if (wide) {
    await expect(
      page.getByRole("link", { name: new RegExp(title) }),
    ).toHaveAttribute("aria-current", "true");
  } else {
    await page.getByRole("link", { name: "‹ Zur Liste" }).click();
    await expect(
      page.getByRole("link", { name: new RegExp(title) }),
    ).toBeVisible();
    await page.getByRole("link", { name: new RegExp(title) }).click();
    await expect(
      page.getByRole("heading", { level: 2, name: title }),
    ).toBeVisible();
  }

  // Ein zweiter Bearbeiter ergänzt und schließt ab
  await loginAs(page, ["Evergreen.Editor"], "Ole Beispiel");
  await page.goto(entryUrl);
  await page.getByRole("tab", { name: "Notizen und Verlauf" }).click();
  await page.getByLabel("Notiz", { exact: true }).fill("Betrifft uns nicht");
  await page.getByRole("button", { name: "Abschließen" }).click();
  await expect(
    page.getByRole("button", { name: "Wieder öffnen" }),
  ).toBeVisible();
  await expect(page.getByText("Betrifft uns nicht")).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Wieder öffnen" }).click();
  await expect(
    page.getByRole("button", { name: "Notiz anfügen" }),
  ).toBeVisible();
});

test("Liste: Status wählen und Info-Meldungen ausblenden (gemerkt)", async ({
  page,
}) => {
  await loginAs(page, ["Evergreen.Reader"], "Lea Beispiel");
  await page.goto("/evergreen/m365");
  const toggle = page.getByRole("checkbox", {
    name: "Reine Info-Meldungen ausblenden",
  });
  await expect(toggle).toBeChecked();
  await chooseStatus(page, "Status", "Mit Frist");
  await expectStatus(page, "Status", "Mit Frist");
  await toggle.uncheck();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await expectNoA11yViolations(page);
});

test("Leser sehen Einträge ohne Bearbeitung und haben keine Aufgaben", async ({
  page,
}) => {
  await loginAs(page, ["Evergreen.Editor"], "Ina Beispiel");
  const created = await page.request.post("/api/evergreen/entries", {
    data: { title: `Nur lesen ${Date.now()}` },
    headers: { Origin: ORIGIN },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id as number;

  await loginAs(page, ["Evergreen.Reader"], "Lea Beispiel");
  await page.goto(`/evergreen/m365/${id}`);
  await expect(page.getByText("Noch nicht bewertet.").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bewertung speichern" }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Notizen und Verlauf" }).click();
  await expect(page.getByText("Noch keine Notizen.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Notiz anfügen" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Neuer Eintrag" })).toHaveCount(
    0,
  );
  await expectNoA11yViolations(page);
  const note = await page.request.post(`/api/evergreen/entries/${id}/notes`, {
    data: { text: "Versuch" },
    headers: { Origin: ORIGIN },
  });
  expect(note.status()).toBe(403);
  const assessed = await page.request.put(
    `/api/evergreen/entries/${id}/assessment`,
    { data: { summary: "Versuch" }, headers: { Origin: ORIGIN } },
  );
  expect(assessed.status()).toBe(403);
  const tasks = (await (await page.request.get("/api/tasks")).json()).tasks as {
    module: string;
  }[];
  expect(tasks.filter((task) => task.module === "Evergreen")).toEqual([]);
});

test("Ohne Evergreen-Rolle bleibt der Bereich verschlossen", async ({
  page,
}) => {
  await loginAs(page, ["Config.Reader"], "Lea Leser");
  await page.goto("/evergreen/m365");
  await expect(
    page.getByRole("heading", { name: "Seite nicht gefunden" }),
  ).toBeVisible();
  expect((await page.request.get("/api/evergreen/entries")).status()).toBe(403);
});
