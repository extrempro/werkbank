import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminSettings } from "../api";
import { GeneralSettings } from "./GeneralSettings";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settings: AdminSettings = {
  smtp: {
    host: "smtp.example.com",
    port: 587,
    security: "starttls",
    username: "werkbank@example.com",
    sender_address: "werkbank@example.com",
    sender_name: "Werkbank",
    password_set: true,
    password_storage_available: true,
  },
  audit_retention_days: 90,
  audit_retention_min: 30,
  audit_retention_max: 3650,
};

function stubFetch(status = 200, body: unknown = settings) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}

describe("GeneralSettings", () => {
  it("zeigt die Angaben, aber nie das Passwort", () => {
    render(<GeneralSettings settings={settings} onChange={() => undefined} />);
    expect(screen.getByLabelText("Server")).toHaveValue("smtp.example.com");
    expect(screen.getByLabelText("Port")).toHaveValue(587);
    expect(screen.getByLabelText("Neues Passwort")).toHaveValue("");
    expect(screen.getByText(/Ein Passwort ist gespeichert und wird nie angezeigt/)).toBeVisible();
    expect(screen.getByLabelText("Einträge löschen nach (Tage)")).toHaveValue(90);
    expect(screen.getByText("eingerichtet")).toBeVisible();
  });

  it("lässt das Passwort beim Speichern weg, wenn es nicht geändert wird", async () => {
    const calls = stubFetch();
    const onChange = vi.fn();
    render(<GeneralSettings settings={settings} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "2525" } });
    fireEvent.click(screen.getByRole("button", { name: "SMTP-Server speichern" }));
    expect(await screen.findByText("Der SMTP-Server ist gespeichert.")).toBeVisible();
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(calls[0]?.url).toBe("/api/admin/settings/smtp");
    expect(calls[0]?.init?.method).toBe("PUT");
    expect(body.port).toBe(2525);
    expect("password" in body).toBe(false);
    expect(onChange).toHaveBeenCalled();
  });

  it("sendet ein neues Passwort oder löscht das gespeicherte", async () => {
    const calls = stubFetch();
    render(<GeneralSettings settings={settings} onChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Neues Passwort"), { target: { value: "neu" } });
    fireEvent.click(screen.getByRole("button", { name: "SMTP-Server speichern" }));
    await screen.findByText("Der SMTP-Server ist gespeichert.");
    expect(JSON.parse(String(calls[0]?.init?.body)).password).toBe("neu");
    expect(screen.getByLabelText("Neues Passwort")).toHaveValue("");

    fireEvent.click(screen.getByLabelText("Gespeichertes Passwort löschen"));
    fireEvent.click(screen.getByRole("button", { name: "SMTP-Server speichern" }));
    await screen.findByText("Der SMTP-Server ist gespeichert.");
    expect(JSON.parse(String(calls[1]?.init?.body)).password).toBe("");
  });

  it("meldet, warum die Testmail nicht gesendet wurde", async () => {
    stubFetch(502, { detail: "Der Server hat die Anmeldung abgelehnt." });
    render(<GeneralSettings settings={settings} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Testmail an mich senden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Testmail konnte nicht gesendet werden: Der Server hat die Anmeldung abgelehnt.",
    );
  });

  it("sperrt das Passwortfeld, wenn die Schlüsseldatei fehlt", () => {
    const withoutKey = {
      ...settings,
      smtp: { ...settings.smtp, password_set: false, password_storage_available: false },
    };
    render(<GeneralSettings settings={withoutKey} onChange={() => undefined} />);
    expect(screen.getByLabelText("Passwort (freiwillig)")).toBeDisabled();
    expect(screen.getByText(/fehlt die Schlüsseldatei/)).toBeVisible();
  });

  it("speichert die Aufbewahrungsfrist", async () => {
    const calls = stubFetch(200, { ...settings, audit_retention_days: 180 });
    render(<GeneralSettings settings={settings} onChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Einträge löschen nach (Tage)"), {
      target: { value: "180" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aufbewahrung speichern" }));
    expect(await screen.findByText("Die Aufbewahrungsfrist ist gespeichert.")).toBeVisible();
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ days: 180 });
  });

  it("speichert den Vorlauf für Zertifikate und prüft die Reihenfolge", async () => {
    const calls = stubFetch(200, { ...settings, credential_warn_days: [90, 30, 7] });
    render(<GeneralSettings settings={settings} onChange={() => undefined} />);
    expect(screen.getByLabelText("Hinweis ab (Tage)")).toHaveValue(60);
    fireEvent.change(screen.getByLabelText("Hinweis ab (Tage)"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Vorlauf speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("drei absteigende ganze Zahlen");
    expect(calls).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Hinweis ab (Tage)"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Vorlauf speichern" }));
    expect(await screen.findByText("Der Vorlauf ist gespeichert.")).toBeVisible();
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ days: [90, 30, 7] });
  });
});
