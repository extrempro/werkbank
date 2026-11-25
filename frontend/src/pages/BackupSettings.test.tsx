import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatBackupSize, type BackupState } from "../api";
import { BackupSettings } from "./BackupSettings";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const state: BackupState = {
  enabled: false,
  hour: 2,
  keep: 14,
  keep_min: 1,
  keep_max: 365,
  readiness: { key: true, folder: true, tools: true, ready: true },
  requested: false,
  backups: [
    {
      name: "werkbank-2026-11-24-020000",
      created_at: "2026-11-24T01:00:00+00:00",
      version: "0.126.0",
      size_bytes: 12 * 1024 * 1024,
    },
  ],
  runs: [
    {
      id: 2,
      started_at: "2026-11-25T01:00:00+00:00",
      finished_at: "2026-11-25T01:00:05+00:00",
      status: "fehler",
      trigger: "zeitplan",
      started_by: null,
      name: "werkbank-2026-11-25-020000",
      size_bytes: null,
      error: "Der Zielordner fehlt oder ist nicht beschreibbar.",
    },
    {
      id: 1,
      started_at: "2026-11-24T01:00:00+00:00",
      finished_at: "2026-11-24T01:00:09+00:00",
      status: "ok",
      trigger: "verwaltung",
      started_by: "Ada Admin",
      name: "werkbank-2026-11-24-020000",
      size_bytes: 12 * 1024 * 1024,
      error: null,
    },
  ],
};

function stubFetch(responses: Record<string, BackupState | { detail: string }>, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const key = `${init?.method ?? "GET"} ${url}`;
      const body = responses[key] ?? state;
      const code = key in responses ? status : 200;
      return new Response(JSON.stringify(body), { status: code });
    }),
  );
  return calls;
}

describe("BackupSettings", () => {
  it("zeigt Zustand, Sicherungen und Läufe mit Fehlern", async () => {
    stubFetch({});
    render(<BackupSettings />);
    expect(await screen.findByText("ausgeschaltet")).toBeVisible();
    expect(screen.getByText(/Schlüssel „backup_key“: vorhanden/)).toBeVisible();
    const backups = screen.getByRole("table", {
      name: "Sicherungen im Zielordner, neueste zuerst",
    });
    expect(within(backups).getByText("werkbank-2026-11-24-020000")).toBeVisible();
    expect(within(backups).getByText("12 MB")).toBeVisible();
    const runs = screen.getByRole("table", { name: "Letzte Läufe, neueste zuerst" });
    expect(within(runs).getByText("fehlgeschlagen")).toBeVisible();
    expect(
      within(runs).getByText("Der Zielordner fehlt oder ist nicht beschreibbar."),
    ).toBeVisible();
    expect(within(runs).getByText("Verwaltung (Ada Admin)")).toBeVisible();
  });

  it("speichert Zeitplan und Aufbewahrung", async () => {
    const saved = { ...state, enabled: true, hour: 3, keep: 7 };
    const calls = stubFetch({ "PUT /api/admin/backup": saved });
    render(<BackupSettings />);
    fireEvent.click(await screen.findByLabelText("Täglich sichern"));
    fireEvent.change(screen.getByLabelText("Uhrzeit"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Aufbewahren"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Datensicherung speichern" }));
    expect(
      await screen.findByText("Die Einstellungen der Datensicherung sind gespeichert."),
    ).toBeVisible();
    const put = calls.find((call) => call.init?.method === "PUT");
    expect(JSON.parse(String(put?.init?.body))).toEqual({ enabled: true, hour: 3, keep: 7 });
    expect(await screen.findByText("eingeschaltet")).toBeVisible();
  });

  it("prüft die Aufbewahrung vor dem Speichern", async () => {
    const calls = stubFetch({});
    render(<BackupSettings />);
    fireEvent.change(await screen.findByLabelText("Aufbewahren"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Datensicherung speichern" }));
    expect(await screen.findByText("Bitte eine ganze Zahl von 1 bis 365 eintragen.")).toBeVisible();
    expect(calls.some((call) => call.init?.method === "PUT")).toBe(false);
  });

  it("startet eine Sicherung und sperrt den Knopf, solange sie läuft", async () => {
    const calls = stubFetch({ "POST /api/admin/backup/jetzt": { ...state, requested: true } });
    render(<BackupSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Jetzt sichern" }));
    expect(await screen.findByText(/Die Sicherung ist gestartet/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Sicherung läuft …" })).toBeDisabled();
    expect(calls.some((call) => call.url === "/api/admin/backup/jetzt")).toBe(true);
  });

  it("sperrt „Jetzt sichern“, solange die Einrichtung fehlt", async () => {
    stubFetch({
      "GET /api/admin/backup": {
        ...state,
        readiness: { key: false, folder: true, tools: true, ready: false },
      },
    });
    render(<BackupSettings />);
    expect(await screen.findByText("nicht eingerichtet")).toBeVisible();
    expect(screen.getByText(/fehlt auf dem Server/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Jetzt sichern" })).toBeDisabled();
  });

  it("zeigt Fehler beim Start", async () => {
    stubFetch({ "POST /api/admin/backup/jetzt": { detail: "Eine Sicherung läuft bereits." } }, 409);
    render(<BackupSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Jetzt sichern" }));
    expect(await screen.findByText("Eine Sicherung läuft bereits.")).toBeVisible();
  });

  it("hat die Anleitung mit dem Namen der neuesten Sicherung", async () => {
    stubFetch({});
    render(<BackupSettings />);
    const guide = await screen.findByRole("region", { name: "Anleitung" });
    fireEvent.click(within(guide).getByText("Sicherung zurückspielen"));
    expect(
      within(guide).getByText(
        "docker compose run --rm --no-deps worker python -m werkbank.backup wiederherstellen werkbank-2026-11-24-020000",
      ),
    ).toBeInTheDocument();
    expect(within(guide).getByText("Einrichten auf dem Server")).toBeVisible();
    expect(within(guide).getByText("Im Notfall ohne Werkbank öffnen")).toBeVisible();
  });

  it("schreibt Größen lesbar", () => {
    expect(formatBackupSize(500)).toBe("1 KB");
    expect(formatBackupSize(1536 * 1024)).toBe("1,5 MB");
    expect(formatBackupSize(3 * 1024 * 1024 * 1024)).toBe("3 GB");
  });
});
