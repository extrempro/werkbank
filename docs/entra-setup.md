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
| IT-Tools Nutzer | `Tools.User` | Bereich IT-Tools öffnen (Rechner, Generatoren, Konverter) |
| Tenant Leser | `Tenant.Reader` | Lizenzen und Benutzerzahlen des Tenants mit Verlauf ansehen |
| Budget Bearbeiter | `Budget.Editor` | IT-Budget ansehen; Konten, Budgetposten, Verträge, Partner und Rechnungen pflegen |
| Budgetverwalter | `Budget.Manager` | Wie Bearbeiter, dazu Rechnungen buchen und die Einstellungen festlegen |
| Budget Leser | `Budget.Reader` | IT-Budget ansehen |

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
| `GG-Werkbank-Tools` | Tools.User |
| `GG-Werkbank-Tenant` | Tenant.Reader |
| `GG-Werkbank-Budget-IT` | Budget.Editor |
| `GG-Werkbank-Budget-Verwaltung` | Budget.Manager |
| `GG-Werkbank-Budget-Leser` | Budget.Reader |

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
| `SecurityEvents.Read.All` | Freiwillig: Empfehlungen aus Microsoft Secure Score lesen (Seite „Empfehlungen“). Erst danach in der `.env` `SECURE_SCORE_ENABLED=true` setzen; ohne die Berechtigung schlägt der Abruf fehl. |
| `Organization.Read.All` und `User.Read.All` | Freiwillig: Lizenzen und Benutzerzahlen lesen (Seiten „Lizenzen“ und „Benutzer“). Gelesen werden gekaufte und zugewiesene Lizenzen, die Abos mit ihrem Stichtag und die **Zahl** der Konten; Namen von Personen ruft die Werkbank nicht ab. `User.Read.All` erlaubt bei Microsoft grundsätzlich das Lesen aller Benutzerprofile, eine engere Berechtigung für die reine Anzahl gibt es nicht. Erst danach in der `.env` `TENANT_MONITOR_ENABLED=true` setzen; ohne die Berechtigungen schlägt der Abruf fehl. |
| `Application.Read.All` | Freiwillig: Zertifikate und Secrets der Anwendungen lesen (Seite „Zertifikate und Secrets“). Gelesen werden Bezeichnung und Ablaufdatum von App-Registrierungen und die Signaturzertifikate von Unternehmensanwendungen mit SAML. Den geheimen Wert eines Secrets liefert Microsoft nicht aus, die Werkbank speichert ihn nie. Erst danach in der `.env` `TENANT_CREDENTIALS_ENABLED=true` setzen; ohne die Berechtigung schlägt der Abruf fehl. |
| `ServiceHealth.Read.All` | Freiwillig: Dienststatus von Exchange Online, Microsoft Teams, SharePoint Online und Microsoft Entra mit Störungen und Hinweisen lesen (Seite „Dienststatus“). Die Meldungen enthalten keine Personendaten. Erst danach in der `.env` `TENANT_HEALTH_ENABLED=true` setzen; ohne die Berechtigung schlägt der Abruf fehl. Abstand: `TENANT_HEALTH_INTERVAL_MINUTES` (Standard 15, mindestens 5). |

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

### 4.3 Exchange Online dazunehmen (freiwillig)

