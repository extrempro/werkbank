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
| Profilbild (nur wenn `ENTRA_PROFILE_PHOTO` eingeschaltet ist) | Entra, bei der Anmeldung im Namen der Person gelesen (120 × 120 Pixel) | Wiedererkennen von Personen in der Oberfläche; für alle angemeldeten Personen sichtbar | bis zur nächsten Anmeldung ohne Bild in Entra, sonst solange Zugang besteht **[OFFEN]** |
| Aktionen im Audit-Log (wer, wann, was) | Werkbank | Nachweis, Sicherheit | **[OFFEN]** Vorschlag 2 Jahre |
| IP-Adresse (gekürzt) | Anfrage | Sicherheit | wie Audit-Log |
| IP-Adresse (vollständig, nur als Zähler im Arbeitsspeicher) | Anfrage | Schutz vor Missbrauch (Begrenzung der Anfragerate) | höchstens wenige Minuten, wird nicht gespeichert |
| Kommentare, Begründungen, Beschlüsse (Evergreen: wer hat wann wie entschieden, auch „im Auftrag“ mit Sitzungsdatum) | Eingabe | Nachweis | **[OFFEN]** |
| „Geändert von“ (Konto oder Anwendung, die eine Tenant-Einstellung geändert hat) | Entra-Audit-Log, beim Abruf abgefragt | Nachvollziehbarkeit | **[OFFEN]**; gespeichert je erkannter Änderung |
| Bewertungen und gepflegte Angaben (wer, wann, Kommentar; „Verantwortlich“ als Freitext) | Eingabe | Nachweis | **[OFFEN]** |
| Namen in Tenant-Einstellungen (z. B. Konten in Ausnahmen von Richtlinien) | Abruf über UTCM | Überwachung der Konfiguration | solange der Verlauf aufbewahrt wird **[OFFEN]** |
| Push-Abonnement (Endpunkt, Schlüssel) | Browser, nach Opt-in | Benachrichtigung | bis Widerruf |

Keine Tracking- oder Analysedienste. Keine Cookies außer dem technisch notwendigen Session-Cookie. Die gewählte Darstellung (hell oder dunkel) liegt nur im Browser der Person (`localStorage`, Schlüssel `werkbank-darstellung`) und wird nicht an den Server übertragen. Gleiches gilt für den Vermerk, welche Version der Neuigkeiten zuletzt geöffnet wurde (`werkbank-neuigkeiten-gesehen`).

## 3. Rechtsgrundlage

**[OFFEN]** z. B. Art. 6 Abs. 1 lit. f DSGVO bzw. § 26 BDSG / Betriebsvereinbarung. Abstimmung mit dem DSB.

## 4. Empfänger und Drittlandbezug

| Empfänger | Daten | Hinweis |
|---|---|---|
| Microsoft (Entra, Graph, UTCM) | Anmeldung, optional Abruf des eigenen Profilbilds, Abruf der Tenant-Einstellungen und des Nachrichtencenters, später Mailversand (Daten verlassen den Tenant nur in Richtung Werkbank) | bestehender Vertrag M365 |
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
