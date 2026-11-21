import { expect, test } from "@playwright/test";
import {
  areaNames,
  expectNoA11yViolations,
  isPhone,
  itemName,
  loginAs,
  openAccountMenu,
  openMenu,
} from "./helpers";

test("Bereichsleiste und Seitenmenü mit Gruppen zum Aufklappen", async ({
  page,
}, testInfo) => {
  test.skip(isPhone(page), "Auf dem Handy gibt es die Leiste unten");
  await loginAs(
    page,
    ["Werkbank.Admin", "Config.Reviewer", "Evergreen.Editor", "Budget.Manager"],
    `Nina Navi ${testInfo.project.name}`,
  );
  await page.goto("/");
  expect(await areaNames(page)).toEqual([
    "Start",
    "Microsoft 365",
    "Evergreen",
    "IT-Monitoring",
    "IT-Budget",
    "Verwaltung",
  ]);
  const bar = page.getByRole("navigation", { name: "Bereiche" });
  await expect(bar.getByRole("link", { name: "Start" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(bar.getByRole("link", { name: "Handbuch" })).toBeVisible();

  await bar.getByRole("link", { name: /^IT-Budget/ }).click();
  await expect(page).toHaveURL(/\/budget$/);
  const menu = page.getByRole("navigation", { name: "Seiten: IT-Budget" });
  await expect(menu.getByRole("button", { name: "Überblick" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  // „Verwaltung“ ist anfangs eingeklappt; der Browser merkt sich, wenn man sie aufklappt.
  const admin = menu.getByRole("button", { name: "Verwaltung" });
  await expect(admin).toHaveAttribute("aria-expanded", "false");
  await expect(
    menu.getByRole("link", { name: itemName("Import") }),
  ).toBeHidden();
  await admin.click();
  await expect(admin).toHaveAttribute("aria-expanded", "true");
  await expect(
    menu.getByRole("link", { name: itemName("Import") }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  await page.reload();
  await expect(
    menu.getByRole("button", { name: "Verwaltung" }),
  ).toHaveAttribute("aria-expanded", "true");

  // Eine Seite direkt aufrufen: Bereich und Menüpunkt sind gleich die richtigen.
  await page.goto("/budget/partner");
  await expect(bar.getByRole("link", { name: /^IT-Budget/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(
    menu.getByRole("link", { name: itemName("Partner") }),
  ).toHaveAttribute("aria-current", "page");
});

test("Menü einklappen: nur die Bereichsleiste bleibt, ein Bereich öffnet es wieder", async ({
  page,
}, testInfo) => {
  test.skip(isPhone(page), "Auf dem Handy gibt es die Leiste unten");
  await loginAs(
    page,
    ["Config.Reviewer", "Evergreen.Editor"],
    `Nina Navi ${testInfo.project.name}`,
  );
  await page.goto("/m365");
  const menu = page.getByRole("navigation", { name: /^Seiten:/ });
  await menu.getByRole("button", { name: "Menü einklappen" }).click();
  await expect(menu).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Menü ausklappen" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Menü ausklappen" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Bereiche" })
    .getByRole("link", { name: /^Evergreen/ })
    .click();
  await expect(page).toHaveURL(/\/evergreen\/m365$/);
  await expect(
    page.getByRole("navigation", { name: "Seiten: Evergreen" }),
  ).toBeVisible();
});

test("Anheften und „Zuletzt besucht“ im Start-Bereich und auf der Startseite", async ({
  page,
}, testInfo) => {
  test.skip(
    isPhone(page),
    "Anheften geht am Computer; am Handy siehst du nur den Stern",
  );
  await loginAs(
    page,
    ["Budget.Reader"],
    `Anna Anheften ${testInfo.project.name} ${testInfo.retry}`,
  );
  await page.goto("/budget/rechnungen");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
  const star = main.getByRole("button", { name: "Rechnungen anheften" });
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  const menu = await openMenu(page);
  await expect(
    menu.getByRole("button", { name: "Rechnungen anheften" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expectNoA11yViolations(page);

  await page
    .getByRole("navigation", { name: "Bereiche" })
    .getByRole("link", { name: "Start" })
    .click();
  const start = page.getByRole("navigation", { name: "Seiten: Start" });
  await expect(start.getByRole("button", { name: "Angeheftet" })).toBeVisible();
  await expect(
    start.getByRole("link", { name: "Rechnungen Budget" }).first(),
  ).toBeVisible();
  await expect(
    start.getByRole("button", { name: "Zuletzt besucht" }),
  ).toBeVisible();
  const pinned = main.getByRole("region", { name: "Angeheftet" });
  await expect(
    pinned.getByRole("link", { name: "Rechnungen Budget" }),
  ).toBeVisible();
  await expect(
    main.getByRole("region", { name: "Zuletzt besucht" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Nach dem Neuladen kommt der Stand vom Server.
  await page.reload();
  await expect(
    pinned.getByRole("link", { name: "Rechnungen Budget" }),
  ).toBeVisible();
  await pinned.getByRole("button", { name: "Rechnungen anheften" }).click();
  await expect(pinned.getByText(/Noch nichts angeheftet/)).toBeVisible();

  // „Zuletzt besucht leeren“ im Kontomenü
  const account = await openAccountMenu(page);
  await account
    .getByRole("menuitem", { name: "Zuletzt besucht leeren" })
    .click();
  await expect(
    main.getByRole("region", { name: "Zuletzt besucht" }),
  ).toHaveCount(0);
});

test("Kontomenü: mit der Tastatur bedienbar, Darstellung umschalten", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await loginAs(
    page,
    ["Evergreen.Reader"],
    `Nina Navi ${testInfo.project.name}`,
  );
  await page.goto("/");
  const button = page.getByRole("button", { name: /^Konto und Einstellungen/ });
  await expect(button).toHaveAttribute("aria-haspopup", "menu");
  await button.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Konto" });
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("menuitem", { name: "Konto" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    menu.getByRole("menuitem", { name: /^Release Notes/ }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Abmelden" })).toBeFocused();
  await expectNoA11yViolations(page);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();

  const again = await openAccountMenu(page);
  await again.getByRole("menuitemradio", { name: "Dunkel" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dunkel");
  await expect(
    again.getByRole("menuitemradio", { name: "Dunkel" }),
  ).toHaveAttribute("aria-checked", "true");
  await expectNoA11yViolations(page);
  await again.getByRole("menuitemradio", { name: "Hell" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "hell");
  await again.getByRole("menuitemradio", { name: "Automatisch" }).click();
  await again.getByRole("menuitem", { name: "Konto" }).click();
  await expect(page).toHaveURL(/\/konto$/);
});

test("Schnellsuche findet Seiten nach Name, Gruppe und Bereich", async ({
  page,
}, testInfo) => {
  await loginAs(
    page,
    ["Budget.Reader", "Evergreen.Editor"],
    `Sina Suche ${testInfo.project.name}`,
  );
  await page.goto("/");
  await page.getByRole("button", { name: /^Benachrichtigungen/ }).waitFor();
  if (isPhone(page)) {
    await page
      .getByRole("navigation", { name: "Schnellzugriff" })
      .getByRole("button", { name: "Suche" })
      .click();
  } else {
    await page.keyboard.press("Control+k");
  }
  const dialog = page.getByRole("dialog", { name: "Schnellsuche" });
  await expect(dialog).toBeVisible();
  const field = dialog.getByRole("combobox", { name: "Seite suchen" });
  await expect(field).toBeFocused();
  await field.fill("rechnung");
  const hit = dialog.getByRole("option", { name: /Rechnungen/ });
  await expect(hit).toBeVisible();
  await expect(hit).toContainText("Ausgaben · IT-Budget");
  await expect(hit).toHaveAttribute("aria-selected", "true");
  // Nur Seiten mit Recht: Budget-Import gibt es für Leser nicht.
  await field.fill("import");
  await expect(dialog.getByRole("option")).toHaveCount(0);
  await expect(dialog.getByText("Keine Seite gefunden.")).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: /In allen Einträgen suchen/ }),
  ).toHaveAttribute("href", "/suche?q=import");
  await expectNoA11yViolations(page);
  await field.fill("microsoft");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/evergreen\/m365$/);

  if (isPhone(page)) {
    await page
      .getByRole("navigation", { name: "Schnellzugriff" })
      .getByRole("button", { name: "Suche" })
      .click();
    await expect(dialog).toBeVisible();
    // Am Handy füllt die Suche den Bildschirm.
    const box = await dialog.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(dialog).toBeHidden();
    return;
  }
  const trigger = page.getByRole("button", { name: /Seite suchen/ });
  await trigger.click();
  await expect(dialog).toBeVisible();
  // Ohne Eingabe stehen die zuletzt besuchten Seiten da.
  await expect(dialog.getByText("Zuletzt besucht")).toBeVisible();
  await expect(dialog.getByRole("option", { name: /Eingang/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
