import { describe, expect, it } from "vitest";
import { analyzeHeaders, decodeEncodedWords, formatDuration, parseHeaders } from "./mail-header";

const sampleHeaders = `Received: from AM9PR02MB1234.eurprd02.prod.outlook.com (2603:10a6:20b:1::12)
 by DB9PR02MB5678.eurprd02.prod.outlook.com with HTTPS; Mon, 2 Nov 2026 10:15:40 +0000
Received: from mail.sender.example (203.0.113.25) by AM9PR02MB1234.mail.protection.outlook.com
 (10.167.16.10) with Microsoft SMTP Server (version=TLS1_2) id 15.20.1234.5; Mon, 2 Nov 2026 10:15:30 +0000
Received: from client.sender.example ([198.51.100.7]) by mail.sender.example with ESMTPSA id abc123;
 Mon, 02 Nov 2026 11:15:10 +0100 (CET)
Authentication-Results: spf=pass (sender IP is 203.0.113.25)
 smtp.mailfrom=sender.example; dkim=pass (signature was verified)
 header.d=sender.example;dmarc=pass action=none header.from=sender.example;compauth=pass reason=100
X-MS-Exchange-Organization-SCL: 1
X-Forefront-Antispam-Report: CIP:203.0.113.25;CTRY:DE;LANG:de;SCL:1;SRV:;IPV:NLI;SFV:NSPM;CAT:NONE
From: =?UTF-8?B?TcO8bGxlciwgSsO8cmdlbg==?= <juergen@sender.example>
To: it@empfaenger.example
Reply-To: support@andere-firma.example
Return-Path: bounce@sender.example
Subject: =?iso-8859-1?Q?Gr=FC=DFe_aus_der_IT?=
Date: Mon, 2 Nov 2026 11:15:08 +0100
Message-ID: <abc@sender.example>

Hallo, das ist der Body und darf nicht als Header gelesen werden: Test`;

describe("parseHeaders", () => {
  it("fügt Fortsetzungszeilen zusammen und hört beim Body auf", () => {
    const h = parseHeaders(sampleHeaders);
    expect(h[0]!.value).toContain("by DB9PR02MB5678");
    expect(h.some((x) => x.name.startsWith("Hallo"))).toBe(false);
  });
});

describe("decodeEncodedWords", () => {
  it("dekodiert Base64 und Quoted-Printable", () => {
    expect(decodeEncodedWords("=?UTF-8?B?TcO8bGxlciwgSsO8cmdlbg==?= <j@x.de>")).toBe(
      "Müller, Jürgen <j@x.de>",
    );
    expect(decodeEncodedWords("=?iso-8859-1?Q?Gr=FC=DFe_aus_der_IT?=")).toBe("Grüße aus der IT");
  });
});

describe("analyzeHeaders", () => {
  const a = analyzeHeaders(sampleHeaders);

  it("ordnet die Hops chronologisch und berechnet Verzögerungen", () => {
    expect(a.hops).toHaveLength(3);
    expect(a.hops[0]).toMatchObject({
      from: "client.sender.example",
      fromIp: "198.51.100.7",
      by: "mail.sender.example",
    });
    expect(a.hops[1]).toMatchObject({
      from: "mail.sender.example",
      fromIp: "203.0.113.25",
      delaySeconds: 20,
    });
    expect(a.hops[2]!.delaySeconds).toBe(10);
    expect(a.totalSeconds).toBe(30);
  });

  it("liest die Authentifizierung", () => {
    expect(a.auth.map((x) => [x.method, x.result])).toEqual([
      ["spf", "pass"],
      ["dkim", "pass"],
      ["dmarc", "pass"],
      ["compauth", "pass"],
    ]);
    expect(a.auth[1]!.details["header.d"]).toBe("sender.example");
  });

  it("zeigt Microsoft-Spamfilter-Werte", () => {
    expect(a.spamInfo.find((s) => s.label.startsWith("SFV"))?.value).toContain("kein Spam");
  });

  it("meldet abweichendes Reply-To", () => {
    expect(a.findings.some((f) => f.level === "warn" && f.message.includes("Reply-To"))).toBe(true);
  });

  it("dekodiert Betreff und Absender in der Übersicht", () => {
    expect(a.summary.find((s) => s.label === "Betreff")?.value).toBe("Grüße aus der IT");
    expect(a.summary.find((s) => s.label === "Von")?.value).toContain("Müller, Jürgen");
  });

  it("meldet fehlgeschlagene Prüfungen", () => {
    const failed = analyzeHeaders(
      "Authentication-Results: mx.example; spf=fail smtp.mailfrom=x.example; dmarc=fail\nFrom: a@x.example",
    );
    expect(failed.findings.filter((f) => f.level === "error")).toHaveLength(2);
  });

  it("wirft bei leerer Eingabe", () => {
    expect(() => analyzeHeaders("   ")).toThrow();
  });
});

describe("formatDuration", () => {
  it("formatiert Sekunden lesbar", () => {
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(125)).toBe("2 min 5 s");
    expect(formatDuration(3720)).toBe("1 h 2 min");
  });
});
