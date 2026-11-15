import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FAVORITES_KEY, findTool, readFavorites, searchTools, TOOLS } from "./index";
import { clampInt } from "./params";
import { ruleName } from "./ports/PortsTool";
import { ToolPage, ToolsOverviewPage } from "./ToolsPage";

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
    expect(searchTools("netzwerk")).toHaveLength(6);
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
    expect(screen.getByRole("link", { name: "Subnetz-Rechner" })).toHaveAttribute(
      "href",
      "/it-tools/subnetz",
    );
    fireEvent.change(screen.getByLabelText("Tool suchen"), { target: { value: "base" } });
    expect(screen.getByRole("status")).toHaveTextContent("1 Tool");
    expect(screen.queryByRole("link", { name: "Subnetz-Rechner" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Tool suchen"), { target: { value: "gibtsnicht" } });
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
    fireEvent.change(await screen.findByLabelText(/^MAC-Adressen/), {
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
});
