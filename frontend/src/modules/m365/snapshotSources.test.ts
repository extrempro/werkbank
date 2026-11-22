import { describe, expect, it } from "vitest";
import { missingScopes, summarizeSources } from "./snapshotSources";

const APPS =
  'Error during Export: [Forbidden] : { "_version": 3, "Message": "Application is not authorized to perform this operation. Application must have one of the following scopes: DeviceManagementApps.Read.All, DeviceManagementApps.ReadWrite.All - Operation ID (for customer support): 00000000-0000-0000-0000-000000000000';
const CONFIG =
  "Application must have one of the following scopes: DeviceManagementConfiguration.Read.All, DeviceManagementConfiguration.ReadWrite.All - Operation ID";

describe("missingScopes", () => {
  it("liest die fehlenden Berechtigungen aus dem Fehlertext", () => {
    expect(missingScopes(APPS)).toEqual([
      "DeviceManagementApps.Read.All",
      "DeviceManagementApps.ReadWrite.All",
    ]);
    expect(missingScopes("Zeitüberschreitung")).toEqual([]);
  });
});

describe("summarizeSources", () => {
  it("gruppiert Fehler nach fehlender Berechtigung", () => {
    const summary = summarizeSources({
      id: 1,
      started_at: "2026-11-22T08:00:00Z",
      finished_at: "2026-11-22T08:10:00Z",
      status: "teilweise",
      change_count: 0,
      resource_count: 3,
      source_status: {
        "utcm:microsoft.teams.federationconfiguration": true,
        "utcm:microsoft.intune.appprotectionpolicyios": false,
        "utcm:microsoft.intune.appconfigurationpolicy": false,
        "utcm:microsoft.intune.devicecompliancepolicyios": false,
        "utcm:microsoft.exchange.x": false,
      },
      source_errors: {
        "utcm:microsoft.intune.appprotectionpolicyios": APPS,
        "utcm:microsoft.intune.appconfigurationpolicy": APPS,
        "utcm:microsoft.intune.devicecompliancepolicyios": CONFIG,
        "utcm:microsoft.exchange.x": "Zeitüberschreitung",
      },
    });
    expect(summary.complete).toEqual(["utcm:microsoft.teams.federationconfiguration"]);
    expect(summary.failed).toBe(4);
    expect(summary.groups.map((g) => g.sources.length)).toEqual([2, 1, 1]);
    expect(summary.groups[0]?.scopes[0]).toBe("DeviceManagementApps.Read.All");
    expect(summary.groups.find((g) => g.message === "Zeitüberschreitung")).toBeTruthy();
  });
});
