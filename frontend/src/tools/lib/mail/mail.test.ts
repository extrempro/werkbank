import { describe, expect, it } from "vitest";
import {
  bounceFromMime,
  bounceFromMsg,
  compactSmtp,
  parseDeliveryStatus,
  parseTextBounce,
} from "./bounce";
import { readCfb } from "./cfb";
import { writeMsg } from "./fixtures/write-msg";
import { parseMimeText, textOf } from "./mime";
import { P, readMsg } from "./msg";
import { explainSmtpCode, explainStatus, findStatus, hintsFor } from "./smtp-codes";
import { loadFile, loadText } from "../../mail-header/load";

const postfixDsn = `Return-Path: <>
Received: by mx.firma.de (Postfix) id 4A1B2C3D; Mon,  9 Nov 2026 10:00:05 +0100 (CET)
Date: Mon,  9 Nov 2026 10:00:05 +0100 (CET)
From: MAILER-DAEMON@mx.firma.de (Mail Delivery System)
Subject: Undelivered Mail Returned to Sender
To: erika@firma.de
MIME-Version: 1.0
Content-Type: multipart/report; report-type=delivery-status;
\tboundary="4A1B2C3D.1700000000/mx.firma.de"

This is a MIME-encapsulated message.

--4A1B2C3D.1700000000/mx.firma.de
Content-Description: Notification
Content-Type: text/plain; charset=us-ascii

This is the mail system at host mx.firma.de.

I'm sorry to have to inform you that your message could not
be delivered to one or more recipients.

<max.muster@kunde.example>: host kunde-example.mail.protection.outlook.com[52.101.68.1]
    said: 550 5.4.1 Recipient address rejected: Access denied.
    [AM4PEPF00027A6C.eurprd04.prod.outlook.com 2026-11-09T09:00:05.123Z]
    (in reply to RCPT TO command)

--4A1B2C3D.1700000000/mx.firma.de
Content-Description: Delivery report
Content-Type: message/delivery-status

Reporting-MTA: dns; mx.firma.de
Arrival-Date: Mon,  9 Nov 2026 10:00:03 +0100 (CET)

Final-Recipient: rfc822; max.muster@kunde.example
Original-Recipient: rfc822;max.muster@kunde.example
Action: failed
Status: 5.4.1
Remote-MTA: dns; kunde-example.mail.protection.outlook.com
Diagnostic-Code: smtp; 550 5.4.1 Recipient address rejected: Access denied.
    [AM4PEPF00027A6C.eurprd04.prod.outlook.com 2026-11-09T09:00:05.123Z]

--4A1B2C3D.1700000000/mx.firma.de
Content-Description: Undelivered Message
Content-Type: message/rfc822

Received: from [10.0.0.5] (pc1.firma.local [10.0.0.5]) by mx.firma.de (Postfix) with ESMTPSA id 4A1B2C3D; Mon,  9 Nov 2026 10:00:03 +0100 (CET)
From: Erika Mustermann <erika@firma.de>
To: max.muster@kunde.example
Subject: =?UTF-8?Q?Angebot_f=C3=BCr_Sie?=
Message-ID: <abc@firma.de>
Date: Mon, 9 Nov 2026 10:00:00 +0100
Content-Type: text/plain; charset=utf-8

Hallo Max
--4A1B2C3D.1700000000/mx.firma.de--
`;

describe("MIME", () => {
  it("multipart, eingebettete Nachricht, quoted-printable und Zeichensatz", () => {
    const root = parseMimeText(postfixDsn);
    expect(root.contentType).toBe("multipart/report");
    expect(root.parts.length).toBe(3);
    expect(root.parts[2]!.message?.headers.find((h) => h.name === "Message-ID")?.value).toBe(
      "<abc@firma.de>",
    );
    const qp = parseMimeText(
      'Content-Type: text/plain; charset="iso-8859-1"\nContent-Transfer-Encoding: quoted-printable\n\nGr=FC=DFe =\nund mehr',
    );
    expect(textOf(qp)).toBe("Grüße und mehr");
    const b64 = parseMimeText(
      "Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: base64\n\nw4Rw\nZmVs\n",
    );
    expect(textOf(b64)).toBe("Äpfel");
  });
});

