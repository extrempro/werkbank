import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollectorCheckPanel } from "./CollectorCheck";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CollectorCheckPanel", () => {
  it("zeigt fehlende Rechte von UTCM mit den betroffenen Typen", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(
          JSON.stringify({
            configured: true,
            collector_error: null,
            collector: [
              {
                permission: "AuditLog.Read.All",
                purpose: "Geändert von",
                required: true,
                granted: true,
              },
            ],
            utcm_error: null,
            utcm: [
              {
                resource: "Microsoft Graph",
                permission: "DeviceManagementApps.Read.All",
                types: ["microsoft.intune.appprotectionpolicyios"],
                granted: false,
              },
            ],
            unknown_types: [],
            notes: [],
          }),
          { status: 200 },
        );
      }),
    );
    render(<CollectorCheckPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Berechtigungen prüfen" }));
    expect(await screen.findByText("DeviceManagementApps.Read.All")).toBeTruthy();
    expect(screen.getByText("fehlt")).toBeTruthy();
    expect(screen.getByText("intune.appprotectionpolicyios")).toBeTruthy();
    expect(screen.getByText(/Es fehlen 0 Berechtigungen bei der Collector-App und 1/)).toBeTruthy();
    expect(urls).toEqual(["/api/admin/collector/check"]);
  });
});
