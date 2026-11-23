import { expect, test } from "@playwright/test";
import {
  areaNames,
  expectNoA11yViolations,
  itemName,
  loginAs,
  openMenu,
  openPage,
  confirmDialog,
} from "./helpers";

test("IT-Tools: Übersicht mit Suche und Favoriten", async ({
  page,
}, testInfo) => {
  // Favoriten gelten fürs Konto: eigene Person je Gerät und Versuch
  await loginAs(
    page,
    ["Tools.User"],
    `Tina Favoriten ${testInfo.project.name} ${testInfo.retry}`,
  );
  await page.goto("/");
  await openPage(page, "IT-Tools", "Alle Tools");
  await expect(page).toHaveURL(/\/it-tools$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "IT-Tools" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Subnetz-Rechner" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByLabel("Tool suchen").fill("chmod");
  await expect(page.getByRole("link", { name: "Subnetz-Rechner" })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "chmod-Rechner zu den Favoriten" })
    .click();
  await page.getByLabel("Tool suchen").fill("");
  await expect(
    page.getByRole("heading", { level: 2, name: "Favoriten" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 2, name: "Favoriten" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "chmod-Rechner aus den Favoriten entfernen" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Favoriten" }),
  ).toHaveCount(0);
});

test("IT-Tools: Verlauf speichert Einstellungen und öffnet sie wieder", async ({
  page,
}, testInfo) => {
  await loginAs(
    page,
    ["Tools.User"],
    `Tina Verlauf ${testInfo.project.name} ${testInfo.retry}`,
  );
  await page.goto("/it-tools/subnetz");
  await page.getByLabel("Netz, Adresse oder Bereich").fill("10.20.30.0/24");
  await expect(page).toHaveURL(/netz=10\.20\.30\.0/);
  // Gespeichert wird, wenn die Einstellungen zwei Sekunden gleich bleiben
  await page.waitForTimeout(2600);
  await page.goto("/it-tools/verlauf");
  await expect(
    page.getByRole("heading", { level: 1, name: "Verlauf" }),
  ).toBeVisible();
  const entry = page.getByRole("link", { name: "Subnetz-Rechner" });
  await expect(entry).toBeVisible();
  await expect(page.getByText("10.20.30.0/24").first()).toBeVisible();
  await expectNoA11yViolations(page);
  await entry.click();
  await expect(page.getByLabel("Netz, Adresse oder Bereich")).toHaveValue(
    "10.20.30.0/24",
  );

  // Zuletzt genutzt in der Übersicht
  await page.goto("/it-tools");
  await expect(
    page.getByRole("heading", { level: 2, name: "Zuletzt genutzt" }),
  ).toBeVisible();

  await page.goto("/it-tools/verlauf");
  await page.getByRole("button", { name: "Ganzen Verlauf löschen" }).click();
  await confirmDialog(page, "Verlauf löschen");
  await expect(page.getByText(/Noch kein Verlauf/)).toBeVisible();
});

test("IT-Tools: Subnetz-Rechner rechnet und der Link lässt sich teilen", async ({
  page,
}) => {
  await loginAs(page, ["Tools.User"], "Tina Tools");
  await page.goto("/it-tools/subnetz");
  await expect(
    page.getByRole("heading", { level: 1, name: "Subnetz-Rechner" }),
  ).toBeVisible();
  await page.getByLabel("Netz, Adresse oder Bereich").fill("192.168.10.77/24");
  await expect(page.getByRole("row", { name: /^Broadcast/ })).toContainText(
    "192.168.10.255",
  );
  await expect(page).toHaveURL(/netz=192\.168\.10\.77/);
  await expectNoA11yViolations(page);
  // Dieselbe Adresse neu geöffnet zeigt dasselbe Ergebnis.
  await page.reload();
  await expect(page.getByLabel("Netz, Adresse oder Bereich")).toHaveValue(
    "192.168.10.77/24",
  );
  await expect(page.getByRole("row", { name: /^Subnetzmaske/ })).toContainText(
    "255.255.255.0",
  );
});

test("IT-Tools: chmod, Base64, UUID und Passwort-Generator", async ({
  page,
}) => {
  await loginAs(page, ["Tools.User"], "Tina Tools");

  await page.goto("/it-tools/chmod");
  await page.getByLabel("Andere Schreiben").check();
  await expect(page.getByRole("row", { name: /^Oktal/ })).toContainText("757");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/base64");
  await page.getByLabel("Eingabe").fill("Grüße");
  await expect(page.getByLabel("Ergebnis", { exact: true })).toHaveText(
    "R3LDvMOfZQ==",
  );
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/uuid");
  await expect(page.getByLabel("UUIDs", { exact: true })).toContainText(
    /[0-9a-f]{8}-[0-9a-f]{4}-4/,
  );
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/passwort");
  const passwords = page
    .getByRole("list", { name: "Erzeugte Kennwörter" })
    .getByRole("listitem");
  await expect(passwords).toHaveCount(5);
  const first = (await passwords.first().locator("code").textContent()) ?? "";
  expect(first).toHaveLength(20);
  // Das Kennwort steht nie in der Adresszeile.
  expect(page.url()).not.toContain(encodeURIComponent(first));
  await expectNoA11yViolations(page);
});

test("IT-Tools: weitere Netzwerk-Tools", async ({ page }) => {
  await loginAs(page, ["Tools.User"], "Tina Tools");

  await page.goto("/it-tools/subnetting-bits");
  await expect(page.getByRole("row", { name: /^Subnetzmaske/ })).toContainText(
    "255.255.255.192",
  );
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/netze-zusammenfassen");
  await page
    .getByRole("textbox", { name: /^Netze, Adressen oder Bereiche/ })
    .fill("192.168.0.0/24\n192.168.1.0/24");
  await expect(
    page.getByLabel("Zusammengefasst (IPv4)", { exact: true }),
  ).toHaveText("192.168.0.0/23");
  expect(page.url()).not.toContain("192.168");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/firewall-regeln");
  await expect(page.getByText("Das Paket wird verworfen")).toBeVisible();
  await expect(
    page.getByText(/greift nie: Regel 3 deckt alles ab/),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // Die Herstellerliste liegt in der Werkbank; es gibt keine Abfrage nach außen.
  const foreign: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(page.url()).origin) {
      foreign.push(request.url());
    }
  });
  await page.goto("/it-tools/mac-adressen");
  await page
    .getByRole("textbox", { name: /^MAC-Adressen/ })
    .fill("00-00-00-AB-CD-EF");
  await expect(page.getByText("Xerox Corporation")).toBeVisible({
    timeout: 15000,
  });
  expect(foreign).toEqual([]);
  expect(page.url()).not.toContain("AB");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/ports?suche=3389");
  await expect(page.getByRole("row", { name: /^3389/ })).toContainText("RDP");
  await expect(
    page.getByLabel("Windows (PowerShell)", { exact: true }),
  ).toContainText("-LocalPort 3389");
  await expectNoA11yViolations(page);
});

