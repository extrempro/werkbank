# Einrichtung in Microsoft Entra ID

Diese Anleitung beschreibt, was im Entra Admin Center (https://entra.microsoft.com) angelegt wird.
Alle Beispiele verwenden `werkbank.example.com`. Ersetze das durch die öffentliche Adresse deiner Werkbank.

Microsoft ordnet das Menü des Entra Admin Centers gelegentlich neu. Stimmt ein Pfad wie „Identität → Anwendungen“ nicht mehr, führt die Suche oben im Portal (z. B. „App-Registrierungen“, „Bedingter Zugriff“) zum selben Ziel.

> **Nichts davon gehört ins Repository.** Tenant-ID, Client-ID und öffentliche Adresse kommen in die Umgebungsvariablen des Projekts (`.env` bzw. Verwaltungswerkzeug), Zertifikate und Secrets in den Secrets-Ordner auf dem Server (`WERKBANK_SECRETS_DIR`, z. B. `/opt/werkbank/secrets`, siehe [`deploy/README.md`](../deploy/README.md)). Secrets nie in Chats, Issues oder Commits einfügen.

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

Von der Übersichtsseite notieren (für die Umgebungsvariablen):

- **Anwendungs-ID (Client)** → `ENTRA_CLIENT_ID`
- **Verzeichnis-ID (Mandant)** → `ENTRA_TENANT_ID`

### 1.2 Authentifizierung

App-Registrierung → **Authentifizierung**

| Einstellung | Wert |
|---|---|
| URL für Front-Channel-Abmeldung | leer lassen (derzeit ohne Wirkung: Das Sitzungs-Cookie der Werkbank wird bei eingebetteten Aufrufen aus Sicherheitsgründen nicht mitgesendet. Die Sitzung endet über „Abmelden“ oder nach 30 Minuten Leerlauf) |
| Implizite Genehmigung (Zugriffstoken, ID-Token) | **beide aus** (die Werkbank nutzt den Authorization Code Flow mit PKCE) |
| Öffentliche Clientflows zulassen | **Nein** |

### 1.3 Zertifikat oder geheimer Clientschlüssel

Die Werkbank meldet sich als vertraulicher Client an. Beim Server (Backend-for-Frontend) bleiben alle Tokens, der Browser sieht nur ein Session-Cookie.

**Empfohlen: Zertifikat** (läuft nicht so schnell ab und ist schwerer zu missbrauchen als ein Secret):

```bash
# auf dem Server, im Secrets-Ordner (z. B. /opt/werkbank/secrets)
sudo openssl req -x509 -newkey rsa:3072 -sha256 -days 730 -nodes \
  -keyout entra_client_key.pem -out entra_client_cert.pem \
  -subj "/CN=Werkbank Login"
sudo chmod 444 entra_client_key.pem entra_client_cert.pem
```

→ App-Registrierung → **Zertifikate & Geheimnisse → Zertifikate → Zertifikat hochladen** → `entra_client_cert.pem`.
Der private Schlüssel (`entra_client_key.pem`) verlässt den Server nicht.

**Alternative: Geheimer Clientschlüssel** (einfacher, aber höchstens 24 Monate gültig):
→ **Neuer geheimer Clientschlüssel**, Ablauf 12 Monate, den **Wert** sofort im Secrets-Ordner als `entra_client_secret` speichern. Er wird nur einmal angezeigt. Die mitgelieferte `docker-compose.yml` bindet nur das Zertifikat ein; für diese Variante muss dort das Secret `entra_client_secret` statt der beiden Zertifikatsdateien eingetragen werden.

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

- `User.Read` – nur, wenn die Werkbank das **Profilbild** anzeigen soll (`ENTRA_PROFILE_PHOTO=true`). Die Werkbank liest damit bei der Anmeldung ausschließlich das eigene Bild der Person (`/me/photos/120x120`).

Ohne Profilbild kann `User.Read` entfernt werden; die Werkbank ruft Graph dann nicht im Namen des Benutzers auf.
→ **Administratorzustimmung für <Mandant> erteilen**

**Reihenfolge beim Einschalten des Profilbilds:** erst `User.Read` eintragen und die Administratorzustimmung erteilen, danach `ENTRA_PROFILE_PHOTO=true` setzen und die Werkbank neu starten. Fehlt die Zustimmung, schlägt die Anmeldung fehl.

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

Der Collector liest die Einstellungen des Tenants über **Unified Tenant Configuration Management (UTCM)** in Microsoft Graph. Grundsätze:

- Eigene Registrierung, **keine** Umleitungs-URI, **nur Anwendungsberechtigungen**
- Anmeldung **nur per Zertifikat**, kein Secret
- Die Werkbank ändert keine Einstellung des Tenants.

> **Stand:** Diese Schritte folgen der Dokumentation von Microsoft für die voreingestellten Entra-Typen.

### 4.1 App-Registrierung anlegen

1. **App-Registrierungen → Neue Registrierung**, Name `Werkbank Collector`, nur dieses Verzeichnis, keine Umleitungs-URI.
2. **Zertifikate & Geheimnisse → Zertifikate**: ein eigenes Zertifikat hochladen (Erzeugung wie in 1.3, Dateinamen `collector_client_key.pem` und `collector_client_cert.pem`).
3. **API-Berechtigungen → Microsoft Graph → Anwendungsberechtigungen**, danach **Administratorzustimmung erteilen**:

| Berechtigung | Wofür |
|---|---|
| `ConfigurationMonitoring.ReadWrite.All` | Snapshots bei UTCM anstoßen, abholen und wieder entfernen. Das Schreibrecht betrifft nur diese Snapshot-Aufträge, nicht die Einstellungen des Tenants. Mit `ConfigurationMonitoring.Read.All` allein lassen sich keine Snapshots erstellen. |
| `AuditLog.Read.All` | „Geändert von“: Wer eine Einstellung geändert hat, steht im Entra-Audit-Log. |
| `ServiceMessage.Read.All` | Evergreen: Meldungen aus dem Nachrichtencenter lesen. |

### 4.2 Dienstprinzipal von UTCM einrichten

UTCM liest die Einstellungen nicht mit den Rechten der Collector-App, sondern mit einem eigenen Dienstprinzipal von Microsoft („Tenant Configuration Management“, App-ID `03b07b79-c5bc-4b5e-9bfa-13acf4a99998`). Er muss einmal im Tenant angelegt werden und die Leserechte bekommen. Mit einem Global-Administrator-Konto in PowerShell:

```powershell
Install-Module Microsoft.Graph.Authentication, Microsoft.Graph.Applications
Connect-MgGraph -Scopes 'Application.ReadWrite.All', 'AppRoleAssignment.ReadWrite.All'

# Dienstprinzipal von UTCM anlegen
New-MgServicePrincipal -AppId '03b07b79-c5bc-4b5e-9bfa-13acf4a99998'

# Microsoft verlangt außerdem den Dienstprinzipal „M365 Admin Services“. Meist gibt es ihn schon:
if (-not (Get-MgServicePrincipal -Filter "AppId eq '6b91db1b-f05b-405a-a0b2-e3f60b28d645'")) {
    New-MgServicePrincipal -AppId '6b91db1b-f05b-405a-a0b2-e3f60b28d645'
}

# Leserechte für die voreingestellten Entra-Typen vergeben (siehe Tabelle unten)
$graph = Get-MgServicePrincipal -Filter "AppId eq '00000003-0000-0000-c000-000000000000'"
$tcm   = Get-MgServicePrincipal -Filter "AppId eq '03b07b79-c5bc-4b5e-9bfa-13acf4a99998'"
$rechte = @(
    'Policy.Read.All', 'Application.Read.All', 'Group.Read.All', 'User.Read.All',
    'RoleManagement.Read.Directory', 'Agreement.Read.All', 'CustomSecAttributeDefinition.Read.All'
)
foreach ($name in $rechte) {
    $role = $graph.AppRoles | Where-Object { $_.Value -eq $name }
    New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $tcm.Id -BodyParameter @{
        AppRoleId = $role.Id; ResourceId = $graph.Id; PrincipalId = $tcm.Id
    }
}
```

Welche Leserechte ein Ressourcentyp braucht, legt Microsoft fest ([Liste der Entra-Typen](https://learn.microsoft.com/en-us/graph/utcm-entra-resources)). Für die voreingestellten Typen:

| Ressourcentyp | Leserechte des Dienstprinzipals von UTCM |
|---|---|
| `microsoft.entra.conditionalaccesspolicy` | `Policy.Read.All`, `Application.Read.All`, `Group.Read.All`, `User.Read.All`, `RoleManagement.Read.Directory`, `Agreement.Read.All`, `CustomSecAttributeDefinition.Read.All` |
| `microsoft.entra.namedlocationpolicy` | `Policy.Read.All` |
| `microsoft.entra.authorizationpolicy` | `Policy.Read.All` |

Die vielen Rechte für Conditional Access braucht UTCM, um in den Richtlinien genannte Benutzer, Gruppen, Rollen und Anwendungen mit Namen statt mit Kennungen auszugeben. Im Snapshot und damit in der Werkbank stehen deshalb auch Namen von Konten, die in Richtlinien ein- oder ausgeschlossen sind (siehe [`datenschutz.md`](datenschutz.md)). Diese Rechte erhält der Dienstprinzipal von Microsoft, nicht die Werkbank.

Fehlt dem Dienstprinzipal ein Recht, schlägt nicht das Anlegen des Snapshots fehl, sondern erst der Abruf. Die Werkbank zeigt den Abruf dann als fehlgeschlagen; die Fehlerangabe von UTCM steht im Protokoll des Workers. Für weitere Ressourcentypen (`COLLECTOR_RESOURCES`) braucht der Dienstprinzipal die dort genannten Leserechte.

### 4.3 Grenzen von UTCM

- höchstens **20.000 gelesene Objekte pro Monat** (jede Richtlinie zählt als ein Objekt); deshalb ruft die Werkbank standardmäßig einmal täglich ab
- Snapshots werden von Microsoft höchstens 7 Tage aufbewahrt; den Verlauf hält die Werkbank selbst
- Voraussetzung laut Microsoft: Microsoft 365 E3 oder Entra ID P1

---

## 5. Werte für die Umgebungsvariablen

```dotenv
PUBLIC_URL=https://werkbank.example.com
ENTRA_TENANT_ID=<Verzeichnis-ID>
ENTRA_CLIENT_ID=<Anwendungs-ID der Registrierung „Werkbank“>
COLLECTOR_CLIENT_ID=<Anwendungs-ID der Registrierung „Werkbank Collector“>
```

Dateien im Secrets-Ordner (Schritt für Schritt: [`deploy/README.md`](../deploy/README.md), Abschnitt „Secrets anlegen“):

- `postgres_password`
- `entra_client_key.pem` und `entra_client_cert.pem`
- `collector_client_key.pem` und `collector_client_cert.pem`

## Checkliste

- [ ] App-Registrierung „Werkbank“ angelegt (1.1)
- [ ] Authentifizierung eingestellt (1.2)
- [ ] Zertifikat hochgeladen oder Secret erstellt (1.3)
- [ ] Optionale Ansprüche `email`, `preferred_username`, `auth_time` (1.4)
- [ ] Delegierte Berechtigungen und Administratorzustimmung (1.5)
- [ ] Acht App-Rollen angelegt (1.6)
- [ ] „Zuweisung erforderlich“ = Ja (1.7)
- [ ] Gruppen angelegt und Rollen zugewiesen (1.8)
- [ ] CA-Richtlinie `CA-Werkbank-MFA` im Modus „Nur Bericht“ (2)
- [ ] App-Registrierung „Werkbank Collector“ mit Zertifikat, Berechtigungen und Administratorzustimmung (4.1)
- [ ] Dienstprinzipale von UTCM angelegt, Leserechte vergeben (4.2)
- [ ] Werte in den Umgebungsvariablen und Dateien im Secrets-Ordner auf dem Server (5)
