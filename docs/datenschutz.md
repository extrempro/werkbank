# Datenschutz (DSGVO)

> Vorlage. Rechtsgrundlagen, Fristen und Bewertung sind mit dem Datenschutzbeauftragten abzustimmen. Einträge mit **[OFFEN]** sind noch nicht entschieden.

## 1. Zweck der Verarbeitung

- Überwachung der Konfiguration des Microsoft-365-Tenants (Nachvollziehbarkeit, Sicherheit)
- Durchführung und Dokumentation des Freigabeprozesses für neue Microsoft-Funktionen (Evergreen) unter Beteiligung von Betriebsrat und Geschäftsführung
- Nachweis von Bewertungen und Entscheidungen (Audit-Log)

## 2. Verarbeitete personenbezogene Daten

| Daten | Herkunft | Zweck | Speicherdauer |
|---|---|---|---|
| Name, Mail, Entra-Objekt-ID der Nutzer | Entra-Anmeldung | Anmeldung, Zuordnung von Aktionen | solange Zugang besteht **[OFFEN]** |
| Rollen | Entra-App-Rollen | Berechtigung | solange Zugang besteht |
| Aktionen im Audit-Log (wer, wann, was) | Werkbank | Nachweis, Sicherheit | **[OFFEN]** Vorschlag 2 Jahre |
| IP-Adresse (gekürzt) | Anfrage | Sicherheit | wie Audit-Log |
| IP-Adresse (vollständig, nur als Zähler im Arbeitsspeicher) | Anfrage | Schutz vor Missbrauch (Begrenzung der Anfragerate) | höchstens wenige Minuten, wird nicht gespeichert |
| Kommentare, Begründungen, Beschlüsse | Eingabe | Nachweis | **[OFFEN]** |
| „Geändert von“ (Konto, das eine Tenant-Einstellung geändert hat) | Entra-Audit-Log | Nachvollziehbarkeit | **[OFFEN]** |
| Push-Abonnement (Endpunkt, Schlüssel) | Browser, nach Opt-in | Benachrichtigung | bis Widerruf |

Keine Tracking- oder Analysedienste. Keine Cookies außer dem technisch notwendigen Session-Cookie.

## 3. Rechtsgrundlage

**[OFFEN]** z. B. Art. 6 Abs. 1 lit. f DSGVO bzw. § 26 BDSG / Betriebsvereinbarung. Abstimmung mit dem DSB.

## 4. Empfänger und Drittlandbezug

| Empfänger | Daten | Hinweis |
|---|---|---|
| Microsoft (Entra, Graph) | Anmeldung, Mailversand | bestehender Vertrag M365 |
| Push-Dienste der Browserhersteller (Apple, Google, Mozilla) | verschlüsselte Push-Nachricht ohne Inhalt | nur nach Opt-in |
| KI-Anbieter (optional) | nur technische Metadaten, keine personenbezogenen Daten | **[OFFEN]** Anbieter, AVV |

## 5. Technische und organisatorische Maßnahmen (Auszug)

- Anmeldung nur über Entra ID mit MFA (Conditional Access)
- Rollenbasierter Zugriff, serverseitig geprüft
- Verschlüsselte Übertragung (TLS am Reverse Proxy)
- Datenbank nur intern erreichbar
- Service Worker speichert keine Fachdaten im Browser
- Push und Mail ohne Inhalte
- Protokollierung von Zugriffen auf sensible Bereiche
- Regelmäßige Sicherheitsprüfungen (siehe `docs/security/asvs-l2.md`)

## 6. Löschkonzept

**[OFFEN]** Automatische Löschung bzw. Pseudonymisierung nach Fristablauf (Job im Worker).

## 7. Mitbestimmung

Die Werkbank protokolliert Handlungen von Beschäftigten. Sie ist daher voraussichtlich mitbestimmungspflichtig. **[OFFEN]** Beteiligung des Betriebsrats vor Inbetriebnahme.
