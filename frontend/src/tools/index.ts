import { lazy, type ComponentType } from "react";

/**
 * IT-Tools: kleine Werkzeuge, die vollständig im Browser rechnen.
 * Ein neues Tool bekommt einen Ordner (Logik mit Tests, Oberfläche) und einen Eintrag hier.
 * Die Oberfläche wird erst beim Öffnen des Tools geladen.
 */

export type ToolCategory =
  "netzwerk" | "system" | "encoding" | "formatter" | "identitaet" | "konverter" | "text" | "rechner" | "generator";

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  netzwerk: "Netzwerk",
  system: "Linux und Server",
  identitaet: "AD und M365",
  encoding: "Encoding",
  formatter: "Formatter",
  konverter: "Konverter",
  text: "Text",
  rechner: "Rechner",
  generator: "Generatoren",
};

export interface ToolDefinition {
  /** Eindeutig, stabil, Teil der Adresse: /it-tools/<id> */
  id: string;
  name: string;
  category: ToolCategory;
  description: string;
  /** Zusätzliche Suchbegriffe. */
  tags: string[];
  /** Oberfläche des Tools; wird erst beim Öffnen geladen. */
  component: ComponentType;
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    id: "subnetz",
    name: "Subnetz-Rechner",
    category: "netzwerk",
    description:
      "IPv4- und IPv6-Netze berechnen: CIDR, Maske, Wildcard oder Bereich eingeben, Netz aufteilen, Adressen prüfen.",
    tags: ["cidr", "subnet", "ipv4", "ipv6", "netzmaske", "wildcard", "broadcast", "präfix"],
    component: lazy(() => import("./cidr/CidrTool")),
  },
  {
    id: "subnetting-bits",
    name: "Subnetting-Bits",
    category: "netzwerk",
    description:
      "Wie viele Bits muss ich für eine Anzahl Subnetze oder Hosts borgen? Zeigt neue Maske, Schrittweite, Bit-Aufteilung und die entstehenden Subnetze.",
    tags: [
      "subnetz",
      "borgen",
      "hostbits",
      "netzbits",
      "subnetzmaske",
      "präfix",
      "ipv4",
      "aufteilen",
    ],
    component: lazy(() => import("./subnet-bits/SubnetBitsTool")),
  },
  {
    id: "netze-zusammenfassen",
    name: "Netze zusammenfassen",
    category: "netzwerk",
    description:
      "Liste von Netzen, Adressen und Bereichen zur kleinsten CIDR-Liste zusammenfassen, für Firewall-Regeln, Routen und Allowlists.",
    tags: ["supernet", "supernetting", "aggregieren", "cidr", "route", "summary", "allowlist"],
    component: lazy(() => import("./supernet/SupernetTool")),
  },
  {
    id: "firewall-regeln",
    name: "Firewall-Regeln prüfen",
    category: "netzwerk",
    description:
      "Regelwerk eingeben und ein Testpaket hindurchschicken: Welche Regel greift zuerst? Findet außerdem Regeln, die nie erreicht werden.",
    tags: [
      "regelwerk",
      "acl",
      "paketfilter",
      "first match",
      "allow",
      "deny",
      "testpaket",
      "iptables",
    ],
    component: lazy(() => import("./firewall-rules/FirewallRulesTool")),
  },
  {
    id: "mac-adressen",
    name: "MAC-Adressen",
    category: "netzwerk",
    description:
      "MAC-Adressen umformatieren (Windows, Linux, Cisco), Hersteller nachschlagen, Multicast und lokale Adressen erkennen, EUI-64 und IPv6-Link-Local.",
    tags: ["mac", "oui", "hersteller", "vendor", "cisco", "eui-64", "link-local", "arp"],
    component: lazy(() => import("./mac/MacTool")),
  },
  {
    id: "ports",
    name: "Port-Nachschlagewerk",
    category: "netzwerk",
    description:
      "Welcher Dienst nutzt welchen Port? Über 150 gebräuchliche Ports mit Protokoll und Hinweisen, dazu Firewall-Befehle.",
    tags: ["port", "tcp", "udp", "firewall", "dienst", "service", "rdp", "smb", "ldap", "kerberos"],
    component: lazy(() => import("./ports/PortsTool")),
  },
  {
    id: "chmod",
    name: "chmod-Rechner",
    category: "system",
    description:
      "Linux-Dateirechte umrechnen: oktal (755), rwxr-xr-x und u=rwx,g=rx,o=rx, mit SetUID, SetGID, Sticky und umask.",
    tags: ["linux", "unix", "rechte", "permissions", "755", "644", "rwx", "umask"],
    component: lazy(() => import("./chmod/ChmodTool")),
  },
  {
    id: "cron",
    name: "Cron-Ausdruck erklären",
    category: "system",
    description:
      "Cron-Ausdrücke in Klartext übersetzen und die nächsten Ausführungen anzeigen, auch @daily und 6 Felder mit Sekunden.",
    tags: ["crontab", "zeitplan", "schedule", "linux", "systemd", "kubernetes", "cronjob"],
    component: lazy(() => import("./cron/CronTool")),
  },
  {
    id: "ad-zeitstempel",
    name: "AD-Zeitstempel",
    category: "identitaet",
    description:
      "lastLogonTimestamp, pwdLastSet, accountExpires und ähnliche Werte (FILETIME) sowie whenCreated in lesbare Daten umrechnen, und zurück.",
    tags: ["active directory", "filetime", "lastlogontimestamp", "pwdlastset", "accountexpires", "whencreated", "ldap"],
    component: lazy(() => import("./ad-time/AdTimeTool")),
  },
  {
    id: "dn",
    name: "DN-Zerleger",
    category: "identitaet",
    description:
      "Distinguished Names zerlegen (auch mit maskierten Zeichen), canonicalName und Domain ableiten und canonicalName in einen DN umwandeln.",
    tags: ["distinguished name", "ldap", "canonicalname", "ou", "cn", "dc", "active directory", "pfad"],
    component: lazy(() => import("./dn/DnTool")),
  },
  {
    id: "immutableid",
    name: "ImmutableID ↔ objectGUID",
    category: "identitaet",
    description:
      "objectGUID, ImmutableID (Base64), Hex-Bytes und die Form für LDAP-Filter ineinander umrechnen.",
    tags: ["guid", "objectguid", "sourceanchor", "consistencyguid", "entra", "m365", "ldap"],
    component: lazy(() => import("./guid-convert/GuidConvertTool")),
  },
  {
    id: "ldap-escaper",
    name: "LDAP-Escaper",
    category: "identitaet",
    description:
      "Werte für LDAP-Filter (RFC 4515) und Distinguished Names (RFC 4514) korrekt maskieren, und zurück.",
    tags: ["escape", "maskieren", "filter", "dn", "rfc 4515", "rfc 4514", "active directory", "sonderzeichen"],
    component: lazy(() => import("./ldap/LdapEscapeTool")),
  },
  {
    id: "useraccountcontrol",
    name: "userAccountControl",
    category: "identitaet",
    description:
      "Werte von userAccountControl in Flags zerlegen und zusammenbauen, mit Sicherheitshinweisen und passenden LDAP-Filtern.",
    tags: ["active directory", "uac", "flags", "deaktiviert", "disabled", "ldap", "514", "512", "66048"],
    component: lazy(() => import("./uac/UacTool")),
  },
  {
    id: "base64",
    name: "Base64",
    category: "encoding",
    description:
      "Text in Base64 kodieren oder Base64 zurück in Text wandeln (UTF-8, auch URL-safe).",
    tags: ["encode", "decode", "kodieren", "dekodieren"],
    component: lazy(() => import("./base64/Base64Tool")),
  },
  {
    id: "url-encoder",
    name: "URL-Encoder",
    category: "encoding",
    description:
      "Text für URLs kodieren (%20) und dekodieren, URLs in Bestandteile und Parameter zerlegen.",
    tags: ["url", "encode", "decode", "percent", "%20", "query", "parameter", "uri", "urlencode"],
    component: lazy(() => import("./url-encode/UrlEncodeTool")),
  },
  {
    id: "html-entities",
    name: "HTML-Entities",
    category: "encoding",
    description: "Sonderzeichen in HTML-Entities umwandeln (&lt; &auml; &#8364;) und zurück.",
    tags: ["html", "entity", "escape", "&amp;", "&lt;", "umlaute", "sonderzeichen"],
    component: lazy(() => import("./html-entities/HtmlEntitiesTool")),
  },
  {
    id: "jwt",
    name: "JWT-Decoder",
    category: "encoding",
    description:
      "JSON Web Tokens lesen: Header, Claims mit Erklärung, Ablaufzeiten. Dazu die Signatur mit Secret, PEM-Schlüssel oder JWKS prüfen.",
    tags: [
      "token",
      "bearer",
      "oauth",
      "oidc",
      "entra",
      "id token",
      "access token",
      "claims",
      "jwks",
    ],
    component: lazy(() => import("./jwt/JwtTool")),
  },
  {
    id: "saml",
    name: "SAML-Decoder",
    category: "encoding",
    description:
      "SAMLRequest und SAMLResponse dekodieren (Base64, Deflate, ganze URL), mit NameID, Attributen, Gültigkeit, Signatur und Zertifikat.",
    tags: ["samlresponse", "samlrequest", "sso", "adfs", "entra", "assertion", "idp", "deflate"],
    component: lazy(() => import("./saml/SamlTool")),
  },
  {
    id: "json-formatter",
    name: "JSON-Formatter",
    category: "formatter",
    description: "JSON prüfen, lesbar formatieren oder minifizieren.",
    tags: ["json", "format", "validieren", "minify", "einrücken"],
    component: lazy(() => import("./json-format/JsonFormatTool")),
  },
  {
    id: "yaml-formatter",
    name: "YAML-Formatter",
    category: "formatter",
    description:
      "YAML prüfen (mit Zeilenangabe bei Fehlern) und einheitlich formatieren, zum Beispiel docker-compose, Kubernetes, Ansible.",
    tags: [
      "yaml",
      "yml",
      "validieren",
      "prüfen",
      "docker compose",
      "kubernetes",
      "ansible",
      "lint",
    ],
    component: lazy(() => import("./yaml-format/YamlFormatTool")),
  },
  {
    id: "xml-formatter",
    name: "XML-Formatter",
    category: "formatter",
    description: "XML prüfen, einrücken oder minimieren, mit Fehlermeldung samt Zeile.",
    tags: ["xml", "pretty print", "minify", "validieren", "einrücken", "gpo", "unattend"],
    component: lazy(() => import("./xml-format/XmlFormatTool")),
  },
  {
    id: "sql",
    name: "SQL: Formatter und JOINs",
    category: "formatter",
    description:
      "SQL-Abfragen lesbar einrücken oder auf eine Zeile kürzen. Dazu JOINs an zwei Beispieltabellen ausprobieren, mit Ergebnis, NULL-Werten und Mengendiagramm.",
    tags: [
      "query",
      "abfrage",
      "t-sql",
      "mysql",
      "postgresql",
      "minify",
      "inner join",
      "left join",
      "full outer join",
      "anti join",
      "datenbank",
    ],
    component: lazy(() => import("./sql-format/SqlTool")),
  },
  {
    id: "csv-json",
    name: "CSV ↔ JSON",
    category: "konverter",
    description:
      "CSV (auch aus Excel mit Semikolon) in JSON umwandeln und zurück. Das Trennzeichen wird erkannt, verschachtelte Objekte werden aufgelöst.",
    tags: ["excel", "tabelle", "umwandeln", "semikolon", "export", "import"],
    component: lazy(() => import("./csv-json/CsvJsonTool")),
  },
  {
    id: "json-yaml-toml",
    name: "JSON ↔ YAML ↔ TOML",
    category: "konverter",
    description:
      "Daten zwischen JSON, YAML und TOML umwandeln, zum Beispiel für Konfigurationsdateien.",
    tags: ["umwandeln", "konvertieren", "convert", "konfiguration", "config"],
    component: lazy(() => import("./data-convert/DataConvertTool")),
  },
  {
    id: "zahlensysteme",
    name: "Zahlensysteme",
    category: "konverter",
    description:
      "Zahlen zwischen Dezimal, Hex, Binär und Oktal umrechnen, beliebig groß, mit Zweierkomplement für 8, 16, 32 und 64 Bit und Bytes.",
    tags: ["hex", "binär", "dezimal", "oktal", "umrechnen", "zweierkomplement", "bits", "base"],
    component: lazy(() => import("./number-base/NumberBaseTool")),
  },
  {
    id: "unix-zeit",
    name: "Unix-Zeitstempel",
    category: "konverter",
    description:
      "Unix-Zeitstempel (Sekunden bis Nanosekunden, automatisch erkannt) in ein Datum umrechnen und zurück, mit ISO 8601, Kalenderwoche und Excel-Wert.",
    tags: ["timestamp", "epoch", "datum", "iso 8601", "millisekunden", "kalenderwoche", "excel"],
    component: lazy(() => import("./unix-time/UnixTimeTool")),
  },
  {
    id: "zeitzonen",
    name: "Zeitzonen-Umrechner",
    category: "konverter",
    description:
      "Uhrzeit in mehrere Zeitzonen umrechnen, mit Sommerzeit, zum Beispiel für Wartungsfenster und Termine mit Standorten weltweit.",
    tags: ["zeitzone", "timezone", "utc", "sommerzeit", "dst", "uhrzeit", "wartungsfenster", "gmt"],
    component: lazy(() => import("./timezone/TimezoneTool")),
  },
  {
    id: "schreibweise",
    name: "Schreibweise ändern",
    category: "text",
    description:
      "Text in GROSS, klein, Jedes Wort Groß, camelCase, snake_case, kebab-case und weitere umwandeln, alle Varianten auf einen Blick.",
    tags: ["case", "groß", "klein", "uppercase", "lowercase", "camelcase", "pascalcase"],
    component: lazy(() => import("./case/CaseTool")),
  },
  {
    id: "listen",
    name: "Listen bereinigen",
    category: "text",
    description:
      "Listen sortieren, Duplikate entfernen und als Komma-Liste, PowerShell-Array, SQL IN (…) oder JSON ausgeben. Dazu zwei Listen vergleichen.",
    tags: ["liste", "duplikate", "sortieren", "powershell", "array", "vergleichen", "unique"],
    component: lazy(() => import("./list-clean/ListCleanTool")),
  },
  {
    id: "regex",
    name: "Regex-Tester",
    category: "text",
    description:
      "Reguläre Ausdrücke live testen: Treffer markieren, Gruppen anzeigen, Ersetzen ausprobieren (JavaScript-Syntax).",
    tags: ["regulärer ausdruck", "regexp", "pattern", "match", "replace", "gruppen"],
    component: lazy(() => import("./regex/RegexTool")),
  },
  {
    id: "zeichen-zaehlen",
    name: "Zeichen zählen",
    category: "text",
    description:
      "Zeichen, Wörter, Zeilen und Bytes zählen. Findet und entfernt unsichtbare Zeichen (geschützte Leerzeichen, Zero-Width, BOM).",
    tags: ["wörter", "länge", "bytes", "unsichtbar", "zero width", "nbsp", "bom", "count"],
    component: lazy(() => import("./text-stats/TextStatsTool")),
  },
  {
    id: "text-diff",
    name: "Text-Diff",
    category: "text",
    description:
      "Zwei Texte oder Konfigurationen vergleichen, nebeneinander oder als Unified-Diff, mit hervorgehobenen Wortänderungen.",
    tags: ["diff", "vergleich", "unterschied", "compare", "konfiguration", "patch", "unified"],
    component: lazy(() => import("./diff/DiffTool")),
  },
  {
    id: "raid",
    name: "RAID-Rechner",
    category: "rechner",
    description:
      "Kapazität, Plattenbedarf und Ausfall-Simulation für RAID 0, 1, 5, 6, 10, 50, 60 und ZFS RAIDZ, mit Schreib-Penalty und Rebuild-Zeit.",
    tags: [
      "raid5",
      "raid6",
      "raid10",
      "zfs",
      "raidz",
      "festplatten",
      "nas",
      "san",
      "storage",
      "parität",
      "degraded",
      "redundanz",
    ],
    component: lazy(() => import("./raid/RaidTool")),
  },
  {
    id: "speichereinheiten",
    name: "Speichereinheiten (GB ↔ GiB)",
    category: "rechner",
    description:
      "Zwischen GB und GiB, TB und TiB, Byte und Bit umrechnen. Erklärt, warum eine 4-TB-Platte in Windows nur 3,63 „TB“ hat.",
    tags: [
      "gb",
      "gib",
      "tb",
      "tib",
      "mb",
      "byte",
      "bit",
      "speicher",
      "umrechnen",
      "festplatte",
      "binär",
      "dezimal",
    ],
    component: lazy(() => import("./data-units/DataUnitsTool")),
  },
  {
    id: "speicherbedarf",
    name: "Speicherbedarf mit Komprimierung",
    category: "rechner",
    description:
      "Wie viel Speicher brauche ich wirklich? Rohdaten, Komprimierung, Deduplizierung, jährliches Wachstum und Reserve, mit Verlauf über mehrere Jahre.",
    tags: [
      "speicher",
      "kompression",
      "dedup",
      "wachstum",
      "storage",
      "kapazität",
      "planung",
      "backup",
      "reserve",
    ],
    component: lazy(() => import("./storage-need/StorageNeedTool")),
  },
  {
    id: "uebertragungsdauer",
    name: "Übertragungsdauer",
    category: "rechner",
    description:
      "Wie lange dauert der Upload, das Backup oder die Migration? Aus Datenmenge und Bandbreite die Dauer, oder umgekehrt die nötige Bandbreite für ein Zeitfenster.",
    tags: [
      "übertragung",
      "dauer",
      "bandbreite",
      "upload",
      "download",
      "backup",
      "migration",
      "mbit",
      "transfer",
      "leitung",
    ],
    component: lazy(() => import("./transfer/TransferTool")),
  },
  {
    id: "verfuegbarkeit",
    name: "Verfügbarkeit",
    category: "rechner",
    description:
      "Verfügbarkeit in Prozent und erlaubte Ausfallzeit, Berechnung aus MTBF und MTTR sowie Gesamtverfügbarkeit einer Kette mit redundanten Komponenten.",
    tags: [
      "sla",
      "ausfallzeit",
      "downtime",
      "uptime",
      "mtbf",
      "mttr",
      "hochverfügbarkeit",
      "99,9",
      "neunen",
      "redundanz",
    ],
    component: lazy(() => import("./availability/AvailabilityTool")),
  },
  {
    id: "stromkosten",
    name: "Stromkosten",
    category: "rechner",
    description:
      "Stromverbrauch und Kosten von Servern, Switches oder PCs pro Tag, Monat und Jahr, mit Aufschlag für Kühlung (PUE), CO₂ und Vergleich zweier Geräte.",
    tags: [
      "strom",
      "verbrauch",
      "watt",
      "kwh",
      "energie",
      "kosten",
      "server",
      "pue",
      "co2",
      "betriebskosten",
    ],
    component: lazy(() => import("./power-cost/PowerCostTool")),
  },
  {
    id: "usv",
    name: "USV: Leistung und Laufzeit",
    category: "rechner",
    description:
      "USV auslegen: Scheinleistung (VA) aus Watt und Leistungsfaktor, empfohlene Größe mit Reserve und Überbrückungszeit aus den Batteriedaten.",
    tags: [
      "ups",
      "va",
      "watt",
      "scheinleistung",
      "leistungsfaktor",
      "cos phi",
      "batterie",
      "laufzeit",
      "akku",
    ],
    component: lazy(() => import("./ups/UpsTool")),
  },
  {
    id: "voip",
    name: "VoIP-Bandbreite",
    category: "rechner",
    description:
      "Bandbreite für Telefonie berechnen: Codec, Paketintervall und Header (RTP, UDP, IP, Ethernet), je Gespräch und für alle gleichzeitigen Gespräche.",
    tags: [
      "sip",
      "rtp",
      "codec",
      "g.711",
      "g.729",
      "opus",
      "telefonie",
      "gespräche",
      "sip-trunk",
      "qos",
    ],
    component: lazy(() => import("./voip/VoipTool")),
  },
  {
    id: "uuid",
    name: "UUID-Generator",
    category: "generator",
    description: "Erzeugt zufällige UUIDs (Version 4).",
    tags: ["guid", "zufall"],
    component: lazy(() => import("./uuid/UuidTool")),
  },
  {
    id: "passwort",
    name: "Passwort-Generator",
    category: "generator",
    description:
      "Sichere Kennwörter mit wählbaren Zeichengruppen erzeugen. Alles geschieht im Browser, nichts wird übertragen.",
    tags: ["kennwort", "password", "zufall", "sicher"],
    component: lazy(() => import("./password/PasswordTool")),
  },
  {
    id: "passphrase",
    name: "Passphrase-Generator",
    category: "generator",
    description:
      "Merkbare Passphrasen aus einer deutschen Wortliste (7776 Wörter, Diceware-Prinzip), sicher und leicht zu tippen.",
    tags: ["passwort", "kennwort", "diceware", "wörter", "merkbar"],
    component: lazy(() => import("./passphrase/PassphraseTool")),
  },
  {
    id: "passwort-hash",
    name: "Passwort-Hash (htpasswd/shadow)",
    category: "generator",
    description:
      "Passwort-Hashes für .htpasswd, /etc/shadow, Ansible und cloud-init erzeugen (bcrypt, $6$, $5$, $apr1$) und vorhandene Hashes prüfen.",
    tags: ["htpasswd", "bcrypt", "shadow", "crypt", "sha512", "apr1", "nginx", "apache", "basic auth", "ansible", "mkpasswd"],
    component: lazy(() => import("./htpasswd/HtpasswdTool")),
  },
  {
    id: "hash",
    name: "Prüfsummen (Hash)",
    category: "generator",
    description:
      "MD5, SHA-1, SHA-256, SHA-384, SHA-512 und CRC32 für Text oder Dateien berechnen und mit einem erwarteten Wert vergleichen.",
    tags: ["prüfsumme", "checksum", "md5", "sha1", "sha256", "sha512", "crc32", "datei", "integrität"],
    component: lazy(() => import("./hash/HashTool")),
  },
  {
    id: "hmac",
    name: "HMAC",
    category: "generator",
    description:
      "HMAC-SHA1, -256, -384 und -512 berechnen, zum Beispiel um Signaturen von Webhooks zu prüfen.",
    tags: ["signatur", "webhook", "sha256", "mac", "secret", "prüfen"],
    component: lazy(() => import("./hmac/HmacTool")),
  },
  {
    id: "lorem-ipsum",
    name: "Lorem ipsum",
    category: "generator",
    description: "Blindtext in Absätzen, Sätzen oder Wörtern erzeugen, für Vorlagen, Mockups und Tests.",
    tags: ["blindtext", "platzhalter", "dummy", "fülltext"],
    component: lazy(() => import("./lorem/LoremTool")),
  },
];

export function findTool(id: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.id === id);
}

/** Sucht in Name, Beschreibung und Suchbegriffen; alle Wörter müssen vorkommen. */
export function searchTools(query: string): ToolDefinition[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [...TOOLS];
  }
  return TOOLS.filter((tool) => {
    const text = [tool.name, tool.description, CATEGORY_LABELS[tool.category], ...tool.tags]
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export const FAVORITES_KEY = "werkbank-it-tools-favoriten";

export function readFavorites(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string" && findTool(id) !== undefined)
      : [];
  } catch {
    return [];
  }
}

export function saveFavorites(ids: string[]): void {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    // Speicher gesperrt: Favoriten gelten dann nur bis zum Neuladen.
  }
}
