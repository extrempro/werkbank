import { describe, expect, it } from "vitest";
import { areaLabel, workloadLabel } from "./api";

describe("areaLabel", () => {
  it("nennt bekannte Bereiche von Entra und Exchange beim Namen", () => {
    expect(areaLabel("conditionalaccesspolicy")).toBe("Bedingter Zugriff");
    expect(areaLabel("transportrule")).toBe("Transportregeln");
    expect(areaLabel("TransportRule")).toBe("Transportregeln");
    expect(areaLabel("safelinkspolicy")).toBe("Sichere Links");
    expect(workloadLabel("exchange")).toBe("Exchange");
  });

  it("kennt die Bereiche von Teams und SharePoint", () => {
    expect(areaLabel("meetingpolicy")).toBe("Besprechungsrichtlinien");
    expect(areaLabel("federationconfiguration")).toBe("Externer Zugriff");
    expect(areaLabel("tenantsettings")).toBe("Mandanteneinstellungen");
    expect(workloadLabel("teams")).toBe("Teams");
    expect(workloadLabel("sharepoint")).toBe("SharePoint");
  });

  it("zeigt unbekannte Bereiche mit ihrem technischen Namen", () => {
    expect(areaLabel("irgendeinneuertyp")).toBe("irgendeinneuertyp");
  });
});
