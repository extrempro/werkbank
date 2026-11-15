import { describe, expect, it } from "vitest";
import { firewallCommands, ports, searchPorts } from "./ports";

describe("Ports", () => {
  it("Suche nach Nummer, Bereich und Text", () => {
    expect(searchPorts("3389")[0]!.name).toBe("RDP");
    expect(searchPorts("50000").some((p) => p.name.startsWith("RPC dynamisch"))).toBe(true);
    expect(searchPorts("kerberos").length).toBeGreaterThanOrEqual(2);
    expect(searchPorts("88 389").map((p) => p.port)).toEqual(["88", "389"]);
  });
  it("keine doppelten Einträge", () => {
    const keys = ports.map((p) => `${p.port}/${p.proto}/${p.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("Firewall-Befehle", () => {
    const f = firewallCommands(searchPorts("88 389"), "AD");
    expect(f.windows).toContain("-Protocol TCP -LocalPort 88,389");
    expect(f.ufw).toContain("ufw allow 389/udp");
  });
});
