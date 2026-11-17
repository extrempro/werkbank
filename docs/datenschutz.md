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
| Aktionen im Audit-Log (wer, wann, was) | Werkbank | Nachweis, Sicherheit | 90 Tage (in der Verwaltung einstellbar), danach automatische Löschung |
| IP-Adresse (gekürzt) | Anfrage | Sicherheit | wie Audit-Log |
| IP-Adresse (vollständig, nur als Zähler im Arbeitsspeicher) | Anfrage | Schutz vor Missbrauch (Begrenzung der Anfragerate) | höchstens wenige Minuten, wird nicht gespeichert |
| Kommentare, Begründungen, Beschlüsse (Evergreen: wer hat wann wie entschieden, auch „im Auftrag“ mit Sitzungsdatum) | Eingabe | Nachweis | **[OFFEN]** |
| „Geändert von“ (Konto oder Anwendung, die eine Tenant-Einstellung geändert hat) | Entra-Audit-Log, beim Abruf abgefragt | Nachvollziehbarkeit | **[OFFEN]**; gespeichert je erkannter Änderung |
| Bewertungen und gepflegte Angaben (wer, wann, Kommentar; „Verantwortlich“ als Freitext) | Eingabe | Nachweis | **[OFFEN]** |
| Namen und Adressen in Tenant-Einstellungen (z. B. Konten in Ausnahmen von Richtlinien; mit Exchange auch Adressen in Transportregeln und Schutz-Richtlinien; mit Teams und SharePoint vor allem Domänen für Freigabe und externen Zugriff; mit Intune Gruppen-IDs in Zuweisungen) | Abruf über UTCM | Überwachung der Konfiguration | solange der Verlauf aufbewahrt wird **[OFFEN]** |
| Benachrichtigungen der Glocke (Empfänger, Art, Titel, Link, Zeitpunkt, gelesen am, per Mail bzw. Teams mitgeteilt am) und Einstellungen je Person (Arten in Glocke, Mail, Teams) | Werkbank, aus dem Stand der Module; Titel nennen z. B. Vorgang, Vertrag, Rechnungsnummer, Anwendung | Hinweis auf Neues in den eigenen Bereichen | Benachrichtigungen 90 Tage, danach automatische Löschung; Einstellungen solange Zugang besteht |
| IT-Tools je Person: Favoriten, zuletzt genutzte Tools, Verlauf der Einstellungen (Tool, Einstellungen aus der Adresszeile, Zeitpunkt) | Nutzung der IT-Tools; nie Kennwörter, Schlüssel oder eingegebene Texte | Komfort: Tools auf jedem Gerät, Einstellungen wieder öffnen | Verlauf höchstens 200 Einträge und 90 Tage, von der Person jederzeit löschbar und abschaltbar; Favoriten solange Zugang besteht |
| IT-Projekte: Ansprechpartner (Name, Rolle im Projekt, Firma oder Abteilung, Kontakt als Freitext, intern und extern), Jour-Fixe-Protokolle und PDF-Anhänge (können Namen von Teilnehmenden enthalten), Aufgaben mit „zuständig“ als Freitext; Ersteller und letzte Änderung je Protokoll | Eingabe durch `Projekte.Editor`; keine Abfrage aus Entra | Steuerung von IT-Projekten; sichtbar für die Rollen `Projekte.Reader` und `Projekte.Editor`; das Audit-Log enthält keine Namen von Ansprechpartnern | bis das Projekt oder der Eintrag gelöscht wird **[OFFEN]** |
| Push-Abonnement je Gerät (Adresse beim Push-Dienst, öffentlicher Schlüssel und Auth-Geheimnis des Browsers, grobe Gerätebezeichnung wie „iPhone“, angemeldet und zuletzt zugestellt) | Browser, nach Opt-in im Konto | Push-Benachrichtigung | bis die Person das Gerät abmeldet oder der Push-Dienst das Abo als abgelaufen meldet; mit dem Konto gelöscht |

Keine Tracking- oder Analysedienste. Keine Cookies außer dem technisch notwendigen Session-Cookie. Die gewählte Darstellung (hell oder dunkel) liegt nur im Browser der Person (`localStorage`, Schlüssel `werkbank-darstellung`) und wird nicht an den Server übertragen. Gleiches gilt für den Vermerk, welche Version der Neuigkeiten zuletzt geöffnet wurde (`werkbank-neuigkeiten-gesehen`) und für die Wahl, ob die Navigation eingeklappt ist (`werkbank-navigation`). Die Favoriten im Bereich IT-Tools liegen ebenfalls nur im Browser (`werkbank-it-tools-favoriten`); Eingaben in die IT-Tools werden nicht an den Server übertragen. Der zuletzt geladene Stand des Brandings (Name, Farbe, Adressen der Logos; `werkbank-branding`) liegt ebenfalls nur im Browser; er enthält keine personenbezogenen Daten. Name, Farbe, Logos und Favicon sind ohne Anmeldung abrufbar, weil die Anmeldeseite sie zeigt.

