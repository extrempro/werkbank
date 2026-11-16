# Benachrichtigungen in Teams: Workflow einrichten

Die Werkbank kann Benachrichtigungen in den persönlichen Teams-Chat jeder Person schicken. Dafür schickt sie eine Nachricht an einen Workflow in Power Automate. Der Workflow stellt sie als Flow-Bot zu. Die Werkbank braucht dafür keine zusätzliche Berechtigung in Entra.

Was verschickt wird: Gesammelt höchstens alle 15 Minuten je Person eine Karte mit der Zahl der neuen Benachrichtigungen je Bereich und einem Link in die Werkbank. Die Karte enthält keine fachlichen Inhalte. Welche Arten jemand in Teams bekommt, stellt jede Person im Konto ein; anfangs ist Teams für alle aus.

## 1. Workflow anlegen

1. In Power Automate (oder in Teams unter „Workflows“) einen neuen Cloud-Flow ohne Vorlage anlegen.
2. Als Trigger **„Wenn eine Teams-Webhookanforderung empfangen wird“** wählen. Unter „Wer kann den Flow auslösen?“ **„Jeder“** einstellen. Die Adresse des Triggers enthält eine Signatur und ist damit selbst das Geheimnis.
3. Als Aktion **„Karte in einem Chat oder Kanal posten“** (Microsoft Teams) hinzufügen:
   - **Posten als:** Flow-Bot
   - **Posten in:** Chat mit Flow-Bot
   - **Empfänger:** Ausdruck `triggerBody()?['recipient']`
   - **Adaptive Karte:** Ausdruck `triggerBody()?['attachments'][0]['content']`
4. Speichern. Danach steht im Trigger die **HTTP-POST-URL**. Sie beginnt mit `https://` und endet auf `…logic.azure.com/…` oder `…api.powerplatform.com/…`.

Empfehlung: Den Flow mit einem Dienstkonto der IT anlegen und mit einer Gruppe teilen, damit er beim Ausscheiden einer Person weiterläuft.

## 2. In der Werkbank eintragen

1. Verwaltung › Einstellungen › Allgemein › **Benachrichtigungen in Teams**.
2. Die HTTP-POST-URL eintragen, „Benachrichtigungen in Teams einschalten“ anhaken und speichern. Die Adresse liegt verschlüsselt in der Datenbank (Schlüsseldatei `settings_key` nötig) und wird nie wieder angezeigt.
3. „Testnachricht an mich senden“ schickt eine Karte an deine eigene Mailadresse. Sie sollte nach wenigen Sekunden im Chat mit dem Flow-Bot erscheinen.

Die Werkbank schickt nur an Adressen von Power Automate bzw. Logic Apps (https, Port 443) und folgt keinen Weiterleitungen.

## Was der Workflow bekommt

```json
{
  "type": "message",
  "recipient": "erika@example.com",
  "summary": "Werkbank: 2 neue Benachrichtigungen",
  "attachments": [
    {
      "contentType": "application/vnd.microsoft.card.adaptive",
      "content": {
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": [
          { "type": "TextBlock", "text": "Werkbank", "weight": "Bolder" },
          { "type": "TextBlock", "text": "Hallo Erika Beispiel, in Werkbank gibt es 2 neue Benachrichtigungen für dich.", "wrap": true },
          { "type": "FactSet", "facts": [{ "title": "IT-Budget", "value": "2" }] }
        ],
        "actions": [
          { "type": "Action.OpenUrl", "title": "Benachrichtigungen ansehen", "url": "https://werkbank.example.com/benachrichtigungen" }
        ]
      }
    }
  ]
}
```

Name der Werkbank aus dem Branding, Anrede mit „du“.

## Fehler

- Antwortet der Workflow mit einem Fehler oder ist nicht erreichbar, versucht die Werkbank es beim nächsten Lauf erneut. Benachrichtigungen, die älter als 24 Stunden sind, werden nicht mehr verschickt.
- Personen ohne Mailadresse in Entra bekommen weder Mail noch Teams.
- Den Verlauf der Läufe zeigt Power Automate unter „Ausführungsverlauf“.
