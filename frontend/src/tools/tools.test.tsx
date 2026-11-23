import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FAVORITES_KEY, findTool, readFavorites, searchTools, TOOLS } from "./index";
import { clampInt } from "./params";
import { ruleName } from "./ports/PortsTool";
import { ZONES_KEY } from "./timezone/TimezoneTool";
import { ToolPage, ToolsOverviewPage } from "./ToolsPage";

// Die Testumgebung kennt Web Crypto nicht vollständig; Prüfsummen und HMAC brauchen es.
beforeAll(() => {
  if (!globalThis.crypto.subtle) {
    Object.defineProperty(globalThis.crypto, "subtle", {
      value: webcrypto.subtle,
      configurable: true,
    });
  }
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("Verzeichnis der IT-Tools", () => {
  it("hat eindeutige Kennungen, die als Adresse taugen", () => {
    const ids = TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9-]{1,40}$/.test(id))).toBe(true);
    expect(findTool("chmod")?.name).toBe("chmod-Rechner");
    expect(findTool("gibt-es-nicht")).toBeUndefined();
  });

  it("sucht in Name, Beschreibung, Kategorie und Suchbegriffen", () => {
    expect(searchTools("").length).toBe(TOOLS.length);
    expect(searchTools("ipv6").map((tool) => tool.id)).toEqual(["subnetz", "mac-adressen"]);
    expect(searchTools("Generator zufall").map((tool) => tool.id)).toEqual(["uuid", "passwort"]);
    expect(searchTools("netzwerk")).toHaveLength(9);
    expect(searchTools("xyz-nichts")).toEqual([]);
  });

  it("liest nur gültige Favoriten", () => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(["chmod", "fremd", 7]));
    expect(readFavorites()).toEqual(["chmod"]);
    window.localStorage.setItem(FAVORITES_KEY, "kaputt");
    expect(readFavorites()).toEqual([]);
  });

  it("begrenzt Zahlen aus der Adresszeile", () => {
    expect(clampInt("500", 1, 100, 5)).toBe(100);
    expect(clampInt("abc", 1, 100, 5)).toBe(5);
    expect(clampInt("0", 1, 100, 5)).toBe(1);
  });
});