test("IT-Tools: Encoding und Formatter", async ({ page }) => {
  await loginAs(page, ["Tools.User"], "Tina Tools");

  await page.goto("/it-tools/json-formatter?einrueckung=4");
  await page.getByRole("textbox", { name: "Eingabe" }).fill('{"a":1}');
  await expect(page.getByLabel("Formatiert", { exact: true })).toContainText(
    '    "a": 1',
  );
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/xml-formatter");
  await page.getByRole("textbox", { name: "Eingabe" }).fill("<a><b>x</b></a>");
  await expect(page.getByText("wohlgeformt · 2 Elemente")).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/yaml-formatter");
  await page.getByRole("textbox", { name: "Eingabe" }).fill("a:\n    b: 1\n");
  await expect(page.getByText("gültig", { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/url-encoder?modus=zerlegen");
  await page
    .getByRole("textbox", { name: "URL" })
    .fill("https://example.com/pfad?a=1");
  await expect(page.getByRole("row", { name: /^Host/ })).toContainText(
    "example.com",
  );
  expect(page.url()).not.toContain("example");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/html-entities");
  await page.getByRole("textbox", { name: "Eingabe" }).fill("<b>");
  await expect(page.getByLabel("Ergebnis", { exact: true })).toContainText(
    "&lt;b&gt;",
  );
  await expectNoA11yViolations(page);

  // Ein Token aus Beispielwerten, im Test zusammengesetzt (keine echten Zugangsdaten).
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${part({ alg: "HS256" })}.${part({ sub: "x", exp: 4102444800 })}.sig`;
  await page.goto("/it-tools/jwt");
  await page.getByRole("textbox", { name: "Token" }).fill(token);
  await expect(page.getByText("gültig (Zeitraum)")).toBeVisible();
  await expect(page.getByRole("row", { name: /^sub · Subjekt/ })).toBeVisible();
  expect(page.url()).not.toContain("?");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/saml");
  await page
    .getByRole("textbox", { name: /^SAMLResponse/ })
    .fill(
      '<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_1" AssertionConsumerServiceURL="https://sp.example.com/acs"/>',
    );
  await expect(page.getByRole("row", { name: /^ACS-URL/ })).toContainText(
    "sp.example.com",
  );
  await expect(page.getByText("keine Signatur")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("IT-Tools: Konverter und Text", async ({ page }) => {
  await loginAs(page, ["Tools.User"], "Tina Tools");

  await page.goto("/it-tools/csv-json");
  await page.getByRole("textbox", { name: "CSV" }).fill("a;b\n1;x");
  await expect(page.getByLabel("Ergebnis", { exact: true })).toContainText(
    '"a": 1',
  );
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/json-yaml-toml?nach=toml");
  await page.getByRole("textbox", { name: "Eingabe" }).fill('{"a":{"b":1}}');
  await expect(page.getByLabel("Ergebnis", { exact: true })).toContainText(
    "b = 1",
  );
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/zahlensysteme?zahl=0x80070005");
  await expect(page.getByRole("row", { name: /^32 Bit/ })).toContainText(
    "-2147024891",
  );
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/unix-zeit?wert=1700000000");
  await expect(
    page
      .getByRole("region", { name: "Datum zum Zeitstempel" })
      .getByRole("row", { name: /^UTC/ }),
  ).toContainText("2023-11-14T22:13:20.000Z");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/zeitzonen");
  await expect(page.getByRole("row", { name: /^Asia\/Tokyo/ })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/schreibweise");
  await page.getByRole("textbox", { name: "Eingabe" }).fill("Mein Server Name");
  await expect(page.getByRole("row", { name: /^kebab-case/ })).toContainText(
    "mein-server-name",
  );
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/listen?sortieren=asc");
  await page.getByRole("textbox", { name: "Eingabe" }).fill("b\na\nb");
  await expect(page.getByText("1 Duplikate entfernt")).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/regex");
  await page.getByRole("textbox", { name: "Ausdruck" }).fill("(\\d+)");
  await page.getByRole("textbox", { name: "Testtext" }).fill("a1b22");
  await expect(page.getByText("2 Treffer")).toBeVisible();
  expect(page.url()).not.toContain("a1b22");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/zeichen-zaehlen");
  await page.getByRole("textbox", { name: "Eingabe" }).fill("pass\u200bwort");
  await expect(
    page.getByRole("list", { name: "Gefundene Zeichen" }),
  ).toContainText("U+200B");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/text-diff");
  await page.getByRole("textbox", { name: "Vorher" }).fill("a\nb x");
  await page.getByRole("textbox", { name: "Nachher" }).fill("a\nb y\nc");
  await expect(page.getByText("2 hinzugefügt")).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByLabel("Ansicht").selectOption("unified");
  await expect(
    page.getByRole("region", { name: "Unified-Diff" }),
  ).toContainText("+c");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/sql?bereich=joins&join=full");
  await expect(
    page.getByRole("heading", { name: "Ergebnis: 6 Zeilen" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Mengendiagramm FULL OUTER JOIN" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("IT-Tools: Rechner und Cron", async ({ page }) => {
  await loginAs(page, ["Tools.User"], "Tina Tools");

  await page.goto("/it-tools/verfuegbarkeit");
  await expect(page.getByText("99,937 %")).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/speichereinheiten?wert=4");
  await expect(page.getByRole("row", { name: /^TiB/ })).toContainText(
    "3,63798",
  );
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/stromkosten?alternative=200");
  await expect(page.getByText(/pro Jahr gespart$/)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/speicherbedarf");
  await expect(page.getByRole("row", { name: /^\+5/ })).toContainText(
    "12,07 TB",
  );
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/uebertragungsdauer");
  await expect(page.getByText("12 h 20 min")).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/usv");
  await expect(page.getByText("1.111 VA")).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/voip");
  await expect(page.getByText("114 Gespräche")).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/raid");
  await expect(page.getByText("29,1 TiB")).toBeVisible();
  await expectNoA11yViolations(page);
  await page.goto("/it-tools/raid?bereich=ausfall");
  await page.getByRole("button", { name: "Platte 1" }).click();
  await expect(page.getByText("Degraded, 1 ausgefallen")).toBeVisible();
  await expectNoA11yViolations(page);
  await page.goto("/it-tools/raid?bereich=plattenbedarf");
  await expect(page.getByRole("row", { name: /^RAID 6 \(/ })).toContainText(
    "40 TB",
  );
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/cron?ausdruck=*%2F15+*+*+*+*");
  await expect(page.getByText("Alle 15 Minuten, jeden Tag.")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("IT-Tools: AD und M365, weitere Generatoren", async ({ page }) => {
  await loginAs(page, ["Tools.User"], "Tina Tools");

  await page.goto("/it-tools/ad-zeitstempel?wert=133485408000000000");
  await expect(
    page
      .getByRole("region", { name: "Datum zum AD-Wert" })
      .getByRole("row", { name: /^UTC/ }),
  ).toContainText("2024-01-01T00:00:00.000Z");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/dn");
  await page
    .getByRole("textbox", { name: "Distinguished Name" })
    .fill("CN=Max Muster,OU=Vertrieb,DC=example,DC=com");
  await expect(page.getByRole("row", { name: /^Domain/ })).toContainText(
    "example.com",
  );
  expect(page.url()).not.toContain("Muster");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/immutableid");
  await page
    .getByRole("textbox", { name: "Kennung" })
    .fill("748b2d72-706b-42f8-8b25-82fd8733860f");
  await expect(page.getByRole("row", { name: /^ImmutableID/ })).toContainText(
    "ci2LdGtw+EKLJYL9hzOGDw==",
  );
  expect(page.url()).not.toContain("748b");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/ldap-escaper");
  await page.getByRole("textbox", { name: "Eingabe" }).fill("Muster (IT) *");
  await expect(page.getByLabel("Ergebnis", { exact: true })).toContainText(
    "\\28IT\\29",
  );
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/useraccountcontrol?wert=514");
  await expect(
    page.getByRole("checkbox", { name: "ACCOUNTDISABLE" }),
  ).toBeChecked();
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/hash");
  await page.getByRole("textbox", { name: "Text (UTF-8)" }).fill("abc");
  await expect(page.getByRole("row", { name: /^SHA-256/ })).toContainText(
    "ba7816bf8f01cfea",
  );
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/hmac");
  await page.getByLabel("Geheimer Schlüssel").fill("key");
  await page
    .getByRole("textbox", { name: "Nachricht" })
    .fill("The quick brown fox jumps over the lazy dog");
  await expect(page.getByRole("row", { name: /^Hex/ })).toContainText(
    "f7bc83f430538424",
  );
  expect(page.url()).not.toContain("key");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/passwort-hash?format=apr1");
  await page.getByLabel("Kennwort", { exact: true }).fill("ein-testwert");
  await page.getByRole("button", { name: "Hash erzeugen" }).click();
  await expect(page.getByLabel("Hash", { exact: true })).toContainText(
    "$apr1$",
  );
  expect(page.url()).not.toContain("testwert");
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/lorem-ipsum");
  await expect(page.getByLabel("Text", { exact: true })).toContainText(
    "Lorem ipsum dolor sit amet",
  );
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/passphrase");
  await expect(
    page
      .getByRole("list", { name: "Erzeugte Passphrasen" })
      .getByRole("listitem"),
  ).toHaveCount(5, { timeout: 15000 });
  expect(page.url()).not.toContain("?");
  await expectNoA11yViolations(page);
});

test("IT-Tools: Kategorien in der Navigation und Tools in der Suche", async ({
  page,
}) => {
  await loginAs(page, ["Tools.User"], "Tina Tools");
  await page.goto("/it-tools");
  const menu = await openMenu(page);
  await menu.getByRole("link", { name: itemName("Text") }).click();
  await expect(page).toHaveURL(/\/it-tools\/kategorie\/text$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Text" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Regex-Tester" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Subnetz-Rechner" })).toHaveCount(
    0,
  );
  await expectNoA11yViolations(page);

  // Auf der Seite eines Tools ist seine Kategorie hervorgehoben.
  await page.goto("/it-tools/regex");
  const again = await openMenu(page);
  await expect(
    again.getByRole("link", { name: itemName("Text") }),
  ).toHaveAttribute("aria-current", "page");

  await page.goto("/suche?q=subnetz");
  await expect(
    page.getByRole("link", { name: "Subnetz-Rechner" }),
  ).toHaveAttribute("href", "/it-tools/subnetz");
  await expectNoA11yViolations(page);
});

test("IT-Tools: ohne die Rolle gibt es den Bereich nicht", async ({ page }) => {
  await loginAs(page, ["Config.Reader"], "Lea Leser");
  await page.goto("/it-tools");
  await expect(
    page.getByRole("heading", { name: "Seite nicht gefunden" }),
  ).toBeVisible();
  await page.goto("/it-tools/chmod");
  await expect(
    page.getByRole("heading", { name: "Seite nicht gefunden" }),
  ).toBeVisible();
  expect(await areaNames(page)).not.toContain("IT-Tools");
});

test("IT-Tools: Planung und E-Mail-Header", async ({ page }) => {
  await loginAs(page, ["Tools.User"], "Tina Tools");

  await page.goto("/it-tools/amortisation");
  await expect(
    page.getByRole("heading", { level: 1, name: "Amortisation" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: /^Anschaffungskosten/ })
    .fill("10000");
  await page.getByRole("textbox", { name: /^Rückfluss pro Jahr/ }).fill("4000");
  await page
    .getByRole("textbox", { name: /^Laufende Kosten pro Jahr/ })
    .fill("0");
  await expect(page.getByText("2 Jahre 6 Monate")).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/backup-planer");
  await expect(
    page.getByRole("heading", { level: 1, name: "Backup-Planer" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Wochenplan der Sicherungen" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/netzplan");
  await expect(page.getByText(/^Projektdauer:/)).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Netzplan als Diagramm/ }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/nutzwertanalyse");
  await expect(
    page.getByRole("region", { name: "Bewertungsmatrix" }),
  ).toBeVisible();
  await expect(page.getByText("Nutzwert des Siegers")).toBeVisible();
  await expectNoA11yViolations(page);
  // Die Tabelle steht nicht in der Adresszeile.
  await expect(page).toHaveURL(/\/it-tools\/nutzwertanalyse$/);

  await page.goto("/it-tools/mail-header");
  await page
    .getByLabel("E-Mail-Header oder kompletter Quelltext")
    .fill(
      [
        "Received: from mail.example.com (mail.example.com [192.0.2.10]) by mx.example.org with ESMTPS; Mon, 16 Nov 2026 10:00:05 +0000",
        "Received: from client.example.com by mail.example.com with ESMTPSA; Mon, 16 Nov 2026 10:00:00 +0000",
        "Authentication-Results: mx.example.org; spf=pass smtp.mailfrom=example.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com",
        "From: Absender <absender@example.com>",
        "To: empfaenger@example.org",
        "Subject: Test",
        "Date: Mon, 16 Nov 2026 10:00:00 +0000",
        "Message-ID: <test@example.com>",
      ].join("\n"),
    );
  await expect(
    page.getByRole("heading", { name: "Authentifizierung" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^Zustellweg \(2 Stationen/ }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("IT-Tools: QR-Code, Bild-Konverter und Zertifikate", async ({ page }) => {
  await loginAs(page, ["Tools.User"], "Tina Tools");

  await page.goto("/it-tools/qr-code");
  await expect(
    page.getByRole("heading", { level: 1, name: "QR-Code-Generator" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: /^Adresse/ })
    .fill("intranet.example.com/wiki");
  await expect(page.getByRole("img", { name: /^QR-Code: Link/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "SVG herunterladen" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  // Der Inhalt steht nicht in der Adresszeile.
  await expect(page).toHaveURL(/\/it-tools\/qr-code$/);

  await page.goto("/it-tools/bild-konverter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Bild-Konverter" }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Zielformat" })).toBeVisible();
  await expectNoA11yViolations(page);
  // PDF in beide Richtungen: Bild und PDF zu einer PDF, eine PDF-Seite als PNG
  await page
    .getByLabel("Bilder oder PDFs auswählen oder hierher ziehen")
    .setInputFiles([
      "tests/fixtures/drei-seiten.pdf",
      "tests/fixtures/logo.png",
    ]);
  await expect(page.getByText("PDF · 3 Seiten")).toBeVisible();
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await page.getByRole("button", { name: "2 Dateien in eine PDF" }).click();
  await expect(
    page.getByRole("button", { name: "PDF herunterladen" }),
  ).toBeVisible();
  await expect(page.getByText("bilder.pdf · 4 Seiten")).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "PNG", exact: true }).click();
  await page.getByLabel("Seiten (leer = alle)").fill("2");
  await page.getByRole("button", { name: "2 Dateien umwandeln" }).click();
  await expect(page.getByText("drei-seiten-seite-2.png")).toBeVisible();
  await expect(page).not.toHaveURL(/drei-seiten/);

  await page.goto("/it-tools/csr");
  await page
    .getByRole("textbox", { name: /^Common Name/ })
    .fill("www.example.com");
  await page
    .getByRole("button", { name: "CSR und Schlüssel erzeugen" })
    .click();
  const csr = page.getByLabel("CSR (an die CA übergeben)", { exact: true });
  await expect(csr).toContainText("BEGIN CERTIFICATE REQUEST");
  // Nach dem Klick ist die Seite gescrollt; die feste Kopfzeile verdeckt sonst Felder für die Prüfung.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectNoA11yViolations(page);
  await expect(page).toHaveURL(/\/it-tools\/csr$/);
  const csrText = (await csr.textContent()) ?? "";

  await page.goto("/it-tools/zertifikate");
  await page
    .getByRole("textbox", { name: /^Zertifikat, Kette, CSR/ })
    .fill(csrText);
  await expect(page.getByText("Zertifikatsanforderung (CSR)")).toBeVisible();
  await expect(page.getByText("CN=www.example.com").first()).toBeVisible();
  await expectNoA11yViolations(page);
});

test("IT-Tools: Abfragen über den Server und Suche", async ({ page }) => {
  await loginAs(page, ["Tools.User"], "Tina Tools");

  // Ohne Abfrage ins Internet: Stärke wird im Browser geschätzt, das Kennwort bleibt draußen.
  await page.goto("/it-tools/passwort-pruefen");
  await expect(
    page.getByRole("heading", { level: 1, name: "Passwort prüfen" }),
  ).toBeVisible();
  await page.getByLabel("Kennwort", { exact: true }).fill("passwort1");
  await expect(page.getByText("sehr schwach").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Jetzt prüfen" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  await expect(page).toHaveURL(/\/it-tools\/passwort-pruefen$/);

  await page.goto("/it-tools/dns-lookup");
  await expect(
    page.getByRole("heading", { level: 1, name: "DNS Lookup" }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Resolver" })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/mail-check");
  await expect(
    page.getByRole("heading", { level: 1, name: "DNS-/Mail-Check" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/it-tools/rdap");
  await page
    .getByRole("textbox", { name: /^Domain, IP-Adresse/ })
    .fill("kein domain");
  await page.getByRole("button", { name: "Abfragen" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "weder Domain noch IP-Adresse",
  );
  await expectNoA11yViolations(page);

  // Die globale Suche findet die Tools.
  await page.goto("/suche?q=dns");
  await expect(page.getByRole("link", { name: "DNS Lookup" })).toBeVisible();
});
