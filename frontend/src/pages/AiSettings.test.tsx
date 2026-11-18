import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiSettings as AiSettingsData } from "../api";
import { AiSettings } from "./AiSettings";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ai: AiSettingsData = {
  enabled: true,
  provider: "openai",
  base_url: "https://ki.example.com/v1",
  model: "beispiel-modell",
  texts_per_hour: 30,
  texts_per_hour_min: 1,
  texts_per_hour_max: 500,
  api_key_set: true,
  key_storage_available: true,
};

function stubFetch(status = 200, body: unknown = { ai }) {
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

describe("AiSettings", () => {
  it("zeigt die Angaben, aber nie den Schlüssel", () => {
    render(<AiSettings ai={ai} onChange={() => undefined} />);
    expect(screen.getByLabelText("Adresse der Schnittstelle")).toHaveValue(
      "https://ki.example.com/v1",
    );
    expect(screen.getByLabelText("Modell")).toHaveValue("beispiel-modell");
    expect(screen.getByLabelText("Neuer Schlüssel")).toHaveValue("");
    expect(screen.getByLabelText("KI-Texte einschalten")).toBeChecked();
    expect(screen.getByText("eingeschaltet")).toBeVisible();
    expect(screen.getByText(/nie Werte, Namen oder andere Daten aus dem Tenant/)).toBeVisible();
  });

  it("lässt den Schlüssel beim Speichern weg, wenn er nicht geändert wird", async () => {
    const calls = stubFetch();
    const onChange = vi.fn();
    render(<AiSettings ai={ai} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Neue Texte je Stunde (höchstens)"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "KI-Einstellungen speichern" }));
    expect(await screen.findByText("Die KI-Einstellungen sind gespeichert.")).toBeVisible();
    expect(calls[0]?.url).toBe("/api/admin/settings/ai");
    expect(calls[0]?.init?.method).toBe("PUT");
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.texts_per_hour).toBe(10);
    expect(body.provider).toBe("openai");
    expect("api_key" in body).toBe(false);
    expect(onChange).toHaveBeenCalled();
  });

  it("schickt einen neuen Schlüssel mit und kann ihn löschen", async () => {
    const calls = stubFetch();
    render(<AiSettings ai={ai} onChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Neuer Schlüssel"), { target: { value: "neu-123" } });
    fireEvent.click(screen.getByRole("button", { name: "KI-Einstellungen speichern" }));
    await screen.findByText("Die KI-Einstellungen sind gespeichert.");
    expect(JSON.parse(String(calls[0]?.init?.body)).api_key).toBe("neu-123");

    fireEvent.click(screen.getByLabelText("Gespeicherten Schlüssel löschen"));
    fireEvent.click(screen.getByRole("button", { name: "KI-Einstellungen speichern" }));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(JSON.parse(String(calls[1]?.init?.body)).api_key).toBe("");
  });

  it("meldet das Ergebnis des Verbindungstests", async () => {
    stubFetch(200, { model: "beispiel-modell" });
    render(<AiSettings ai={ai} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Verbindung testen" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Das Modell beispiel-modell hat geantwortet.",
    );

    stubFetch(502, { detail: "Der Anbieter ist nicht erreichbar (ConnectError)." });
    fireEvent.click(screen.getByRole("button", { name: "Verbindung testen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht erreichbar (ConnectError)");
  });

  it("sperrt Schlüsselfeld und Test, wenn etwas fehlt", () => {
    render(
      <AiSettings
        ai={{ ...ai, base_url: "", model: "", api_key_set: false, key_storage_available: false }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText("Schlüssel (freiwillig)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Verbindung testen" })).toBeDisabled();
    expect(screen.getByText(/fehlt die Schlüsseldatei/)).toBeVisible();
  });

  it("schaltet auf Anthropic und setzt bei leerer Adresse die Adresse von Anthropic", async () => {
    const calls = stubFetch();
    render(<AiSettings ai={{ ...ai, base_url: "" }} onChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Art der Schnittstelle"), {
      target: { value: "anthropic" },
    });
    expect(screen.getByLabelText("Adresse der Schnittstelle")).toHaveValue(
      "https://api.anthropic.com/v1",
    );
    expect(screen.getByText(/Mitdenken ist für die kurzen Texte ausgeschaltet/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "KI-Einstellungen speichern" }));
    expect(await screen.findByText("Die KI-Einstellungen sind gespeichert.")).toBeVisible();
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.provider).toBe("anthropic");
    expect(body.base_url).toBe("https://api.anthropic.com/v1");
  });
});