describe("ToolsOverviewPage", () => {
  it("zeigt die Tools nach Kategorie und filtert mit der Suche", () => {
    render(<ToolsOverviewPage />);
    expect(screen.getByRole("heading", { level: 1, name: "IT-Tools" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Netzwerk" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Formatter" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Subnetz-Rechner" })).toHaveAttribute(
      "href",
      "/it-tools/subnetz",
    );
    fireEvent.change(screen.getByLabelText("Tool suchen"), { target: { value: "url-safe" } });
    expect(screen.getByRole("status")).toHaveTextContent("1 Tool");
    expect(screen.queryByRole("link", { name: "Subnetz-Rechner" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Tool suchen"), { target: { value: "gibtsnicht" } });
    expect(screen.getByText("Kein Tool passt zu dieser Suche.")).toBeVisible();
  });

  it("zeigt auf der Seite einer Kategorie nur deren Tools", () => {
    render(<ToolsOverviewPage category="text" />);
    expect(screen.getByRole("heading", { level: 1, name: "Text" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Regex-Tester" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Subnetz-Rechner" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Tool suchen"), { target: { value: "subnetz" } });
    expect(screen.getByText("Kein Tool passt zu dieser Suche.")).toBeVisible();
  });

  it("merkt sich Favoriten und zeigt sie oben", () => {
    render(<ToolsOverviewPage />);
    expect(screen.queryByRole("heading", { name: "Favoriten" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "chmod-Rechner zu den Favoriten" }));
    const favorites = screen.getByRole("heading", { name: "Favoriten" }).closest("section");
    expect(within(favorites!).getByRole("link", { name: "chmod-Rechner" })).toBeVisible();
    expect(readFavorites()).toEqual(["chmod"]);
    fireEvent.click(
      within(favorites!).getByRole("button", { name: "chmod-Rechner aus den Favoriten entfernen" }),
    );
    expect(readFavorites()).toEqual([]);
  });
});

describe("ToolPage", () => {
  it("meldet ein unbekanntes Tool und führt zurück", () => {
    render(<ToolPage id="gibt-es-nicht" />);
    expect(screen.getByRole("heading", { name: "Tool nicht gefunden" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Zurück zu den IT-Tools" })).toHaveAttribute(
      "href",
      "/it-tools",
    );
  });

  it("Base64: kodiert, dekodiert und meldet ungültige Eingaben", async () => {
    render(<ToolPage id="base64" />);
    const input = await screen.findByLabelText("Eingabe");
    fireEvent.change(input, { target: { value: "Grüße" } });
    expect(screen.getByLabelText("Ergebnis")).toHaveTextContent("R3LDvMOfZQ==");
    fireEvent.change(screen.getByLabelText("Richtung"), { target: { value: "dekodieren" } });
    expect(window.location.search).toBe("?modus=dekodieren");
    fireEvent.change(input, { target: { value: "R3LDvMOfZQ==" } });
    expect(screen.getByLabelText("Ergebnis")).toHaveTextContent("Grüße");
    fireEvent.change(input, { target: { value: "%%%" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Ungültige Base64-Eingabe");
    // Der Text selbst steht nie in der Adresszeile.
    expect(window.location.search).not.toContain("%25");
  });

  it("UUID: erzeugt die gewünschte Anzahl", async () => {
    render(<ToolPage id="uuid" />);
    const output = await screen.findByLabelText("UUIDs");
    const lines = () => (output.textContent ?? "").trim().split("\n");
    expect(lines()).toHaveLength(5);
    expect(lines()[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    fireEvent.change(screen.getByLabelText("Anzahl"), { target: { value: "2" } });
    expect(lines()).toHaveLength(2);
    const before = output.textContent;
    fireEvent.click(screen.getByRole("button", { name: "Neu erzeugen" }));
    expect(output.textContent).not.toBe(before);
  });

  it("chmod: rechnet zwischen den Schreibweisen um", async () => {
    render(<ToolPage id="chmod" />);
    const input = await screen.findByLabelText(/^Rechte \(755/);
    expect(input).toHaveValue("755");
    expect(screen.getByLabelText("Andere Schreiben")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("Andere Schreiben"));
    expect(input).toHaveValue("757");
    expect(screen.getByText("⚠ Für alle beschreibbar")).toBeVisible();
    fireEvent.change(input, { target: { value: "rw-r-----" } });
    expect(screen.getByRole("row", { name: /^Oktal/ })).toHaveTextContent("640");
    fireEvent.change(input, { target: { value: "unsinn" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Nicht erkannt");
  });

  it("Passwort: erzeugt Kennwörter nach den Einstellungen, ohne sie in die Adresse zu schreiben", async () => {
    render(<ToolPage id="passwort" />);
    const list = await screen.findByRole("list", { name: "Erzeugte Kennwörter" });
    const passwords = () =>
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.querySelector("code")?.textContent ?? "");
    expect(passwords()).toHaveLength(5);
    expect(passwords().every((password) => password.length === 20)).toBe(true);
    fireEvent.change(screen.getByLabelText("Länge genau"), { target: { value: "32" } });
    fireEvent.click(screen.getByLabelText("Sonderzeichen (!#$%…)"));
    expect(passwords().every((password) => /^[A-Za-z0-9]{32}$/.test(password))).toBe(true);
    expect(window.location.search).toBe("?laenge=32&sonder=0");
    for (const label of ["Kleinbuchstaben (a–z)", "Großbuchstaben (A–Z)", "Ziffern (0–9)"]) {
      fireEvent.click(screen.getByLabelText(label));
    }
    expect(screen.getByRole("alert")).toHaveTextContent("Mindestens eine Zeichengruppe");
  });

  it("Subnetz: berechnet ein Netz, prüft eine Adresse und teilt auf", async () => {
    render(<ToolPage id="subnetz" />);
    const input = await screen.findByLabelText("Netz, Adresse oder Bereich");
    fireEvent.change(input, { target: { value: "192.168.10.77/24" } });
    expect(screen.getByText("192.168.10.0/24", { selector: ".tool-result-title" })).toBeVisible();
    expect(screen.getByRole("row", { name: /^Subnetzmaske/ })).toHaveTextContent("255.255.255.0");
    expect(screen.getByRole("row", { name: /^Broadcast/ })).toHaveTextContent("192.168.10.255");
    expect(screen.getByText(/Die eingegebene Adresse/)).toHaveTextContent("Nr. 77");
    fireEvent.change(screen.getByLabelText("Adresse"), { target: { value: "192.168.11.5" } });
    expect(screen.getByText(/liegt nicht in 192.168.10.0\/24/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("In Netze der Größe"), { target: { value: "26" } });
    const subnets = screen.getByRole("region", { name: "Teilnetze" });
    expect(within(subnets).getAllByRole("row")).toHaveLength(5);
    fireEvent.click(within(subnets).getByRole("button", { name: "192.168.10.64/26" }));
    expect(input).toHaveValue("192.168.10.64/26");
    fireEvent.change(input, { target: { value: "10.0.0.10 - 10.0.0.50" } });
    expect(screen.getByRole("heading", { name: "Bereich als CIDR-Blöcke" })).toBeVisible();
    fireEvent.change(input, { target: { value: "999.1.1.1/24" } });
    expect(screen.getByRole("alert")).toBeVisible();
  });

  it("Subnetting-Bits: zeigt geborgte Bits, Maske und die Subnetze", async () => {
    render(<ToolPage id="subnetting-bits" />);
    expect(await screen.findByLabelText("Ausgangsnetz")).toHaveValue("192.168.10.0/24");
    expect(screen.getByRole("row", { name: /^Neues Präfix/ })).toHaveTextContent("/24 + 2 = /26");
    expect(screen.getByRole("row", { name: /^Subnetzmaske/ })).toHaveTextContent("255.255.255.192");
    expect(
      within(screen.getByRole("region", { name: "Subnetze" })).getAllByRole("row"),
    ).toHaveLength(5);
    fireEvent.change(screen.getByLabelText("Hosts je Subnetz (0 = egal)"), {
      target: { value: "100" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Das passt nicht");
    expect(window.location.search).toBe("?hosts=100");
  });

  it("Netze zusammenfassen: fasst zusammen und behält die Liste für sich", async () => {
    render(<ToolPage id="netze-zusammenfassen" />);
    fireEvent.change(await screen.findByLabelText(/^Netze, Adressen oder Bereiche/), {
      target: { value: "192.168.0.0/24\n192.168.1.0/24\nunsinn" },
    });
    expect(screen.getByLabelText("Zusammengefasst (IPv4)")).toHaveTextContent("192.168.0.0/23");
    expect(screen.getByRole("alert")).toHaveTextContent("Nicht erkannt: unsinn");
    expect(window.location.search).toBe("");
  });

  it("Firewall-Regeln: zeigt, welche Regel zuerst greift, und findet verdeckte Regeln", async () => {
    render(<ToolPage id="firewall-regeln" />);
    await screen.findByLabelText(/^Regeln/);
    // Das Beispiel: Die Sperre in Regel 3 verdeckt die RDP-Freigabe in Regel 4.
    expect(screen.getByText("Das Paket wird verworfen")).toBeVisible();
    expect(screen.getByText(/Regel 3 passt als erste/)).toBeVisible();
    expect(screen.getByText(/greift nie: Regel 3 deckt alles ab/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Ziel"), { target: { value: "10.0.20.10" } });
    fireEvent.change(screen.getByLabelText("Zielport"), { target: { value: "443" } });
    expect(screen.getByText("Das Paket wird durchgelassen")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Zielport"), { target: { value: "25" } });
    expect(screen.getByText(/Keine Regel passt/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Quelle"), { target: { value: "kaputt" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Quelladresse des Testpakets ist ungültig");
    expect(window.location.search).toBe("");
  });

  it("MAC-Adressen: wandelt um, erkennt die Art und schlägt den Hersteller nach", async () => {
    render(<ToolPage id="mac-adressen" />);
    fireEvent.change(await screen.findByRole("textbox", { name: /^MAC-Adressen/ }), {
      target: { value: "00-00-00-AB-CD-EF" },
    });
    expect(screen.getByLabelText("1 Adresse umgewandelt")).toHaveTextContent("00:00:00:ab:cd:ef");
    expect(screen.getByText("Unicast, global")).toBeVisible();
    expect(await screen.findByText("Xerox Corporation", {}, { timeout: 10000 })).toBeVisible();
    expect(screen.getByRole("row", { name: /^IPv6 Link-Local/ })).toHaveTextContent(
      "fe80::200:ff:feab:cdef",
    );
    fireEvent.change(screen.getByLabelText("Ausgabeformat"), { target: { value: "cisco" } });
    expect(screen.getByLabelText("1 Adresse umgewandelt")).toHaveTextContent("0000.00ab.cdef");
    // In der Adresszeile steht nur das Format, nie die Adresse.
    expect(window.location.search).toBe("?format=cisco");
  }, 20000);

  it("Ports: sucht nach Nummer und baut Firewall-Befehle mit harmlosem Namen", async () => {
    render(<ToolPage id="ports" />);
    fireEvent.change(await screen.findByLabelText(/^Port oder Dienst/), {
      target: { value: "3389" },
    });
    expect(screen.getByRole("row", { name: /^3389/ })).toHaveTextContent("RDP");
    expect(screen.getByLabelText("Windows (PowerShell)")).toHaveTextContent(
      'New-NetFirewallRule -DisplayName "3389 (TCP)"',
    );
    expect(ruleName('x" ; Remove-Item C:\\ #', undefined)).toBe("Freigabe");
    expect(ruleName("$(calc)", undefined)).toBe("Freigabe");
    expect(ruleName("", "Windows & AD")).toBe("Windows und AD");
    expect(ruleName("kerberos", undefined)).toBe("kerberos");
  });

  it("URL-Encoder: kodiert, dekodiert und zerlegt, ohne den Text in die Adresse zu schreiben", async () => {
    render(<ToolPage id="url-encoder" />);
    const input = await screen.findByRole("textbox", { name: "Eingabe" });
    fireEvent.change(input, { target: { value: "a b&c" } });
    expect(screen.getByLabelText("Ergebnis")).toHaveTextContent("a%20b%26c");
    fireEvent.change(screen.getByLabelText("Art"), { target: { value: "form" } });
    expect(screen.getByLabelText("Ergebnis")).toHaveTextContent("a+b%26c");
    fireEvent.change(screen.getByLabelText("Modus"), { target: { value: "zerlegen" } });
    expect(window.location.search).toBe("?modus=zerlegen&art=form");
    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), {
      target: { value: "https://nutzer:geheim@example.com:8443/pfad?a=1&a=2#oben" },
    });
    const parts = within(screen.getByRole("region", { name: "Bestandteile der URL" }));
    expect(parts.getByRole("row", { name: /^Host/ })).toHaveTextContent("example.com");
    expect(parts.getByRole("row", { name: /^Kennwort/ })).toHaveTextContent("nicht angezeigt");
    expect(parts.queryByText(/geheim/)).toBeNull();
    const query = within(screen.getByRole("region", { name: "Parameter" }));
    expect(query.getByRole("row", { name: /^a \(2\)/ })).toHaveTextContent("2");
    expect(window.location.search).not.toContain("example");
  });

  it("HTML-Entities: wandelt in beide Richtungen", async () => {
    render(<ToolPage id="html-entities" />);
    const input = await screen.findByRole("textbox", { name: "Eingabe" });
    fireEvent.change(input, { target: { value: "<b>Grüße</b>" } });
    expect(screen.getByLabelText("Ergebnis")).toHaveTextContent("&lt;b&gt;Grüße&lt;/b&gt;");
    fireEvent.change(screen.getByLabelText("Umfang"), { target: { value: "named" } });
    expect(screen.getByLabelText("Ergebnis")).toHaveTextContent("Gr&uuml;&szlig;e");
    fireEvent.change(screen.getByLabelText("Richtung"), { target: { value: "dekodieren" } });
    fireEvent.change(input, { target: { value: "&euro; &amp; &#228;" } });
    expect(screen.getByLabelText("Ergebnis")).toHaveTextContent("€ & ä");
  });

  it("JWT: zeigt Claims und Gültigkeit, das Token bleibt aus der Adresse", async () => {
    render(<ToolPage id="jwt" />);
    const payload = btoa(JSON.stringify({ sub: "x", exp: 4102444800 })).replace(/=+$/, "");
    const header = btoa(JSON.stringify({ alg: "HS256", kid: "k1" })).replace(/=+$/, "");
    fireEvent.change(await screen.findByRole("textbox", { name: "Token" }), {
      target: { value: `${header}.${payload}.sig` },
    });
    expect(screen.getByText("gültig (Zeitraum)")).toBeVisible();
    expect(screen.getByText("kid k1")).toBeVisible();
    expect(screen.getByRole("row", { name: /^exp · Läuft ab/ })).toHaveTextContent("2100");
    expect(screen.getByRole("button", { name: "Prüfen" })).toBeDisabled();
    expect(window.location.search).toBe("");
    fireEvent.change(screen.getByRole("textbox", { name: "Token" }), {
      target: { value: "a.b" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("3 durch Punkte getrennte Teile");
  });

  it("SAML: wertet eine Nachricht aus", async () => {
    render(<ToolPage id="saml" />);
    const xml =
      '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r1">' +
      "<saml:Issuer>https://idp.example.com/</saml:Issuer>" +
      '<saml:Assertion ID="_a1"><saml:AttributeStatement><saml:Attribute Name="gruppe"><saml:AttributeValue>g1</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>' +
      "</samlp:Response>";
    fireEvent.change(await screen.findByRole("textbox", { name: /^SAMLResponse/ }), {
      target: { value: xml },
    });
    expect(await screen.findByText("keine Signatur")).toBeVisible();
    expect(screen.getByRole("row", { name: /^Aussteller/ })).toHaveTextContent(
      "https://idp.example.com/",
    );
    expect(screen.getByRole("row", { name: /^gruppe/ })).toHaveTextContent("g1");
    fireEvent.change(screen.getByRole("textbox", { name: /^SAMLResponse/ }), {
      target: { value: "<a><b></a>" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("passt nicht");
  });

  it("JSON-Formatter: formatiert, minifiziert und meldet Fehler", async () => {
    render(<ToolPage id="json-formatter" />);
    const input = await screen.findByRole("textbox", { name: "Eingabe" });
    fireEvent.change(input, { target: { value: '{"a":[1,2]}' } });
    expect(screen.getByLabelText("Formatiert").textContent).toBe(
      '{\n  "a": [\n    1,\n    2\n  ]\n}',
    );
    fireEvent.change(screen.getByLabelText("Einrückung"), { target: { value: "minify" } });
    expect(window.location.search).toBe("?einrueckung=minify");
    expect(screen.getByLabelText("Formatiert").textContent).toBe('{"a":[1,2]}');
    fireEvent.change(input, { target: { value: "{a}" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Ungültiges JSON");
  });

  it("YAML-Formatter: prüft und formatiert", async () => {
    render(<ToolPage id="yaml-formatter" />);
    const input = await screen.findByRole("textbox", { name: "Eingabe" });
    fireEvent.change(input, { target: { value: "a:\n    b: 1\n    c: [x, y]\n" } });
    expect(screen.getByText("gültig")).toBeVisible();
    expect(screen.getByLabelText("Formatiert").textContent).toContain("a:\n  b: 1\n");
    fireEvent.change(input, { target: { value: "a: [1, 2" } });
    expect(screen.getByRole("alert")).toBeVisible();
  });

  it("XML-Formatter: prüft, rückt ein und minimiert", async () => {
    render(<ToolPage id="xml-formatter" />);
    const input = await screen.findByRole("textbox", { name: "Eingabe" });
    fireEvent.change(input, { target: { value: "<a><b>x</b><c/></a>" } });
    expect(screen.getByText("wohlgeformt · 3 Elemente")).toBeVisible();
    expect(screen.getByLabelText("Formatiert").textContent).toBe("<a>\n  <b>x</b>\n  <c/>\n</a>");
    fireEvent.change(screen.getByLabelText("Ausgabe"), { target: { value: "minify" } });
    expect(screen.getByLabelText("Formatiert").textContent).toBe("<a><b>x</b><c/></a>");
    fireEvent.change(input, { target: { value: "<a>\n<b></a>" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Zeile 2");
  });

  it("CSV ↔ JSON: wandelt in beide Richtungen", async () => {
    render(<ToolPage id="csv-json" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "CSV" }), {
      target: { value: "a;b\n1;x" },
    });
    expect(screen.getByText("1 Zeilen · 2 Spalten · Trennzeichen „;“")).toBeVisible();
    expect(screen.getByLabelText("Ergebnis")).toHaveTextContent('"a": 1');
    fireEvent.change(screen.getByLabelText("Richtung"), { target: { value: "json-csv" } });
    expect(window.location.search).toBe("?richtung=json-csv");
    fireEvent.change(screen.getByRole("textbox", { name: /^JSON/ }), {
      target: { value: '[{"a":1,"b":{"c":2}}]' },
    });
    expect(screen.getByLabelText("Ergebnis")).toHaveTextContent("a;b.c");
    fireEvent.change(screen.getByRole("textbox", { name: /^JSON/ }), { target: { value: "{" } });
    expect(screen.getByRole("alert")).toBeVisible();
  });

  it("JSON ↔ YAML ↔ TOML: erkennt das Format und wandelt um", async () => {
    render(<ToolPage id="json-yaml-toml" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Eingabe" }), {
      target: { value: '{"a":{"b":1}}' },
    });
    expect(screen.getByText("erkannt: JSON")).toBeVisible();
    expect(screen.getByLabelText("Ergebnis").textContent).toBe("a:\n  b: 1\n");
    fireEvent.change(screen.getByLabelText("Nach"), { target: { value: "toml" } });
    expect(screen.getByLabelText("Ergebnis").textContent).toBe("[a]\nb = 1\n");
    expect(window.location.search).toBe("?nach=toml");
  });

  it("Zahlensysteme: rechnet um und zeigt das Zweierkomplement", async () => {
    render(<ToolPage id="zahlensysteme" />);
    expect(await screen.findByRole("row", { name: /^Hexadezimal/ })).toHaveTextContent("0xFF");
    fireEvent.change(screen.getByRole("textbox", { name: "Zahl" }), {
      target: { value: "0x80070005" },
    });
    expect(screen.getByRole("row", { name: /^32 Bit/ })).toHaveTextContent("-2147024891");
    expect(screen.getByRole("row", { name: /^8 Bit/ })).toHaveTextContent("passt nicht");
    fireEvent.change(screen.getByRole("textbox", { name: "Zahl" }), { target: { value: "xyz" } });
    expect(screen.getByRole("alert")).toBeVisible();
  });

  it("Unix-Zeitstempel: rechnet in ein Datum um", async () => {
    render(<ToolPage id="unix-zeit" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Zeitstempel" }), {
      target: { value: "1700000000" },
    });
    const table = within(screen.getByRole("region", { name: "Datum zum Zeitstempel" }));
    expect(table.getByRole("row", { name: /^UTC/ })).toHaveTextContent("2023-11-14T22:13:20.000Z");
    expect(table.getByRole("row", { name: /^Erkannt als/ })).toHaveTextContent("Sekunden");
    expect(screen.getByRole("region", { name: "Zeitstempel zum Datum" })).toBeVisible();
  });

  it("Zeitzonen: zeigt die Liste, merkt sich Änderungen und stellt den Standard wieder her", async () => {
    render(<ToolPage id="zeitzonen" />);
    const table = within(await screen.findByRole("region", { name: "Uhrzeit je Zeitzone" }));
    expect(table.getByRole("row", { name: /^Europe\/Berlin/ })).toBeVisible();
    fireEvent.click(table.getByRole("button", { name: "Entfernen – Europe/Berlin" }));
    expect(table.queryByRole("row", { name: /^Europe\/Berlin/ })).toBeNull();
    expect(window.localStorage.getItem(ZONES_KEY)).not.toContain("Europe/Berlin");
    fireEvent.click(screen.getByRole("button", { name: "Standardliste" }));
    expect(table.getByRole("row", { name: /^Europe\/Berlin/ })).toBeVisible();
    expect(window.location.search).toBe("");
  });

  it("Schreibweise: zeigt alle Varianten", async () => {
    render(<ToolPage id="schreibweise" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Eingabe" }), {
      target: { value: "Mein Server Name" },
    });
    expect(screen.getByRole("row", { name: /^snake_case/ })).toHaveTextContent("mein_server_name");
    expect(screen.getByRole("row", { name: /^camelCase/ })).toHaveTextContent("meinServerName");
  });

  it("Listen: bereinigt, formatiert und vergleicht", async () => {
    render(<ToolPage id="listen" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Eingabe" }), {
      target: { value: "b\na\nb" },
    });
    expect(screen.getByText("2 Einträge")).toBeVisible();
    expect(screen.getByText("1 Duplikate entfernt")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Sortieren"), { target: { value: "asc" } });
    expect(screen.getByLabelText("Ergebnis").textContent).toBe("a\nb");
    fireEvent.change(screen.getByLabelText("Ausgabe"), { target: { value: "powershell" } });
    expect(screen.getByLabelText("Ergebnis").textContent).toBe('@("a", "b")');
    fireEvent.change(screen.getByLabelText("Funktion"), { target: { value: "vergleichen" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Liste B" }), {
      target: { value: "a\nc" },
    });
    expect(screen.getByLabelText("Nur in A (1)")).toHaveTextContent("b");
    expect(screen.getByLabelText("Nur in B (1)")).toHaveTextContent("c");
    expect(screen.getByLabelText("In beiden (1)")).toHaveTextContent("a");
  });

  it("Regex: markiert Treffer, zeigt Gruppen und ersetzt; der Testtext bleibt aus der Adresse", async () => {
    render(<ToolPage id="regex" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Ausdruck" }), {
      target: { value: "(\\d+)" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Testtext" }), {
      target: { value: "a1b22" },
    });
    expect(screen.getByText("2 Treffer")).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "$1" })).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Ersetzen ausprobieren/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Ersetzen durch" }), {
      target: { value: "<$1>" },
    });
    expect(screen.getByLabelText("Ergebnis").textContent).toBe("a<1>b<22>");
    expect(window.location.search).toContain("ausdruck=");
    expect(window.location.search).not.toContain("a1b22");
    fireEvent.change(screen.getByRole("textbox", { name: "Ausdruck" }), {
      target: { value: "(" },
    });
    expect(screen.getByRole("alert")).toBeVisible();
  });

  it("Zeichen zählen: findet unsichtbare Zeichen und bereinigt", async () => {
    render(<ToolPage id="zeichen-zaehlen" />);
    const input = await screen.findByRole("textbox", { name: "Eingabe" });
    fireEvent.change(input, { target: { value: "pass\u200bwort" } });
    expect(screen.getByRole("list", { name: "Gefundene Zeichen" })).toHaveTextContent("U+200B");
    fireEvent.click(screen.getByRole("button", { name: "Bereinigten Text übernehmen" }));
    expect(input).toHaveValue("passwort");
    expect(screen.getByText("Keine gefunden.")).toBeVisible();
  });

  it("Text-Diff: vergleicht nebeneinander und als Unified-Diff", async () => {
    render(<ToolPage id="text-diff" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Vorher" }), {
      target: { value: "a\nb" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Nachher" }), {
      target: { value: "a\nc" },
    });
    expect(screen.getByText("1 entfernt")).toBeVisible();
    expect(screen.getByText("1 hinzugefügt")).toBeVisible();
    expect(screen.getByRole("region", { name: "Vergleich" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Ansicht"), { target: { value: "unified" } });
    expect(window.location.search).toBe("?ansicht=unified");
    const unified = screen.getByRole("region", { name: "Unified-Diff" });
    expect(unified).toHaveTextContent("-b");
    expect(unified).toHaveTextContent("+c");
    fireEvent.change(screen.getByRole("textbox", { name: "Nachher" }), {
      target: { value: "a\nb" },
    });
    expect(screen.getByText("identisch")).toBeVisible();
  });

  it("SQL: formatiert und führt JOINs an Beispieltabellen vor", async () => {
    render(<ToolPage id="sql" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Eingabe" }), {
      target: { value: "select a from t where x=1" },
    });
    expect(screen.getByLabelText("Formatiert").textContent).toBe(
      "SELECT\n  a\nFROM t\nWHERE\n  x = 1",
    );
    fireEvent.change(screen.getByLabelText("Bereich"), { target: { value: "joins" } });
    expect(screen.getByRole("heading", { name: "Ergebnis: 5 Zeilen" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Mengendiagramm LEFT JOIN" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("JOIN-Art"), { target: { value: "inner" } });
    expect(screen.getByRole("heading", { name: "Ergebnis: 3 Zeilen" })).toBeVisible();
    expect(window.location.search).toBe("?bereich=joins&join=inner");
    const left = within(screen.getByRole("group", { name: "Linke Tabelle" }));
    fireEvent.change(left.getByRole("textbox", { name: "Name" }), {
      target: { value: "bestellungen" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("unterschiedliche Namen");
  });

  const tile = (label: string) => screen.getByText(label, { selector: "dt" }).nextSibling;

  it("Verfügbarkeit: rechnet Ausfallzeit und Gesamtsystem", async () => {
    render(<ToolPage id="verfuegbarkeit" />);
    const input = await screen.findByRole("textbox", { name: /^Verfügbarkeit/ });
    expect(screen.getAllByText("8 h 45 min").length).toBeGreaterThan(0);
    expect(tile("Gesamtverfügbarkeit")).toHaveTextContent("99,937 %");
    expect(tile("schwächstes Glied")).toHaveTextContent("Switch");
    fireEvent.change(input, { target: { value: "abc" } });
    expect(screen.getByRole("alert")).toHaveTextContent("zwischen 0 und 100");
    // Die Liste der Komponenten steht nicht in der Adresszeile.
    expect(window.location.search).not.toContain("Firewall");
  });

  it("Speichereinheiten: rechnet dezimal und binär um", async () => {
    render(<ToolPage id="speichereinheiten" />);
    expect(await screen.findByRole("row", { name: /^GiB/ })).toHaveTextContent("931,323");
    expect(screen.getByRole("row", { name: /^TB \(Eingabe\)/ })).toHaveTextContent("1");
    fireEvent.change(screen.getByRole("textbox", { name: "Wert" }), { target: { value: "x" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Zahl");
  });

  it("Stromkosten: rechnet Kosten und vergleicht mit einer Alternative", async () => {
    render(<ToolPage id="stromkosten" />);
    await screen.findByRole("textbox", { name: /^Strompreis/ });
    expect(tile("pro Jahr")).toHaveTextContent("981,12 €");
    fireEvent.change(screen.getByRole("textbox", { name: /^Leistungsaufnahme der Alternative/ }), {
      target: { value: "200" },
    });
    expect(screen.getByText(/pro Jahr gespart$/)).toBeVisible();
    expect(window.location.search).toBe("?alternative=200");
  });

  it("Speicherbedarf: rechnet heute und in fünf Jahren", async () => {
    render(<ToolPage id="speicherbedarf" />);
    await screen.findByRole("textbox", { name: /^Datenmenge heute/ });
    expect(tile("Bedarf heute (mit Reserve)")).toHaveTextContent("6 TB");
    expect(tile("Bedarf in 5 Jahren")).toHaveTextContent("12,07 TB");
    expect(screen.getByRole("row", { name: /^\+5/ })).toHaveTextContent("12,07 TB");
  });

  it("Übertragungsdauer: rechnet Dauer und nötige Bandbreite", async () => {
    render(<ToolPage id="uebertragungsdauer" />);
    await screen.findByRole("textbox", { name: "Datenmenge" });
    expect(screen.getByRole("status")).toHaveTextContent("12 h 20 min");
    fireEvent.click(screen.getByRole("button", { name: "1 Gbit/s" }));
    expect(window.location.search).toBe("?rate=1&einheit=Gbit");
    fireEvent.change(screen.getByLabelText("Modus"), { target: { value: "bandbreite" } });
    expect(screen.getByRole("status")).toHaveTextContent("154,32 Mbit/s");
  });

  it("USV: empfiehlt die Größe und schätzt die Laufzeit", async () => {
    render(<ToolPage id="usv" />);
    await screen.findByRole("textbox", { name: /^Leistung aller Geräte/ });
    expect(tile("USV mindestens (Scheinleistung)")).toHaveTextContent("1.111 VA");
    expect(tile("Überbrückungszeit (geschätzt)")).toHaveTextContent("23 min 20 s");
  });

  it("VoIP: rechnet die Bandbreite je Gespräch und die Zahl möglicher Gespräche", async () => {
    render(<ToolPage id="voip" />);
    await screen.findByLabelText("Codec");
    expect(tile("je Gespräch und Richtung")).toHaveTextContent("87,2 kbit/s");
    expect(screen.getByText("114 Gespräche")).toBeVisible();
  });

  it("RAID: rechnet Kapazität und Plattenbedarf und simuliert Ausfälle", async () => {
    render(<ToolPage id="raid" />);
    await screen.findByLabelText("Bereich");
    expect(tile("nutzbar (Hersteller-TB)")).toHaveTextContent("32 TB");
    fireEvent.change(screen.getByLabelText("Bereich"), { target: { value: "plattenbedarf" } });
    expect(screen.getByRole("row", { name: /^RAID 6 \(doppelte/ })).toHaveTextContent("40 TB");
    expect(screen.getByRole("row", { name: /^RAID 1 \(Spiegel/ })).toHaveTextContent(
      "nicht erreichbar",
    );
    fireEvent.change(screen.getByLabelText("Bereich"), { target: { value: "ausfall" } });
    fireEvent.click(screen.getByRole("button", { name: "Platte 1" }));
    expect(screen.getByText("Degraded, 1 ausgefallen")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Platte 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Platte 3" }));
    expect(screen.getByText("Datenverlust")).toBeVisible();
    expect(window.location.search).toBe("?bereich=ausfall");
    fireEvent.click(screen.getByRole("button", { name: "Alle Platten wieder einsetzen" }));
    expect(screen.getByText("Alles in Ordnung")).toBeVisible();
  });

  it("Cron: erklärt den Ausdruck und zeigt die nächsten Ausführungen", async () => {
    render(<ToolPage id="cron" />);
    const input = await screen.findByRole("textbox", { name: "Cron-Ausdruck" });
    expect(screen.getByRole("status")).toHaveTextContent("Um 08:00 Uhr, montags bis freitags.");
    expect(
      within(screen.getByRole("list", { name: "Nächste Ausführungen" })).getAllByRole("listitem"),
    ).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: /^\*\/5 \* \* \* \*/ }));
    expect(screen.getByRole("status")).toHaveTextContent("Alle 5 Minuten");
    expect(window.location.search).toContain("ausdruck=");
    fireEvent.change(input, { target: { value: "bla" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Erwartet 5 Felder");
  });

  it("AD-Zeitstempel: rechnet FILETIME in ein Datum um und erklärt Sonderwerte", async () => {
    render(<ToolPage id="ad-zeitstempel" />);
    const input = await screen.findByRole("textbox", { name: "AD-Wert" });
    fireEvent.change(input, { target: { value: "133485408000000000" } });
    const table = within(screen.getByRole("region", { name: "Datum zum AD-Wert" }));
    expect(table.getByRole("row", { name: /^UTC/ })).toHaveTextContent("2024-01-01T00:00:00.000Z");
    fireEvent.change(input, { target: { value: "0" } });
    expect(screen.getByText(/^0 = nicht gesetzt/)).toBeVisible();
    fireEvent.change(input, { target: { value: "abc" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Ungültige Generalized Time");
  });

  it("DN-Zerleger: zerlegt einen DN und wandelt canonicalName um, ohne Namen in der Adresse", async () => {
    render(<ToolPage id="dn" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Distinguished Name" }), {
      target: { value: "CN=Muster\\, Max,OU=Vertrieb,OU=Benutzer,DC=example,DC=com" },
    });
    expect(screen.getByRole("row", { name: /^canonicalName/ })).toHaveTextContent(
      "example.com/Benutzer/Vertrieb/Muster, Max",
    );
    expect(
      within(screen.getByRole("region", { name: "Ebenen des DN" })).getAllByRole("row"),
    ).toHaveLength(6);
    fireEvent.change(screen.getByRole("textbox", { name: "canonicalName" }), {
      target: { value: "example.com/Benutzer/Vertrieb/Max Muster" },
    });
    expect(screen.getByRole("row", { name: /^DN/ })).toHaveTextContent(
      "CN=Max Muster,OU=Vertrieb,OU=Benutzer,DC=example,DC=com",
    );
    expect(window.location.search).toBe("");
  });

  it("ImmutableID: rechnet die Schreibweisen ineinander um", async () => {
    render(<ToolPage id="immutableid" />);
    const input = await screen.findByRole("textbox", { name: "Kennung" });
    fireEvent.change(input, { target: { value: "748b2d72-706b-42f8-8b25-82fd8733860f" } });
    expect(screen.getByText(/^Erkannt als/)).toHaveTextContent("Erkannt als objectGUID");
    expect(screen.getByRole("row", { name: /^ImmutableID/ })).toHaveTextContent(
      "ci2LdGtw+EKLJYL9hzOGDw==",
    );
    expect(window.location.search).toBe("");
    fireEvent.change(input, { target: { value: "kaputt" } });
    expect(screen.getByRole("alert")).toBeVisible();
  });

  it("LDAP-Escaper: maskiert für Filter und DN", async () => {
    render(<ToolPage id="ldap-escaper" />);
    const input = await screen.findByRole("textbox", { name: "Eingabe" });
    fireEvent.change(input, { target: { value: "Muster (IT) *" } });
    expect(screen.getByLabelText("Ergebnis").textContent).toBe("Muster \\28IT\\29 \\2a");
    fireEvent.change(screen.getByLabelText("Modus"), { target: { value: "dn" } });
    fireEvent.change(input, { target: { value: "Muster, Max" } });
    expect(screen.getByLabelText("Ergebnis").textContent).toBe("Muster\\, Max");
    expect(window.location.search).toBe("?modus=dn");
  });

  it("userAccountControl: zerlegt den Wert und setzt Flags", async () => {
    render(<ToolPage id="useraccountcontrol" />);
    const input = await screen.findByRole("textbox", { name: "Wert" });
    expect(screen.getByRole("checkbox", { name: "NORMAL_ACCOUNT" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "ACCOUNTDISABLE" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "ACCOUNTDISABLE" }));
    expect(input).toHaveValue("514");
    expect(window.location.search).toBe("?wert=514");
    expect(screen.getByRole("button", { name: /^514/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(input, { target: { value: "xyz" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte gib eine Zahl ein");
  });

  it("Prüfsummen: berechnet Hashes und vergleicht mit einem erwarteten Wert", async () => {
    render(<ToolPage id="hash" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Text (UTF-8)" }), {
      target: { value: "abc" },
    });
    const table = within(screen.getByRole("region", { name: "Prüfsummen" }));
    await vi.waitFor(() =>
      expect(table.getByRole("row", { name: /^SHA-256/ })).toHaveTextContent(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      ),
    );
    expect(table.getByRole("row", { name: /^MD5/ })).toHaveTextContent(
      "900150983cd24fb0d6963f7d28e17f72",
    );
    expect(table.getByRole("row", { name: /^CRC32/ })).toHaveTextContent("352441c2");
    fireEvent.change(screen.getByRole("textbox", { name: /^Erwarteter Wert/ }), {
      target: { value: "900150983CD24FB0D6963F7D28E17F72" },
    });
    expect(screen.getByText("Stimmt überein (MD5)")).toBeVisible();
    // Der Text steht nie in der Adresszeile.
    expect(window.location.search).toBe("");
  });

  it("HMAC: berechnet die Signatur und prüft sie", async () => {
    render(<ToolPage id="hmac" />);
    fireEvent.change(await screen.findByLabelText("Geheimer Schlüssel"), {
      target: { value: "key" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Nachricht" }), {
      target: { value: "The quick brown fox jumps over the lazy dog" },
    });
    const expected = "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8";
    await vi.waitFor(() =>
      expect(screen.getByRole("row", { name: /^Hex/ })).toHaveTextContent(expected),
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^Erwartete Signatur/ }), {
      target: { value: `sha256=${expected}` },
    });
    expect(screen.getByText("Signatur stimmt")).toBeVisible();
    expect(window.location.search).toBe("");
  });

  it("Passwort-Hash: erzeugt einen Hash und prüft ihn wieder", async () => {
    render(<ToolPage id="passwort-hash" />);
    fireEvent.change(await screen.findByLabelText("Format"), { target: { value: "apr1" } });
    fireEvent.click(screen.getByRole("button", { name: "Hash erzeugen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Bitte gib ein Kennwort ein");
    fireEvent.change(screen.getByLabelText("Kennwort"), { target: { value: "ein-testwert" } });
    fireEvent.click(screen.getByRole("button", { name: "Hash erzeugen" }));
    const output = await screen.findByLabelText("Hash", {}, { timeout: 5000 });
    const hash = output.textContent ?? "";
    expect(hash).toMatch(/^\$apr1\$/);

    fireEvent.change(screen.getByLabelText("Modus"), { target: { value: "pruefen" } });
    fireEvent.change(screen.getByRole("textbox", { name: /^Hash oder Zeile/ }), {
      target: { value: `admin:${hash}` },
    });
    expect(screen.getByText(/Format: Apache MD5.*Benutzer: admin/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Kennwort"), { target: { value: "ein-testwert" } });
    fireEvent.click(screen.getByRole("button", { name: "Prüfen" }));
    expect(await screen.findByText("Kennwort passt", {}, { timeout: 5000 })).toBeVisible();
    // Kennwort und Benutzername stehen nie in der Adresszeile.
    expect(window.location.search).not.toContain("testwert");
    expect(window.location.search).not.toContain("admin");
  });

  it("Lorem ipsum: erzeugt Text in der gewünschten Menge", async () => {
    render(<ToolPage id="lorem-ipsum" />);
    await screen.findByLabelText("Einheit");
    expect(screen.getByLabelText("Text").textContent).toMatch(/^Lorem ipsum dolor sit amet/);
    fireEvent.change(screen.getByLabelText("Einheit"), { target: { value: "woerter" } });
    fireEvent.change(screen.getByLabelText("Anzahl"), { target: { value: "7" } });
    expect(screen.getByText(/^7 Wörter, \d+ Zeichen$/)).toBeVisible();
    expect(window.location.search).toBe("?einheit=woerter&anzahl=7");
  });

  it("Passphrase: erzeugt Passphrasen aus der Wortliste, ohne sie in die Adresse zu schreiben", async () => {
    render(<ToolPage id="passphrase" />);
    const list = await screen.findByRole("list", { name: "Erzeugte Passphrasen" });
    await vi.waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(5), {
      timeout: 15000,
    });
    const first = within(list).getAllByRole("listitem")[0]?.querySelector("code")?.textContent;
    expect(first?.split("-")).toHaveLength(5);
    fireEvent.change(screen.getByLabelText("Anzahl"), { target: { value: "2" } });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(window.location.search).toBe("?anzahl=2");
  }, 20000);
});
