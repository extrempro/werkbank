import { describe, expect, it } from "vitest";
import {
  emailPayload,
  emptyVcard,
  escapeWifi,
  phonePayload,
  smsPayload,
  urlPayload,
  vcardPayload,
  wifiPayload,
} from "./payloads";

describe("Link", () => {
  it("ergänzt https:// nur ohne Schema", () => {
    expect(urlPayload("intranet.example.com/wiki")).toBe("https://intranet.example.com/wiki");
    expect(urlPayload("http://alt.example")).toBe("http://alt.example");
    expect(urlPayload("  ")).toBe("");
  });
});

describe("WLAN", () => {
  it("baut das WIFI-Format", () => {
    expect(wifiPayload({ ssid: "Büro", password: "geheim", security: "WPA", hidden: false })).toBe(
      "WIFI:T:WPA;S:Büro;P:geheim;;",
    );
    expect(wifiPayload({ ssid: "Gäste", password: "x", security: "nopass", hidden: true })).toBe(
      "WIFI:T:nopass;S:Gäste;H:true;;",
    );
    expect(wifiPayload({ ssid: "", password: "x", security: "WPA", hidden: false })).toBe("");
  });

  it("maskiert Sonderzeichen", () => {
    expect(escapeWifi('a;b,c:d"e\\f')).toBe('a\\;b\\,c\\:d\\"e\\\\f');
    expect(wifiPayload({ ssid: "Netz;1", password: "p:w", security: "WPA", hidden: false })).toBe(
      "WIFI:T:WPA;S:Netz\\;1;P:p\\:w;;",
    );
  });
});

describe("Kontakt", () => {
  it("baut eine vCard 3.0", () => {
    const v = vcardPayload({
      ...emptyVcard,
      firstName: "Jürgen",
      lastName: "Müller",
      organization: "Beispiel GmbH, IT",
      phoneMobile: "+49 170 1234567",
      email: "juergen@example.com",
      website: "example.com",
      city: "München",
    });
    expect(v.split("\r\n")).toEqual([
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Müller;Jürgen;;;",
      "FN:Jürgen Müller",
      "ORG:Beispiel GmbH\\, IT",
      "TEL;TYPE=CELL:+49 170 1234567",
      "EMAIL;TYPE=INTERNET:juergen@example.com",
      "URL:https://example.com",
      "ADR;TYPE=WORK:;;;München;;;",
      "END:VCARD",
    ]);
  });

  it("braucht mindestens Name oder Firma", () => {
    expect(vcardPayload(emptyVcard)).toBe("");
    expect(vcardPayload({ ...emptyVcard, organization: "IT" })).toContain("FN:IT");
  });
});

describe("E-Mail, Telefon, SMS", () => {
  it("baut mailto-Links", () => {
    expect(
      emailPayload({ to: "it@example.com", subject: "Drucker defekt", body: "Raum 1.23 & 1.24" }),
    ).toBe("mailto:it@example.com?subject=Drucker%20defekt&body=Raum%201.23%20%26%201.24");
    expect(emailPayload({ to: "it@example.com", subject: "", body: "" })).toBe(
      "mailto:it@example.com",
    );
  });

  it("normalisiert Telefonnummern", () => {
    expect(phonePayload("+49 (89) 123-456")).toBe("tel:+4989123456");
    expect(phonePayload("abc")).toBe("");
  });

  it("baut SMS-Inhalte", () => {
    expect(smsPayload({ phone: "0170 1234567", message: "Server down" })).toBe(
      "SMSTO:01701234567:Server down",
    );
    expect(smsPayload({ phone: "+49170", message: "" })).toBe("SMSTO:+49170");
  });
});