describe("Rückläufer", () => {
  it("Postfix mit Zustellbericht (RFC 3464) und Original", () => {
    const b = bounceFromMime(parseMimeText(postfixDsn))!;
    expect(b.source).toBe("dsn");
    expect(b.reportingMta).toBe("mx.firma.de");
    expect(b.recipients).toHaveLength(1);
    expect(b.recipients[0]).toMatchObject({
      address: "max.muster@kunde.example",
      status: "5.4.1",
      action: "failed",
      remoteMta: "kunde-example.mail.protection.outlook.com",
    });
    expect(b.recipients[0]!.diagnostic).toContain("Recipient address rejected: Access denied.");
    expect(b.original?.complete).toBe(true);
    expect(b.original?.headers).toContain("Message-ID: <abc@firma.de>");
    const hints = hintsFor("5.4.1", b.recipients[0]!.diagnostic!, {});
    expect(hints[0]!.id).toBe("ms-dbeb");
  });

  it("Zustellbericht mit mehreren Empfängern und verzögerter Zustellung", () => {
    const d = parseDeliveryStatus(
      "Reporting-MTA: dns; mx.a.de\n\nFinal-Recipient: rfc822; a@b.de\nAction: delayed\nStatus: 4.4.1\nWill-Retry-Until: Wed, 11 Nov 2026 10:00:00 +0100\n\nFinal-Recipient: rfc822;c@d.de\nAction: failed\nStatus: 5.2.2 (mailbox full)\n",
    );
    expect(d.reportingMta).toBe("mx.a.de");
    expect(d.recipients.map((r) => [r.address, r.action, r.status])).toEqual([
      ["a@b.de", "delayed", "4.4.1"],
      ["c@d.de", "failed", "5.2.2"],
    ]);
    expect(d.recipients[0]!.retryUntil).toContain("2026");
  });

  it("Exim-Text ohne Zustellbericht", () => {
    const text = `This message was created automatically by mail delivery software.

A message that you sent could not be delivered to one or more of its
recipients. This is a permanent error. The following address(es) failed:

  info@shop.example
    host mx.shop.example [203.0.113.5]
    SMTP error from remote mail server after RCPT TO:<info@shop.example>:
    550-5.7.1 Service unavailable; client [198.51.100.7] blocked using
    550 5.7.1 zen.spamhaus.org

------ This is a copy of the message, including all the headers. ------

Return-path: <erika@firma.de>
From: erika@firma.de
Subject: Test
`;
    const r = parseTextBounce(text);
    expect(r.map((x) => x.address)).toEqual(["info@shop.example"]);
    const b = bounceFromMime(
      parseMimeText(
        `From: Mail Delivery System <Mailer-Daemon@mx.firma.de>\nSubject: Mail delivery failed: returning message to sender\n\n${text}`,
      ),
    )!;
    expect(b.recipients[0]).toMatchObject({
      address: "info@shop.example",
      status: "5.7.1",
      smtpCode: "550",
    });
    expect(b.recipients[0]!.diagnostic).toContain("zen.spamhaus.org");
    expect(hintsFor(b.recipients[0]!.status, b.recipients[0]!.diagnostic!, {})[0]!.id).toBe(
      "blocklist",
    );
    expect(b.original?.headers).toContain("Subject: Test");
  });

  it("nur Kopfzeilen eines Rückläufers → Hinweis auf vollständigen Quelltext", () => {
    const l = loadText(
      "From: Microsoft Outlook <MicrosoftExchange329e71ec88ae4615bbc36ab6ce41109e@firma.de>\nTo: erika@firma.de\nSubject: Unzustellbar: Angebot\n",
    );
    expect(l.bounce === null).toBe(false);
    expect(l.notes.join(" ")).toContain("nur die Kopfzeilen");
  });

  it("normale Mail ist kein Rückläufer, Missbrauchsberichte auch nicht", () => {
    expect(bounceFromMime(parseMimeText("From: a@b.de\nSubject: Hallo\n\nText"))).toBeNull();
    expect(
      bounceFromMime(
        parseMimeText(
          'From: x@y.de\nSubject: Report\nContent-Type: multipart/report; report-type=feedback-report; boundary="b"\n\n--b\n\nx\n--b--',
        ),
      ),
    ).toBeNull();
  });

  it("mehrzeilige SMTP-Antworten zusammenfassen", () => {
    expect(
      compactSmtp(
        "550-5.7.26 Unauthenticated email is not accepted 550-5.7.26 due to DMARC 550 5.7.26 policy",
      ),
    ).toBe("550 5.7.26 Unauthenticated email is not accepted due to DMARC policy");
  });
});

