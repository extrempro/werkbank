import { expect, test } from "@playwright/test";
import { BASE_URL, expectNoA11yViolations, loginAs } from "./helpers";

const ORIGIN = new URL(BASE_URL).origin;

test("Bearbeiter legen einen Eintrag an, fügen Notizen an und schließen ab", async ({
  page,
}, testInfo) => {
  const title = `Neue Funktion ${testInfo.project.name} ${Date.now()}`;

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
  await expect(page.getByText("Noch keine Notizen.")).toBeVisible();
  await expectNoA11yViolations(page);

  await page
    .getByLabel("Notiz", { exact: true })
    .fill("Mit der Fachabteilung klären");
  await page.getByRole("button", { name: "Notiz anfügen" }).click();
  await expect(page.getByText("Mit der Fachabteilung klären")).toBeVisible();
  await expect(
    page.getByText("Bearbeitet", { exact: true }).first(),
  ).toBeVisible();

  // Ein zweiter Bearbeiter ergänzt und schließt ab
  await loginAs(page, ["Evergreen.Editor"], "Ole Beispiel");
  await page.goto(entryUrl);
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
