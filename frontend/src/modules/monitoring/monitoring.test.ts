import { describe, expect, it } from "vitest";
import { dailyHistory, filterRows, groupByZone, viewFromSearch, type DnsRow } from "./api";

function row(fqdn: string, status: DnsRow["status"], extra: Partial<DnsRow> = {}): DnsRow {
  return {
    key: `${fqdn}|A`,
    fqdn,
    type: "A",
    zone: fqdn.split(".").slice(-2).join("."),
    status,
    new: false,
    netbox: ["192.0.2.1"],
    inactive: [],
    public: [],
    missing: [],
    extra: [],
    notes: [],
    netbox_url: null,
    ...extra,
  };
}

describe("DNS-Abgleich", () => {
  const rows = [
    row("www.example.com", "ok"),
    row("mail.example.com", "abweichend", { new: true }),
    row("alt.example.org", "fehlt"),
    row("x.example.org", "inaktiv"),
  ];

  it("filtert nach Ansicht und Suchtext", () => {
    expect(filterRows(rows, "probleme", "").map((r) => r.fqdn)).toEqual([
      "mail.example.com",
      "alt.example.org",
    ]);
    expect(filterRows(rows, "neu", "").map((r) => r.fqdn)).toEqual(["mail.example.com"]);
    expect(filterRows(rows, "alle", "example.org").length).toBe(2);
    expect(filterRows(rows, "alle", "192.0.2.1 www").map((r) => r.fqdn)).toEqual([
      "www.example.com",
    ]);
  });

  it("gruppiert nach Zone", () => {
    expect(groupByZone(rows).map(([zone, list]) => [zone, list.length])).toEqual([
      ["example.com", 2],
      ["example.org", 2],
    ]);
  });

  it("nimmt je Tag den letzten erfolgreichen Lauf", () => {
    const days = dailyHistory([
      { started_at: "2026-11-15T08:00:00Z", status: "ok", counts: { abweichend: 1 } },
      { started_at: "2026-11-15T12:00:00Z", status: "ok", counts: { abweichend: 3 } },
      { started_at: "2026-11-15T16:00:00Z", status: "fehlgeschlagen", counts: {} },
      { started_at: "2026-11-16T00:00:00Z", status: "ok", counts: { fehlt: 2 } },
    ]);
    expect(days).toEqual([
      { day: "2026-11-15", counts: { abweichend: 3 } },
      { day: "2026-11-16", counts: { fehlt: 2 } },
    ]);
  });

  it("liest die Ansicht aus der Adresse", () => {
    expect(viewFromSearch("?ansicht=neu")).toBe("neu");
    expect(viewFromSearch("?ansicht=alle")).toBe("alle");
    expect(viewFromSearch("?ansicht=quatsch")).toBe("probleme");
    expect(viewFromSearch("")).toBe("probleme");
  });
});