## 3. Rechtsgrundlage

**[OFFEN]** z. B. Art. 6 Abs. 1 lit. f DSGVO bzw. § 26 BDSG / Betriebsvereinbarung. Abstimmung mit dem DSB.

## 4. Empfänger und Drittlandbezug

| Empfänger | Daten | Hinweis |
|---|---|---|
| SMTP-Server des Betreibers (in der Verwaltung eingetragen) | E-Mail-Adresse und Anzeigename der Empfängerin oder des Empfängers, Zahl der neuen Benachrichtigungen je Bereich, Link; ohne fachliche Inhalte | nur für Arten, die die Person selbst per Mail eingeschaltet hat; Testmail an die eigene Adresse |
| Microsoft Power Automate (Workflow im eigenen Tenant, in der Verwaltung eingetragen) | E-Mail-Adresse und Anzeigename der Empfängerin oder des Empfängers, Zahl der neuen Benachrichtigungen je Bereich, Link; ohne fachliche Inhalte | nur für Arten, die die Person selbst für Teams eingeschaltet hat; Zustellung als Flow-Bot in den Teams-Chat |
| Microsoft (Entra, Graph, UTCM) | Anmeldung, optional Abruf des eigenen Profilbilds, Abruf der Tenant-Einstellungen und des Nachrichtencenters, optional des Dienststatus (Zustand und Störungsmeldungen von Microsoft, ohne Personendaten), optional der Empfehlungen aus Secure Score (Statustexte nennen Anzahlen, z. B. „16 von 23 Konten“, keine Namen), optional der Nutzungsberichte nur als Summen je Dienst (Zahl aktiver und inaktiver Benutzer; Berichte je Person ruft die Werkbank nicht ab; Download von `reports.office.com`), später Mailversand (Daten verlassen den Tenant nur in Richtung Werkbank) | bestehender Vertrag M365 |
| Push-Dienste der Browserhersteller (Apple, Google, Mozilla, Microsoft) | Ende-zu-Ende verschlüsselte Push-Nachricht mit Name der Werkbank, Bereich und Anzahl, ohne fachliche Inhalte; der Dienst sieht nur Adresse und Größe | nur nach Opt-in |
| Öffentliche DNS-Resolver (Cloudflare, Google, Quad9), IANA und die zuständigen RDAP-Registrys, crt.sh, Have I Been Pwned (IT-Tools, in der Verwaltung abschaltbar, Standard: an) | nur, was jemand in DNS Lookup, DNS-/Mail-Check, RDAP oder bei der Subdomain-Suche abfragt (Domain, Name, IP-Adresse, AS-Nummer), mit der Adresse des Werkbank-Servers als Absender; bei „Passwort prüfen“ nur die ersten fünf Zeichen des SHA-1-Hashs, nie das Kennwort. Die Werkbank speichert und protokolliert die Abfragen nicht | Abfrage startet nur durch die Person im Tool; feste Ziele, nur https |
| NetBox des Betreibers (in der Verwaltung eingetragen) und ein öffentlicher DNS-Resolver (Cloudflare, Google oder Quad9; IT-Monitoring) | an NetBox nur der API-Token des Betreibers; an den Resolver die DNS-Namen und Typen aus NetBox; keine personenbezogenen Daten | DNS-Abgleich alle 4 Stunden, nur wenn eingeschaltet; Ergebnisse (DNS-Einträge, keine Personendaten) 90 Tage |
| KI-Anbieter (optional, in der Verwaltung eingetragen, Standard: aus) | nur Dienst, Bereich und Name der Eigenschaft einer Einstellung (z. B. „entra / conditionalAccessPolicy / state“); keine Werte, keine Namen von Objekten, keine personenbezogenen Daten | **[OFFEN]** AVV und Freigabe je nach gewähltem Anbieter; bei einem eigenen Dienst im internen Netz verlassen die Daten das Haus nicht |

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

- **Audit-Log:** Der Worker löscht Einträge automatisch nach der eingestellten Frist (Standard 90 Tage).
- **Sitzungen und Anmeldevorgänge:** werden nach Ablauf stündlich gelöscht.
- **[OFFEN]** Fristen für Vorgänge, Protokolle und Bewertungen sowie Löschung bzw. Pseudonymisierung von Personen, die die Werkbank nicht mehr nutzen.

## 7. Mitbestimmung

Die Werkbank protokolliert Handlungen von Beschäftigten. Sie ist daher voraussichtlich mitbestimmungspflichtig. **[OFFEN]** Beteiligung des Betriebsrats vor Inbetriebnahme.
