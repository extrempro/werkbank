import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs, openPage } from "./helpers";

const ORIGIN = "http://localhost:8080";

test("Suche findet Vorgänge und beachtet, wer sie sehen darf", async ({ page, browser }) => {
  const word = `Suchwort${Date.now()}`;
  await loginAs(page, ["Evergreen.IT"], "Ina IT");
  const created = await page.request.post("/api/evergreen/items", {
    data: { title: `${word} in Teams` },
    headers: { Origin: ORIGIN },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id as number;

  await page.goto("/");
  await openPage(page, "Start", "Suche");
  await expect(page.getByRole("heading", { level: 1, name: "Suche" })).toBeVisible();
  await page.getByLabel("Suchbegriff").fill(word);
  await page.getByRole("button", { name: "Suchen" }).click();
  await expect(page).toHaveURL(new RegExp(`/suche\\?q=${word}$`));
  const hit = page.getByRole("link", { name: `${word} in Teams` });
  await expect(hit).toBeVisible();
  await expect(page.getByText("1 Treffer")).toBeVisible();
  await expectNoA11yViolations(page);
  await hit.click();
  await expect(page).toHaveURL(new RegExp(`/evergreen/${id}$`));

  // Der Betriebsrat sieht den Vorgang noch nicht, also findet ihn die Suche auch nicht.
  const context = await browser.newContext();
  const other = await context.newPage();
  await loginAs(other, ["Evergreen.Betriebsrat"], "Bea BR");
  await other.goto(`/suche?q=${word}`);
  await expect(other.getByText(/Keine Treffer für/)).toBeVisible();
  await context.close();
});

test("Suchfeld in der Kopfzeile führt zur Suche", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Das Feld steht nur auf breiten Bildschirmen");
  await loginAs(page, ["Config.Reader"], "Lea Leser");
  await page.goto("/");
  await page.getByLabel("Suchen", { exact: true }).fill("gibtesnicht");
  await page.getByLabel("Suchen", { exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/suche\?q=gibtesnicht$/);
  await expect(page.getByLabel("Suchbegriff")).toHaveValue("gibtesnicht");
  await expect(page.getByText(/Keine Treffer für/)).toBeVisible();
});
