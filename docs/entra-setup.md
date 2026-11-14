# Einrichtung in Microsoft Entra ID

Diese Anleitung beschreibt, was im Entra Admin Center (https://entra.microsoft.com) angelegt wird.
Alle Beispiele verwenden `werkbank.example.com`. Ersetze das durch die öffentliche Adresse deiner Werkbank.

> **Nichts davon gehört ins Repository.** Tenant-ID, Client-ID und öffentliche Adresse kommen in `deploy/.env` auf dem Server, Zertifikate und Secrets in `deploy/secrets/`. Secrets nie in Chats, Issues oder Commits einfügen.

## Überblick

| App-Registrierung | Zweck | Wann |
|---|---|---|
| **Werkbank** | Anmeldung der Benutzer, Rollen | jetzt (Phase 1) |
| **Werkbank (Entwicklung)** | Anmeldung bei lokaler Entwicklung über `localhost` | optional, jetzt |
| **Werkbank Collector** | Lesender Zugriff auf die Tenant-Konfiguration ohne Benutzer | Phase 2 |

Voraussetzung: **Entra ID P1** für alle Werkbank-Nutzer. Das wird für Conditional Access und für die Rollenzuweisung über Gruppen benötigt.

---

## 1. App-Registrierung „Werkbank“ (Anmeldung)

### 1.1 Anlegen

Entra Admin Center → **Identität → Anwendungen → App-Registrierungen → Neue Registrierung**

| Feld | Wert |
|---|---|
| Name | `Werkbank` |
| Unterstützte Kontotypen | **Nur Konten in diesem Organisationsverzeichnis** (ein Mandant) |
| Umleitungs-URI | Plattform **Web**, `https://werkbank.example.com/auth/callback` |

→ **Registrieren**

Von der Übersichtsseite notieren (für `deploy/.env`):

- **Anwendungs-ID (Client)** → `ENTRA_CLIENT_ID`
- **Verzeichnis-ID (Mandant)** → `ENTRA_TENANT_ID`

### 1.2 Authentifizierung

App-Registrierung → **Authentifizierung**

| Einstellung | Wert |
|---|---|
| URL für Front-Channel-Abmeldung | `https://werkbank.example.com/auth/logout` |
| Implizite Genehmigung (Zugriffstoken, ID-Token) | **beide aus** (die Werkbank nutzt den Authorization Code Flow mit PKCE) |
| Öffentliche Clientflows zulassen | **Nein** |

### 1.3 Zertifikat oder geheimer Clientschlüssel

Die Werkbank meldet sich als vertraulicher Client an. Beim Server (Backend-for-Frontend) bleiben alle Tokens, der Browser sieht nur ein Session-Cookie.

**Empfohlen: Zertifikat** (läuft nicht so schnell ab und ist schwerer zu missbrauchen als ein Secret):

```bash
# auf dem Server, im Ordner deploy/secrets
openssl req -x509 -newkey rsa:3072 -sha256 -days 730 -nodes \
  -keyout entra_client_key.pem -out entra_client_cert.pem \
  -subj "/CN=Werkbank Login"
chmod 444 entra_client_key.pem entra_client_cert.pem
```

→ App-Registrierung → **Zertifikate & Geheimnisse → Zertifikate → Zertifikat hochladen** → `entra_client_cert.pem`.
Der private Schlüssel (`entra_client_key.pem`) verlässt den Server nicht.

**Alternative: Geheimer Clientschlüssel** (einfacher, aber höchstens 24 Monate gültig):
→ **Neuer geheimer Clientschlüssel**, Ablauf 12 Monate, den **Wert** sofort in `deploy/secrets/entra_client_secret` speichern. Er wird nur einmal angezeigt.

Ablaufdatum in den Kalender eintragen. Später überwacht die Werkbank das selbst (Verwaltung → Konnektoren).

### 1.4 Tokenkonfiguration

App-Registrierung → **Tokenkonfiguration → Optionalen Anspruch hinzufügen** → Tokentyp **ID**:

- `email`
- `preferred_username`
- `auth_time` (empfohlen): Zeitpunkt der letzten echten Anmeldung. Damit erkennt die Werkbank bei der erneuten Anmeldung für die Verwaltung (Step-up), ob wirklich neu angemeldet wurde. Ohne diesen Anspruch zählt der Zeitpunkt der Rückkehr von Entra.

Gruppenansprüche sind **nicht** nötig, die Werkbank arbeitet mit App-Rollen.

### 1.5 API-Berechtigungen

App-Registrierung → **API-Berechtigungen**

Microsoft Graph, **delegiert**:

- `openid`
- `profile`
- `email`

`User.Read` kann entfernt werden, die Werkbank ruft Graph nicht im Namen des Benutzers auf.
→ **Administratorzustimmung für <Mandant> erteilen**

### 1.6 App-Rollen

App-Registrierung → **App-Rollen → App-Rolle erstellen**. Für jede Zeile eine Rolle:

| Anzeigename | Wert | Beschreibung |
|---|---|---|
| Werkbank Admin | `Werkbank.Admin` | Verwaltung der Werkbank: Module, Konnektoren, Regeln, Audit-Log |
| Werkbank Auditor | `Werkbank.Auditor` | Audit-Log und Reports lesen |
| Konfiguration Leser | `Config.Reader` | M365-Konfiguration ansehen und exportieren |
| Konfiguration Prüfer | `Config.Reviewer` | Änderungen bewerten, Beschreibungen und Soll-Werte pflegen |
| Evergreen IT | `Evergreen.IT` | Technische Bewertung und Umsetzung von Evergreen-Vorgängen |
| Evergreen Team | `Evergreen.Team` | Rückmeldungen der Fachabteilungen und BR-Vorlagen |
| Evergreen Betriebsrat | `Evergreen.Betriebsrat` | Stellungnahme zu vorgelegten Vorgängen |
| Evergreen Geschäftsführung | `Evergreen.GF` | Abnahme von Vorgängen |

Für alle Rollen gilt:
- **Zulässige Mitgliedstypen:** Benutzer/Gruppen
- **Möchten Sie diese App-Rolle aktivieren?** ja

Die Werte müssen **genau so** geschrieben sein, die Werkbank prüft sie wörtlich.

### 1.7 Zugriff auf zugewiesene Personen beschränken

Entra Admin Center → **Identität → Anwendungen → Unternehmensanwendungen → Werkbank**

- **Eigenschaften → Zuweisung erforderlich?** → **Ja**
  Ohne diese Einstellung könnte sich jede Person aus dem Mandanten anmelden (ohne Rolle, aber mit Zugriff auf die Login-Seite dahinter).
- **Eigenschaften → Für Benutzer sichtbar?** → nach Wunsch (erscheint dann in „Meine Apps“)

### 1.8 Gruppen den Rollen zuweisen

Zuerst je Rolle eine Sicherheitsgruppe anlegen. **Die Gruppennamen sind frei wählbar**, z. B. nach eurem bestehenden Namensschema. Die Werkbank sieht die Gruppen nicht, sie wertet nur die **App-Rollen** aus (deren Werte aus 1.6 müssen exakt stimmen). Vorschlag:

| Gruppe | Rolle |
|---|---|
| `GG-Werkbank-Admin` | Werkbank.Admin |
| `GG-Werkbank-Auditor` | Werkbank.Auditor |
| `GG-Werkbank-Config-Reader` | Config.Reader |
| `GG-Werkbank-Config-Reviewer` | Config.Reviewer |
| `GG-Werkbank-Evergreen-IT` | Evergreen.IT |
| `GG-Werkbank-Evergreen-Team` | Evergreen.Team |
| `GG-Werkbank-Evergreen-BR` | Evergreen.Betriebsrat |
| `GG-Werkbank-Evergreen-GF` | Evergreen.GF |

Dann: Unternehmensanwendungen → Werkbank → **Benutzer und Gruppen → Benutzer/Gruppe hinzufügen** → Gruppe wählen → Rolle wählen → **Zuweisen**. Für jede Gruppe wiederholen.

Hinweis: Zuweisungen über Gruppen gelten nur für direkte Mitglieder. Verschachtelte Gruppen werden bei App-Rollen nicht aufgelöst.

---

## 2. Conditional Access: MFA für die Werkbank

Entra Admin Center → **Schutz → Bedingter Zugriff → Richtlinien → Neue Richtlinie**

| Feld | Wert |
|---|---|
| Name | `CA-Werkbank-MFA` |
| Benutzer → Einschließen | **Alle Benutzer** (betrifft nur die Werkbank, siehe Zielressourcen) |
| Benutzer → Ausschließen | Notfallkonten (Break-Glass), falls vorhanden |
| Zielressourcen → Einschließen | **Apps auswählen → Werkbank** |
| Gewähren | **Zugriff gewähren → Authentifizierungsstärke erforderlich → Multi-Faktor-Authentifizierung** |
| Richtlinie aktivieren | zuerst **Nur Bericht**, nach einigen Tagen ohne Auffälligkeiten **Ein** |

Vor dem Einschalten:
- Personen ohne MFA-Methode (z. B. Betriebsrat, Geschäftsführung) informieren und Microsoft Authenticator einrichten lassen.
- In den Anmeldeprotokollen prüfen, ob „Nur Bericht“ wie erwartet greift.

---

## 3. Optional: App-Registrierung „Werkbank (Entwicklung)“

Für die lokale Entwicklung eine eigene Registrierung, damit Produktions-Zugangsdaten nie auf Entwickler-PCs liegen.

Wie in Abschnitt 1, mit diesen Unterschieden:
- Name: `Werkbank (Entwicklung)`
- Umleitungs-URI: `http://localhost:8080/auth/callback` (bei `localhost` erlaubt Entra `http`)
- Nur Entwickler zuweisen, Rollen nach Bedarf
- Geheimer Clientschlüssel mit kurzer Laufzeit (z. B. 3 Monate)

Für die automatischen Tests (CI) wird **keine** Entra-Registrierung benötigt: Dort ersetzt ein Test-Login die Anmeldung. Er ist in Produktion technisch ausgeschlossen.

---

## 4. App-Registrierung „Werkbank Collector“ (Phase 2)

Wird erst mit dem Modul M365-Konfiguration angelegt. Grundsätze schon jetzt:

- Eigene Registrierung, **keine** Umleitungs-URI, **nur Anwendungsberechtigungen**
- Anmeldung **nur per Zertifikat**, kein Secret
- **Nur lesende** Berechtigungen. Die genaue Liste je Datenquelle (Graph, UTCM, Exchange Online, Teams) wird in Phase 2 ergänzt und begründet.
- Wird in Phase 3 um `ServiceMessage.Read.All` für das Nachrichtencenter erweitert.

---

## 5. Werte für `deploy/.env`

```dotenv
PUBLIC_URL=https://werkbank.example.com
ENTRA_TENANT_ID=<Verzeichnis-ID>
ENTRA_CLIENT_ID=<Anwendungs-ID der Registrierung „Werkbank“>
```

Dateien in `deploy/secrets/` (je nach Variante aus 1.3):

- `entra_client_key.pem` und `entra_client_cert.pem`, **oder**
- `entra_client_secret`

## Checkliste

- [ ] App-Registrierung „Werkbank“ angelegt (1.1)
- [ ] Authentifizierung eingestellt (1.2)
- [ ] Zertifikat hochgeladen oder Secret erstellt (1.3)
- [ ] Optionale Ansprüche `email`, `preferred_username` (1.4)
- [ ] Delegierte Berechtigungen und Administratorzustimmung (1.5)
- [ ] Acht App-Rollen angelegt (1.6)
- [ ] „Zuweisung erforderlich“ = Ja (1.7)
- [ ] Gruppen angelegt und Rollen zugewiesen (1.8)
- [ ] CA-Richtlinie `CA-Werkbank-MFA` im Modus „Nur Bericht“ (2)
- [ ] Werte in `deploy/.env` und `deploy/secrets/` auf dem Server (5)
