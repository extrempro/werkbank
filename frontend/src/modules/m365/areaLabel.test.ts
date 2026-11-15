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

  it("zeigt unbekannte Bereiche mit ihrem technischen Namen", () => {
    expect(areaLabel("irgendeinneuertyp")).toBe("irgendeinneuertyp");
  });
});
