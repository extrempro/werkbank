import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NetboxSettings as Settings } from "../modules/monitoring/api";
import { NetboxSettings } from "./NetboxSettings";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const stored: Settings = {
  enabled: true,
  url: "https://netbox.example.com",
  token_set: true,
  token_storage_available: true,
  view_id: null,
  resolver: "cloudflare",
  compare_ttl: true,
  ca_set: false,
  resolvers: [
    { id: "cloudflare", name: "Cloudflare (1.1.1.1)" },
    { id: "google", name: "Google (8.8.8.8)" },
  ],
};

function stubFetch(responses: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const key = `${init?.method ?? "GET"} ${url}`;
      return new Response(JSON.stringify(responses[key] ?? stored), { status: 200 });
    }),
  );
  return calls;
}

describe("NetboxSettings", () => {
  it("zeigt den Token nie und behält ihn beim Speichern", async () => {
    const calls = stubFetch({});
    render(<NetboxSettings />);
    expect(await screen.findByLabelText("Adresse von NetBox")).toHaveValue(
      "https://netbox.example.com",
    );
    expect(screen.getByLabelText("Neuer API-Token")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Google (8.8.8.8)" }));
    fireEvent.click(screen.getByRole("button", { name: "NetBox speichern" }));
    expect(await screen.findByText("Die Anbindung an NetBox ist gespeichert.")).toBeVisible();
    const put = calls.find((call) => call.init?.method === "PUT");
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      enabled: true,
      url: "https://netbox.example.com",
      view_id: null,
      resolver: "google",
      compare_ttl: true,
    });
  });

  it("prüft die Verbindung und bietet danach die Views an", async () => {
    stubFetch({
      "POST /api/admin/settings/netbox/test": {
        version: "4.4.1",
        dns_plugin: "1.4.0",
        views: [{ id: 7, name: "extern" }],
        zones: 12,
      },
    });
    render(<NetboxSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Verbindung prüfen" }));
    expect(await screen.findByRole("status")).toHaveTextContent("NetBox 4.4.1");
    expect(screen.getByRole("radio", { name: "extern" })).toBeInTheDocument();
  });
});