describe("Statuscodes", () => {
  it("erklären, Microsoft-Varianten, einfache SMTP-Codes", () => {
    expect(explainStatus("5.1.1")).toMatchObject({
      permanent: true,
      text: "Postfach existiert nicht (Empfängeradresse unbekannt)",
    });
    expect(explainStatus("4.2.2")?.permanent).toBe(false);
    expect(
      explainStatus("5.4.1", "Recipient address rejected: Access denied. [x.prod.outlook.com]")
        ?.text,
    ).toContain("Microsoft 365");
    expect(explainStatus("5.7.620", "Access denied, banned sending IP")?.text).toContain(
      "sender.office.com",
    );
    expect(explainSmtpCode("552")?.text).toContain("zu groß");
    expect(findStatus("#< #5.1.10 smtp;550 5.1.10 RESOLVER.ADR.RecipientNotFound>")).toBe("5.1.10");
    expect(findStatus("IP 10.5.1.20 und Version 4.4.1.2")).toBeUndefined();
  });
});

describe("Outlook (.msg)", () => {
  const ndr = writeMsg({
    props: [
      { id: P.MESSAGE_CLASS, value: "REPORT.IPM.Note.NDR" },
      { id: P.SUBJECT, value: "Unzustellbar: Angebot für Sie" },
      {
        id: P.BODY,
        value:
          "Ihre Nachricht konnte nicht an max.muster@kunde.example zugestellt werden.\r\n\r\nDiagnoseinformationen für Administratoren:\r\nRemote Server returned '550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup'",
      },
      { id: 0x3ffd, value: 65001 },
    ],
    recipients: [
      [
        { id: P.DISPLAY_NAME, value: "Max Muster" },
        { id: P.SMTP_ADDRESS, value: "max.muster@kunde.example" },
        {
          id: P.SUPPLEMENTARY_INFO,
          value:
            "< #5.1.10 smtp;550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup>",
        },
        { id: P.NDR_DIAG_CODE, value: 0 },
        { id: P.NDR_STATUS_CODE, value: 550 },
      ],
    ],
    attachments: [
      {
        props: [{ id: P.ATTACH_METHOD, value: 5 }],
        embedded: {
          props: [
            { id: P.MESSAGE_CLASS, value: "IPM.Note" },
            { id: P.SUBJECT, value: "Angebot für Sie" },
            {
              id: P.TRANSPORT_HEADERS,
              value:
                "From: Erika Mustermann <erika@firma.de>\r\nTo: max.muster@kunde.example\r\nSubject: Angebot\r\nMessage-ID: <x1@firma.de>\r\n",
            },
          ],
        },
      },
    ],
  });

  it("Compound File und Eigenschaften lesen", () => {
    expect(readCfb(ndr).children.length).toBeGreaterThanOrEqual(4);
    const m = readMsg(ndr);
    expect(m.props.get(P.MESSAGE_CLASS)).toBe("REPORT.IPM.Note.NDR");
    expect(m.recipients[0]!.get(P.NDR_STATUS_CODE)).toBe(550);
    expect(m.attachments[0]!.embedded?.props.get(P.SUBJECT)).toBe("Angebot für Sie");
  });

  it("Outlook-Unzustellbarkeitsbericht auswerten", () => {
    const b = bounceFromMsg(readMsg(ndr))!;
    expect(b.source).toBe("outlook");
    expect(b.recipients[0]).toMatchObject({
      address: "max.muster@kunde.example",
      status: "5.1.10",
      smtpCode: "550",
      action: "failed",
    });
    expect(b.original?.headers).toContain("Message-ID: <x1@firma.de>");
    expect(b.recipients[0]!.diagnostic).toBe(
      "550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup",
    );
    const l = loadFile("Unzustellbar.msg", ndr);
    expect(l.kind).toBe("msg");
    expect(l.notes.join(" ")).toContain("keine Internetkopfzeilen");
  });

  it("kaputte Dateien werden sauber abgelehnt", () => {
    const broken = ndr.slice();
    broken[48] = 0xff; // Verzeichnis-Startsektor ungültig
    expect(() => readMsg(broken)).toThrow();
    expect(() => loadFile("x.msg", new TextEncoder().encode("kein msg"))).toThrow(
      "keine Outlook-Nachricht",
    );
  });
});
