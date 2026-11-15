/** Nachschlagewerk für gebräuchliche Ports – mit Fokus auf Windows/AD, M365 und Server-Betrieb */

export type Proto = "TCP" | "UDP" | "TCP/UDP";
export type PortGroup =
  | "Windows & AD"
  | "Web & Proxy"
  | "Mail"
  | "Fernzugriff"
  | "Datei & Speicher"
  | "Datenbank"
  | "Netzwerkdienste"
  | "Monitoring & Logging"
  | "VoIP & Video"
  | "Virtualisierung & Container"
  | "Sonstiges";

export interface PortEntry {
  /** einzelner Port oder Bereich „49152-65535“ */
  port: string;
  proto: Proto;
  name: string;
  desc: string;
  group: PortGroup;
  /** Hinweis, z. B. unverschlüsselt oder nicht ins Internet öffnen */
  warn?: string;
}

const P = (
  port: string | number,
  proto: Proto,
  name: string,
  desc: string,
  group: PortGroup,
  warn?: string,
): PortEntry => ({ port: String(port), proto, name, desc, group, warn });
const PLAIN = "unverschlüsselt";
const NO_INET = "nicht ins Internet öffnen";

export const ports: PortEntry[] = [
  // Windows & AD
  P(
    53,
    "TCP/UDP",
    "DNS",
    "Namensauflösung; Domänencontroller sind meist auch DNS-Server",
    "Netzwerkdienste",
  ),
  P(88, "TCP/UDP", "Kerberos", "Anmeldung in der Domäne (Tickets)", "Windows & AD"),
  P(
    123,
    "UDP",
    "NTP / W32Time",
    "Zeitsynchronisierung – Kerberos verträgt max. 5 Minuten Abweichung",
    "Netzwerkdienste",
  ),
  P(
    135,
    "TCP",
    "RPC Endpoint Mapper",
    "vermittelt dynamische RPC-Ports (AD-Replikation, WMI, DCOM, MMC)",
    "Windows & AD",
    NO_INET,
  ),
  P(137, "UDP", "NetBIOS Name Service", "alte Namensauflösung", "Windows & AD", NO_INET),
  P(138, "UDP", "NetBIOS Datagram", "Computersuche (Browser-Dienst)", "Windows & AD", NO_INET),
  P(139, "TCP", "NetBIOS Session", "SMB über NetBIOS (alt)", "Windows & AD", NO_INET),
  P(
    389,
    "TCP/UDP",
    "LDAP",
    "Verzeichnisabfragen; UDP für DC-Suche (CLDAP)",
    "Windows & AD",
    "ohne Signing/Channel Binding angreifbar",
  ),
  P(
    445,
    "TCP",
    "SMB",
    "Dateifreigaben, Gruppenrichtlinien (SYSVOL), Named Pipes",
    "Datei & Speicher",
    NO_INET,
  ),
  P(464, "TCP/UDP", "Kerberos kpasswd", "Kennwortänderung", "Windows & AD"),
  P(636, "TCP", "LDAPS", "LDAP über TLS", "Windows & AD"),
  P(3268, "TCP", "Global Catalog", "gesamtstrukturweite LDAP-Suche", "Windows & AD"),
  P(3269, "TCP", "Global Catalog SSL", "Global Catalog über TLS", "Windows & AD"),
  P(
    9389,
    "TCP",
    "AD Web Services",
    "ActiveDirectory-PowerShell-Modul, AD-Verwaltungscenter",
    "Windows & AD",
  ),
  P(
    "49152-65535",
    "TCP",
    "RPC dynamisch",
    "dynamische RPC-Ports seit Windows Server 2008 (AD-Replikation, DFSR, WMI …)",
    "Windows & AD",
    NO_INET,
  ),
  P(
    5985,
    "TCP",
    "WinRM HTTP",
    "PowerShell Remoting, Windows Admin Center – Inhalt trotzdem verschlüsselt (Kerberos)",
    "Fernzugriff",
  ),
  P(5986, "TCP", "WinRM HTTPS", "PowerShell Remoting über TLS", "Fernzugriff"),
  P(5722, "TCP", "DFSR (alt)", "SYSVOL-Replikation unter Server 2008", "Windows & AD"),
  P(67, "UDP", "DHCP Server", "Adressvergabe (Client sendet von 68 an 67)", "Netzwerkdienste"),
  P(68, "UDP", "DHCP Client", "Antwort des DHCP-Servers", "Netzwerkdienste"),
  P(
    69,
    "UDP",
    "TFTP",
    "PXE-Boot, Firmware-Updates von Switches/Telefonen",
    "Netzwerkdienste",
    PLAIN,
  ),
  P(4011, "UDP", "PXE / WDS", "Proxy-DHCP für Netzwerkboot", "Netzwerkdienste"),
  P(1688, "TCP", "KMS", "Windows-/Office-Aktivierung (Key Management Service)", "Windows & AD"),
  P(8530, "TCP", "WSUS HTTP", "Windows Server Update Services", "Windows & AD"),
  P(8531, "TCP", "WSUS HTTPS", "Windows Server Update Services über TLS", "Windows & AD"),
  P(1801, "TCP", "MSMQ", "Microsoft Message Queuing", "Windows & AD", NO_INET),
  P(
    5355,
    "UDP",
    "LLMNR",
    "Namensauflösung im lokalen Netz – gern für Angriffe (Responder) missbraucht, besser abschalten",
    "Netzwerkdienste",
  ),
  P(
    5353,
    "UDP",
    "mDNS / Bonjour",
    "Namensauflösung und Gerätesuche im lokalen Netz (Drucker, AirPlay)",
    "Netzwerkdienste",
  ),
  P(1900, "UDP", "SSDP / UPnP", "Gerätesuche", "Netzwerkdienste", NO_INET),
  P(3702, "UDP", "WS-Discovery", "Geräte- und Druckersuche unter Windows", "Netzwerkdienste"),
  // Web
  P(
    80,
    "TCP",
    "HTTP",
    "Web unverschlüsselt, ACME-HTTP-01-Prüfung (Let's Encrypt), Weiterleitung auf HTTPS",
    "Web & Proxy",
    PLAIN,
  ),
  P(443, "TCP", "HTTPS", "Web über TLS, auch M365, Teams, Intune, VPN (SSL-VPN)", "Web & Proxy"),
  P(443, "UDP", "HTTP/3 (QUIC)", "HTTPS über QUIC", "Web & Proxy"),
  P(8080, "TCP", "HTTP alternativ", "Proxy, Tomcat, Admin-Oberflächen", "Web & Proxy"),
  P(8443, "TCP", "HTTPS alternativ", "Admin-Oberflächen (UniFi, Plesk …)", "Web & Proxy"),
  P(3128, "TCP", "Squid-Proxy", "Web-Proxy", "Web & Proxy"),
  P(1080, "TCP", "SOCKS", "SOCKS-Proxy", "Web & Proxy"),
  P(8000, "TCP", "HTTP Entwicklung", "Entwicklungsserver, Splunk Web", "Web & Proxy"),
  // Mail
  P(25, "TCP", "SMTP", "Mailtransport zwischen Servern (STARTTLS)", "Mail"),
  P(587, "TCP", "SMTP Submission", "Mailversand von Clients mit Anmeldung (STARTTLS)", "Mail"),
  P(465, "TCP", "SMTPS", "Mailversand über TLS (implizit)", "Mail"),
  P(110, "TCP", "POP3", "Mail abholen", "Mail", PLAIN),
  P(995, "TCP", "POP3S", "POP3 über TLS", "Mail"),
  P(143, "TCP", "IMAP", "Mailzugriff (STARTTLS)", "Mail"),
  P(993, "TCP", "IMAPS", "IMAP über TLS", "Mail"),
  P(2525, "TCP", "SMTP alternativ", "Ausweich-Port mancher Mail-Dienste", "Mail"),
  // Fernzugriff
  P(22, "TCP", "SSH / SFTP / SCP", "Fernzugriff und Dateiübertragung", "Fernzugriff"),
  P(23, "TCP", "Telnet", "alter Fernzugriff auf Netzwerkgeräte", "Fernzugriff", PLAIN),
  P(
    3389,
    "TCP/UDP",
    "RDP",
    "Remotedesktop",
    "Fernzugriff",
    "nie direkt ins Internet – VPN oder RD-Gateway",
  ),
  P(
    5900,
    "TCP",
    "VNC",
    "Bildschirmfreigabe (5900 + Anzeige-Nr.)",
    "Fernzugriff",
    "oft schwach geschützt",
  ),
  P(5938, "TCP/UDP", "TeamViewer", "Fernwartung", "Fernzugriff"),
  P(7070, "TCP", "AnyDesk", "Fernwartung (zusätzlich 80/443)", "Fernzugriff"),
  P(500, "UDP", "IKE (IPsec)", "Aufbau von IPsec-VPN-Tunneln", "Fernzugriff"),
  P(4500, "UDP", "IPsec NAT-T", "IPsec durch NAT", "Fernzugriff"),
  P(1194, "UDP", "OpenVPN", "OpenVPN Standard-Port", "Fernzugriff"),
  P(51820, "UDP", "WireGuard", "WireGuard Standard-Port", "Fernzugriff"),
  P(1701, "UDP", "L2TP", "L2TP-VPN (mit IPsec)", "Fernzugriff"),
  P(1723, "TCP", "PPTP", "altes VPN", "Fernzugriff", "unsicher – nicht mehr verwenden"),
  P(
    10443,
    "TCP",
    "SSL-VPN (FortiGate)",
    "häufig verwendeter Port für FortiGate SSL-VPN",
    "Fernzugriff",
  ),
  P(
    4433,
    "TCP",
    "SSL-VPN (Sophos u. a.)",
    "häufig verwendeter Port für SSL-VPN-Portale",
    "Fernzugriff",
  ),
  // Datei & Speicher
  P(20, "TCP", "FTP-Daten", "Datenkanal im aktiven Modus", "Datei & Speicher", PLAIN),
  P(21, "TCP", "FTP", "Steuerkanal", "Datei & Speicher", PLAIN),
  P(990, "TCP", "FTPS", "FTP über TLS (implizit)", "Datei & Speicher"),
  P(2049, "TCP/UDP", "NFS", "Network File System", "Datei & Speicher", NO_INET),
  P(111, "TCP/UDP", "RPCbind / Portmapper", "für NFSv3", "Datei & Speicher", NO_INET),
  P(3260, "TCP", "iSCSI", "Block-Storage über IP", "Datei & Speicher", NO_INET),
  P(873, "TCP", "rsync", "rsync-Daemon", "Datei & Speicher"),
  P(548, "TCP", "AFP", "Apple-Dateifreigabe (veraltet)", "Datei & Speicher"),
  P(5000, "TCP", "Synology DSM", "NAS-Oberfläche HTTP (5001 HTTPS)", "Datei & Speicher"),
  P(
    9000,
    "TCP",
    "MinIO / S3",
    "S3-kompatibler Speicher, auch Portainer, PHP-FPM",
    "Datei & Speicher",
  ),
  P(10000, "TCP", "Veeam / NDMP", "NDMP-Backup, Veeam-Dienste", "Datei & Speicher"),
  P(9392, "TCP", "Veeam Backup Service", "Veeam-Konsole zum Backup-Server", "Datei & Speicher"),
  P(6160, "TCP", "Veeam Installer", "Veeam Installer Service", "Datei & Speicher"),
  // Datenbank
  P(1433, "TCP", "Microsoft SQL Server", "Standardinstanz", "Datenbank", NO_INET),
  P(1434, "UDP", "SQL Server Browser", "benannte Instanzen finden", "Datenbank", NO_INET),
  P(3306, "TCP", "MySQL / MariaDB", "", "Datenbank", NO_INET),
  P(5432, "TCP", "PostgreSQL", "", "Datenbank", NO_INET),
  P(1521, "TCP", "Oracle", "Oracle-Listener", "Datenbank", NO_INET),
  P(27017, "TCP", "MongoDB", "", "Datenbank", NO_INET),
  P(6379, "TCP", "Redis", "", "Datenbank", NO_INET),
  P(9200, "TCP", "Elasticsearch / OpenSearch", "REST-API (9300 Cluster)", "Datenbank", NO_INET),
  P(11211, "TCP/UDP", "Memcached", "", "Datenbank", NO_INET),
  P(5984, "TCP", "CouchDB", "", "Datenbank", NO_INET),
  P(8086, "TCP", "InfluxDB", "HTTP-API", "Datenbank"),
  // Netzwerkdienste
  P(853, "TCP", "DNS over TLS", "verschlüsseltes DNS (DoT)", "Netzwerkdienste"),
  P(
    161,
    "UDP",
    "SNMP",
    "Abfragen von Netzwerkgeräten",
    "Monitoring & Logging",
    "v1/v2c: Community im Klartext",
  ),
  P(162, "UDP", "SNMP-Trap", "Meldungen von Geräten", "Monitoring & Logging"),
  P(514, "UDP", "Syslog", "Protokollmeldungen", "Monitoring & Logging", PLAIN),
  P(6514, "TCP", "Syslog über TLS", "", "Monitoring & Logging"),
  P(
    1812,
    "UDP",
    "RADIUS Auth",
    "Anmeldung (802.1X, WLAN, VPN) – z. B. Windows NPS",
    "Netzwerkdienste",
  ),
  P(1813, "UDP", "RADIUS Accounting", "", "Netzwerkdienste"),
  P(1645, "UDP", "RADIUS Auth (alt)", "älterer Port, z. B. bei Cisco", "Netzwerkdienste"),
  P(49, "TCP", "TACACS+", "Anmeldung an Netzwerkgeräten", "Netzwerkdienste"),
  P(179, "TCP", "BGP", "Routing zwischen Netzen", "Netzwerkdienste"),
  P(520, "UDP", "RIP", "Routing", "Netzwerkdienste"),
  P(1985, "UDP", "HSRP", "Cisco Router-Redundanz", "Netzwerkdienste"),
  P(3784, "UDP", "BFD", "schnelle Ausfallerkennung", "Netzwerkdienste"),
  P(546, "UDP", "DHCPv6 Client", "", "Netzwerkdienste"),
  P(547, "UDP", "DHCPv6 Server", "", "Netzwerkdienste"),
  P(4789, "UDP", "VXLAN", "Overlay-Netze", "Netzwerkdienste"),
  P(
    3478,
    "TCP/UDP",
    "STUN / TURN",
    "NAT-Traversal für Teams, WebRTC (Teams: 3478–3481 UDP)",
    "VoIP & Video",
  ),
  P(8291, "TCP", "Winbox", "MikroTik-Verwaltung", "Netzwerkdienste", NO_INET),
  P(8728, "TCP", "MikroTik API", "", "Netzwerkdienste", NO_INET),
  P(8880, "TCP", "UniFi HTTP-Portal", "Gäste-Portal; 8080 Geräte-Inform", "Netzwerkdienste"),
  P(10001, "UDP", "UniFi Discovery", "Gerätesuche", "Netzwerkdienste"),
  P(631, "TCP", "IPP / CUPS", "Druckdienst", "Sonstiges"),
  P(
    9100,
    "TCP",
    "RAW-Druck (JetDirect)",
    "direkter Druck auf Netzwerkdrucker",
    "Sonstiges",
    NO_INET,
  ),
  P(515, "TCP", "LPD", "alter Druckdienst", "Sonstiges"),
  P(1883, "TCP", "MQTT", "IoT-Nachrichten", "Sonstiges", PLAIN),
  P(8883, "TCP", "MQTT über TLS", "", "Sonstiges"),
  P(502, "TCP", "Modbus TCP", "Gebäude- und Industriesteuerung", "Sonstiges", NO_INET),
  P(47808, "UDP", "BACnet", "Gebäudeautomation", "Sonstiges", NO_INET),
  // Monitoring
  P(10050, "TCP", "Zabbix Agent", "", "Monitoring & Logging"),
  P(10051, "TCP", "Zabbix Server", "Trapper / aktive Agents", "Monitoring & Logging"),
  P(5666, "TCP", "NRPE (Nagios/Icinga)", "", "Monitoring & Logging"),
  P(5665, "TCP", "Icinga 2 API", "", "Monitoring & Logging"),
  P(9090, "TCP", "Prometheus", "Weboberfläche/API (auch Cockpit)", "Monitoring & Logging"),
  P(9100, "TCP", "Prometheus Node Exporter", "", "Monitoring & Logging"),
  P(3000, "TCP", "Grafana", "", "Monitoring & Logging"),
  P(5044, "TCP", "Beats → Logstash", "", "Monitoring & Logging"),
  P(12201, "UDP", "Graylog GELF", "", "Monitoring & Logging"),
  P(8089, "TCP", "Splunk Management", "", "Monitoring & Logging"),
  P(9997, "TCP", "Splunk Forwarder", "", "Monitoring & Logging"),
  P(4317, "TCP", "OpenTelemetry (gRPC)", "4318 für HTTP", "Monitoring & Logging"),
  // VoIP & Video
  P(5060, "TCP/UDP", "SIP", "Telefonie-Signalisierung", "VoIP & Video", PLAIN),
  P(5061, "TCP", "SIP über TLS", "", "VoIP & Video"),
  P("10000-20000", "UDP", "RTP", "Sprachdaten (Bereich je nach Anlage)", "VoIP & Video"),
  P(
    "50000-50059",
    "UDP",
    "Teams Medien (Clients)",
    "empfohlene Quellports für Teams-Clients",
    "VoIP & Video",
  ),
  P(1720, "TCP", "H.323", "alte Videokonferenz-Signalisierung", "VoIP & Video"),
  P(554, "TCP", "RTSP", "Kamerastreams", "VoIP & Video"),
  P(8801, "UDP", "Zoom", "Zoom-Medien (8801–8810)", "VoIP & Video"),
  // Virtualisierung & Container
  P(
    902,
    "TCP/UDP",
    "VMware ESXi",
    "vSphere-Client-Konsole, Heartbeat",
    "Virtualisierung & Container",
  ),
  P(8006, "TCP", "Proxmox VE", "Weboberfläche", "Virtualisierung & Container"),
  P(2179, "TCP", "Hyper-V VMConnect", "Konsole von VMs", "Virtualisierung & Container"),
  P(6443, "TCP", "Kubernetes API", "", "Virtualisierung & Container"),
  P(10250, "TCP", "Kubelet", "", "Virtualisierung & Container", NO_INET),
  P("2379-2380", "TCP", "etcd", "Kubernetes-Datenspeicher", "Virtualisierung & Container", NO_INET),
  P(
    2375,
    "TCP",
    "Docker API",
    "ohne TLS – Vollzugriff auf den Host",
    "Virtualisierung & Container",
    "nie offen lassen",
  ),
  P(2376, "TCP", "Docker API TLS", "", "Virtualisierung & Container"),
  P(5000, "TCP", "Docker Registry", "", "Virtualisierung & Container"),
  P(8200, "TCP", "HashiCorp Vault", "", "Virtualisierung & Container"),
  P(8500, "TCP", "Consul", "", "Virtualisierung & Container"),
  P(9443, "TCP", "Portainer", "HTTPS-Oberfläche", "Virtualisierung & Container"),
  // Sonstiges
  P(7, "TCP/UDP", "Echo", "Testdienst", "Sonstiges"),
  P(43, "TCP", "WHOIS", "Domain- und IP-Abfragen", "Sonstiges"),
  P(113, "TCP", "Ident", "alt; IRC", "Sonstiges"),
  P(119, "TCP", "NNTP", "Usenet", "Sonstiges"),
  P(194, "TCP", "IRC", "auch 6667", "Sonstiges"),
  P(1194, "TCP", "OpenVPN TCP", "", "Fernzugriff"),
  P(5672, "TCP", "AMQP (RabbitMQ)", "15672 Weboberfläche", "Sonstiges"),
  P(9092, "TCP", "Kafka", "", "Sonstiges"),
  P(25565, "TCP", "Minecraft", "beliebt in Schul- und Heimnetzen", "Sonstiges"),
  P(27015, "UDP", "Steam / Source-Spiele", "", "Sonstiges"),
];

