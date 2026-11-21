import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PushSettings } from "../pages/PushSettings";
import { PushDevices } from "./PushDevices";
import { confirmDialog } from "../test/confirm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const device = {
  id: 3,
  label: "Android",
  created_at: "2026-11-17T08:00:00Z",
  last_success_at: null,
};

function stub(state: unknown) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ available: true, public_key: "x", devices: [] }));
      }
      return new Response(JSON.stringify(state));
    }),
  );
  return calls;
}

describe("PushDevices", () => {
  it("zeigt nichts, solange die Verwaltung Push nicht eingeschaltet hat", async () => {
    stub({ available: false, public_key: null, devices: [] });
    const { container } = render(<PushDevices />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("listet die Geräte und entfernt eines", async () => {
    const calls = stub({ available: true, public_key: "x", devices: [device] });
    render(<PushDevices />);
    expect(await screen.findByText("Android")).toBeVisible();
    // jsdom kann kein Push: Hinweis statt Knopf
    expect(screen.getByText(/kann keine Push-Nachrichten empfangen/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^Entfernen/ }));
    await confirmDialog("Entfernen");
    expect(await screen.findByText("Das Gerät ist entfernt.")).toBeVisible();
    expect(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/3"))).toBe(true);
  });
});

describe("PushSettings", () => {
  it("schaltet Push ein und meldet fehlende Schlüsseldatei", async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: String(init?.body) });
        return new Response(
          JSON.stringify({
            push: { enabled: true, key_set: true, key_storage_available: true, devices: 0 },
          }),
        );
      }),
    );
    const onChange = vi.fn();
    render(
      <PushSettings
        push={{ enabled: false, key_set: false, key_storage_available: true, devices: 0 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Push einschalten" }));
    expect(await screen.findByText(/Push ist eingeschaltet/)).toBeVisible();
    expect(calls[0]).toEqual({ url: "/api/admin/settings/push", body: '{"enabled":true}' });
    expect(onChange).toHaveBeenCalled();
    cleanup();
    render(
      <PushSettings
        push={{ enabled: false, key_set: false, key_storage_available: false, devices: 0 }}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("button", { name: "Push einschalten" })).toBeDisabled();
    expect(screen.getByText(/fehlt die Schlüsseldatei/)).toBeVisible();
  });
});