UTCM kann auch Einstellungen von Exchange Online lesen ([Liste der Exchange-Typen](https://learn.microsoft.com/en-us/graph/utcm-exchange-resources)). Die Werkbank ist für die organisationsweiten Einstellungen gedacht (Transport, Schutz, Zugriff), nicht für einzelne Postfächer oder Gruppen. Dafür sind zwei Dinge nötig.

**1. Rechte für den Dienstprinzipal von UTCM.** Laut Microsoft braucht er zum Lesen die Anwendungsberechtigung `Exchange.ManageAsApp` (bei „Office 365 Exchange Online“) und je nach Typ die Entra-Rolle „Globaler Leser“ (Organisation, Transport, Zugriff) oder „Sicherheitsleseberechtigter“ (Schutz-Richtlinien). Beides sind reine Leserechte.

```powershell
Install-Module Microsoft.Graph.Authentication, Microsoft.Graph.Applications, Microsoft.Graph.Identity.Governance
Connect-MgGraph -Scopes 'Application.Read.All', 'AppRoleAssignment.ReadWrite.All', 'RoleManagement.ReadWrite.Directory'

$tcm = Get-MgServicePrincipal -Filter "AppId eq '03b07b79-c5bc-4b5e-9bfa-13acf4a99998'"
$exo = Get-MgServicePrincipal -Filter "AppId eq '00000002-0000-0ff1-ce00-000000000000'"

# Anwendungsberechtigung Exchange.ManageAsApp
$role = $exo.AppRoles | Where-Object { $_.Value -eq 'Exchange.ManageAsApp' }
New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $tcm.Id -BodyParameter @{
    AppRoleId = $role.Id; ResourceId = $exo.Id; PrincipalId = $tcm.Id
}

# Entra-Rollen zum Lesen
foreach ($name in 'Global Reader', 'Security Reader') {
    $definition = Get-MgRoleManagementDirectoryRoleDefinition -Filter "DisplayName eq '$name'"
    New-MgRoleManagementDirectoryRoleAssignment -BodyParameter @{
        PrincipalId = $tcm.Id; RoleDefinitionId = $definition.Id; DirectoryScopeId = '/'
    }
}
```

Die Rolle „Globaler Leser“ ist weitreichend (Lesen im ganzen Tenant). Wer sie dem Dienstprinzipal nicht geben möchte, lässt sie weg und beschränkt sich auf die Schutz-Richtlinien, für die „Sicherheitsleseberechtigter“ genügt.

**2. Typen in `COLLECTOR_RESOURCES` ergänzen** (kommagetrennt, hinter den vorhandenen Einträgen), danach die Werkbank neu starten:

| Gruppe | Ressourcentypen |
|---|---|
| Organisation und Transport | `microsoft.exchange.organizationconfig`, `microsoft.exchange.transportconfig`, `microsoft.exchange.transportrule`, `microsoft.exchange.accepteddomain`, `microsoft.exchange.remotedomain`, `microsoft.exchange.inboundconnector`, `microsoft.exchange.outboundconnector`, `microsoft.exchange.dkimsigningconfig` |
| Schutz | `microsoft.exchange.antiphishpolicy`, `microsoft.exchange.hostedcontentfilterpolicy`, `microsoft.exchange.hostedoutboundspamfilterpolicy`, `microsoft.exchange.malwarefilterpolicy`, `microsoft.exchange.safeattachmentpolicy`, `microsoft.exchange.safelinkspolicy`, `microsoft.exchange.quarantinepolicy`, `microsoft.exchange.atppolicyforo365` |
| Zugriff und Freigabe | `microsoft.exchange.owamailboxpolicy`, `microsoft.exchange.mobiledevicemailboxpolicy`, `microsoft.exchange.sharingpolicy`, `microsoft.exchange.authenticationpolicy` |

Hinweise:

- **Schrittweise vorgehen:** erst wenige Typen eintragen, einen Abruf abwarten und in der Übersicht prüfen, wie viele Objekte gelesen wurden. Jedes Objekt zählt gegen das Monatskontingent (4.4).
- **Nicht eintragen:** Typen je Postfach oder Gruppe (z. B. `mailboxsettings`, `mailboxpermission`, `sharedmailbox`, `distributiongroup`). Das sind keine Tenant-Einstellungen, sie enthalten Personendaten und verbrauchen das Kontingent.
- **„Geändert von“** bleibt bei Exchange leer: Wer etwas geändert hat, steht nicht im Entra-Audit-Log.
- **Personenbezug:** Regeln und Richtlinien können Adressen und Namen enthalten (z. B. Bedingungen einer Transportregel). Sie stehen dann als Wert in der Werkbank (`docs/datenschutz.md`).
- Der erste erfolgreiche Abruf eines neuen Typs ist dessen Ausgangsstand: Die Einstellungen erscheinen, ohne dass Änderungen gemeldet werden. Änderungen erkennt die Werkbank ab dem zweiten Abruf.

### 4.4 Grenzen von UTCM

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
- `settings_key`

## Checkliste

- [ ] App-Registrierung „Werkbank“ angelegt (1.1)
- [ ] Authentifizierung eingestellt (1.2)
- [ ] Zertifikat hochgeladen oder Secret erstellt (1.3)
- [ ] Optionale Ansprüche `email`, `preferred_username`, `auth_time` (1.4)
- [ ] Delegierte Berechtigungen und Administratorzustimmung (1.5)
- [ ] App-Rollen angelegt (1.6)
- [ ] „Zuweisung erforderlich“ = Ja (1.7)
- [ ] Gruppen angelegt und Rollen zugewiesen (1.8)
- [ ] CA-Richtlinie `CA-Werkbank-MFA` im Modus „Nur Bericht“ (2)
- [ ] App-Registrierung „Werkbank Collector“ mit Zertifikat, Berechtigungen und Administratorzustimmung (4.1)
- [ ] Dienstprinzipale von UTCM angelegt, Leserechte vergeben (4.2)
- [ ] Werte in den Umgebungsvariablen und Dateien im Secrets-Ordner auf dem Server (5)
