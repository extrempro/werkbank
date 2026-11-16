import { describe, expect, it } from "vitest";
import { buildMatrix, toCsv, toJson, toText, type TypeResult } from "./results";
import type { Resolver } from "./resolvers";
import { buildQuery, parseResponse, toBase64Url } from "./wire";

const fromHex = (h: string) => Uint8Array.from(h.replace(/\s+/g, "").match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Name ohne Kompression, unabhängig vom Code unter Test */
const n = (name: string) =>
  name
    .split(".")
    .filter(Boolean)
    .map((l) => l.length.toString(16).padStart(2, "0") + Array.from(l, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(""))
    .join("") + "00";
const u16 = (v: number) => v.toString(16).padStart(4, "0");
const u32 = (v: number) => v.toString(16).padStart(8, "0");
const rr = (name: string, type: number, ttl: number, rdataHex: string) => n(name) + u16(type) + u16(1) + u32(ttl) + u16(rdataHex.length / 2) + rdataHex;
const str = (s: string) => s.length.toString(16).padStart(2, "0") + Array.from(s, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");

describe("RFC 8484 – Anfrage", () => {
  it("baut die Anfrage nach RFC 1035", () => {
    const q = buildQuery("www.example.com", "A");
    expect(toHex(q)).toBe("000001200001000000000000" + "03777777076578616d706c6503636f6d00" + "00010001");
    expect(toBase64Url(q)).toBe("AAABIAABAAAAAAAAA3d3dwdleGFtcGxlA2NvbQAAAQAB");
  });

  it("lehnt zu lange Namensteile ab", () => {
    expect(() => buildQuery(`${"a".repeat(64)}.example.com`, "A")).toThrow();
  });
});

describe("RFC 8484 – Antwort", () => {
  it("liest CNAME-Kette mit Namenskompression und AD-Flag", () => {
    const msg = fromHex(
      "0000 81a0 0001 0002 0000 0000" +
        "03777777076578616d706c6503636f6d00 0001 0001" +
        "c00c 0005 0001 00000e10 0006 0363646e c010" +
        "c02d 0001 0001 0000012c 0004 c0000201",
    );
    expect(parseResponse(msg)).toEqual({
      rcode: 0,
      authenticated: true,
      truncated: false,
      answers: [
        { name: "www.example.com.", type: "CNAME", ttl: 3600, data: "cdn.example.com." },
        { name: "cdn.example.com.", type: "A", ttl: 300, data: "192.0.2.1" },
      ],
    });
  });

  it("liest die gängigen Typen", () => {
    const answers = [
      rr("example.com", 16, 60, str("v=spf1 -all") + str('a"b')),
      rr("example.com", 15, 60, u16(10) + n("mail.example.com")),
      rr("example.com", 28, 60, "20010db8000000000000000000000001"),
      rr("example.com", 257, 60, "00" + str("issue") + Array.from("letsencrypt.org", (c) => c.charCodeAt(0).toString(16)).join("")),
      rr("example.com", 6, 60, n("ns1.example.com") + n("hostmaster.example.com") + u32(2026110701) + u32(7200) + u32(3600) + u32(1209600) + u32(300)),
      rr("_sip._tls.example.com", 33, 60, u16(100) + u16(1) + u16(443) + n("sipdir.online.lync.com")),
      rr("example.com", 65, 60, u16(1) + "00" + u16(1) + u16(6) + str("h2") + str("h3") + u16(4) + u16(4) + "c0000201"),
      rr("example.com", 999, 60, "abcd"),
    ].join("");
    const msg = fromHex("0000 8180 0000 0008 0000 0000" + answers);
    expect(parseResponse(msg).answers.map((a) => `${a.type} ${a.data}`)).toEqual([
      'TXT "v=spf1 -all" "a\\"b"',
      "MX 10 mail.example.com.",
      "AAAA 2001:db8::1",
      'CAA 0 issue "letsencrypt.org"',
      "SOA ns1.example.com. hostmaster.example.com. 2026110701 7200 3600 1209600 300",
      "SRV 100 1 443 sipdir.online.lync.com.",
      "HTTPS 1 . alpn=h2,h3 ipv4hint=192.0.2.1",
      "TYPE999 \\# 2 ABCD",
    ]);
  });

  it("meldet NXDOMAIN und erkennt abgeschnittene Daten", () => {
    expect(parseResponse(fromHex("0000 8183 0001 0000 0000 0000" + n("nope.example") + "00010001")).rcode).toBe(3);
    expect(() => parseResponse(fromHex("0000 8180 0000 0001 0000 0000 c00c"))).toThrow();
  });

  it("verhindert Endlosschleifen bei Zeigern", () => {
    expect(() => parseResponse(fromHex("0000 8180 0000 0001 0000 0000 c00c 0001 0001 00000000 0004 01020304"))).toThrow();
  });
});

describe("Vergleich und Export", () => {
  const cf: Resolver = { id: "cloudflare", name: "Cloudflare", url: "https://cf" };
  const q9: Resolver = { id: "q9", name: "Quad9", url: "https://q9" };
  const ok = (answers: { name: string; type: string; ttl: number; data: string }[]) => ({ query: "example.com", status: "NOERROR", authenticated: false, answers, ms: 12 });

  it("erkennt gleiche Antworten trotz anderer Schreibweise", () => {
    const tr: TypeResult = {
      type: "TXT",
      query: "example.com",
      cells: [
        { resolver: cf, result: ok([{ name: "example.com", type: "TXT", ttl: 300, data: '"v=spf1 -all"' }]) },
        { resolver: q9, result: ok([{ name: "example.com", type: "TXT", ttl: 120, data: '"v=spf1 " "-all"' }]) },
      ],
    };
    const m = buildMatrix(tr);
    expect(m.consistent).toBe(true);
    expect(m.rows.length).toBe(1);
  });

  it("zeigt Abweichungen und CNAME-Ketten", () => {
    const tr: TypeResult = {
      type: "A",
      query: "www.example.com",
      cells: [
        { resolver: cf, result: ok([{ name: "www.example.com", type: "CNAME", ttl: 300, data: "cdn.example.net." }, { name: "cdn.example.net", type: "A", ttl: 60, data: "192.0.2.1" }]) },
        { resolver: q9, result: ok([{ name: "www.example.com", type: "CNAME", ttl: 300, data: "cdn.example.net." }, { name: "cdn.example.net", type: "A", ttl: 60, data: "192.0.2.2" }]) },
      ],
    };
    const m = buildMatrix(tr);
    expect(m.consistent).toBe(false);
    expect(m.showNames).toBe(true);
    expect(m.rows.map((r) => [r.type, r.data, r.present.cloudflare ?? false, r.present.q9 ?? false])).toEqual([
      ["CNAME", "cdn.example.net.", true, true],
      ["A", "192.0.2.1", true, false],
      ["A", "192.0.2.2", false, true],
    ]);
  });

  it("ein Fehler macht die übrigen nicht inkonsistent", () => {
    const tr: TypeResult = { type: "A", query: "example.com", cells: [{ resolver: cf, result: ok([]) }, { resolver: q9, error: "kein CORS" }] };
    expect(buildMatrix(tr).consistent).toBe(true);
  });

  it("exportiert Text, CSV und JSON", () => {
    const results: TypeResult[] = [
      { type: "MX", query: "example.com", cells: [{ resolver: cf, result: ok([{ name: "example.com", type: "MX", ttl: 300, data: "10 mail.example.com." }]) }, { resolver: q9, error: "HTTP 500" }] },
    ];
    expect(toText(results)).toContain("example.com.\t300\tIN\tMX\t10 mail.example.com.");
    expect(toText(results)).toContain("Quad9: Fehler: HTTP 500");
    const csv = toCsv(results);
    expect(csv.startsWith("﻿Abfrage;Typ;Resolver")).toBe(true);
    expect(csv).toContain("example.com;MX;Cloudflare;NOERROR;nein;example.com;300;MX;10 mail.example.com.");
    const json = JSON.parse(toJson(results));
    expect(json[0].answers[0].data).toBe("10 mail.example.com.");
    expect(json[1].error).toBe("HTTP 500");
  });
});