export const groups: PortGroup[] = [
  "Windows & AD",
  "Web & Proxy",
  "Mail",
  "Fernzugriff",
  "Datei & Speicher",
  "Datenbank",
  "Netzwerkdienste",
  "Monitoring & Logging",
  "VoIP & Video",
  "Virtualisierung & Container",
  "Sonstiges",
];

const inRange = (e: PortEntry, n: number) => {
  const [a, b] = e.port.split("-").map(Number);
  return b === undefined ? a === n : n >= a! && n <= b;
};

export const portStart = (e: PortEntry) => Number(e.port.split("-")[0]);

/** Suche: Portnummer (exakt oder in Bereich) oder Text in Name/Beschreibung */
export function searchPorts(query: string, group?: PortGroup): PortEntry[] {
  const q = query.trim().toLowerCase();
  let list = group ? ports.filter((p) => p.group === group) : ports;
  if (q) {
    const nums = q
      .split(/[\s,]+/)
      .filter((x) => /^\d{1,5}$/.test(x))
      .map(Number);
    if (nums.length && /^[\d\s,]+$/.test(q))
      list = list.filter((p) => nums.some((n) => inRange(p, n)));
    else
      list = list.filter((p) =>
        [p.name, p.desc, p.port, p.group].some((s) => s.toLowerCase().includes(q)),
      );
  }
  return [...list].sort((a, b) => portStart(a) - portStart(b) || a.proto.localeCompare(b.proto));
}

/** Port-Liste aus der Suche als Firewall-Regel (Windows/Linux) */
export function firewallCommands(
  entries: PortEntry[],
  name: string,
): { windows: string; ufw: string } {
  const by = (proto: "TCP" | "UDP") => [
    ...new Set(
      entries.filter((e) => e.proto === proto || e.proto === "TCP/UDP").map((e) => e.port),
    ),
  ];
  const tcp = by("TCP");
  const udp = by("UDP");
  const win = [
    tcp.length &&
      `New-NetFirewallRule -DisplayName "${name} (TCP)" -Direction Inbound -Protocol TCP -LocalPort ${tcp.join(",")} -Action Allow`,
    udp.length &&
      `New-NetFirewallRule -DisplayName "${name} (UDP)" -Direction Inbound -Protocol UDP -LocalPort ${udp.join(",")} -Action Allow`,
  ].filter(Boolean);
  const ufw = [
    ...tcp.map((p) => `ufw allow ${p.replace("-", ":")}/tcp`),
    ...udp.map((p) => `ufw allow ${p.replace("-", ":")}/udp`),
  ];
  return { windows: win.join("\n"), ufw: ufw.join("\n") };
}
