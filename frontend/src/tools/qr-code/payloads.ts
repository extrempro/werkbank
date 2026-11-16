/** Inhalte für QR-Codes in den Formaten, die Smartphone-Kameras verstehen. */

export type ContentType = "text" | "url" | "wifi" | "vcard" | "email" | "phone" | "sms";

export const contentTypeLabels: Record<ContentType, string> = {
  text: "Text",
  url: "Link",
  wifi: "WLAN",
  vcard: "Kontakt",
  email: "E-Mail",
  phone: "Telefon",
  sms: "SMS",
};

// ---------- Link ----------

/** Ergänzt https://, wenn kein Schema angegeben ist. */
export function urlPayload(url: string): string {
  const u = url.trim();
  if (!u) return "";
  return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`;
}

// ---------- WLAN ----------

export type WifiSecurity = "WPA" | "WEP" | "nopass";

export interface WifiData {
  ssid: string;
  password: string;
  security: WifiSecurity;
  hidden: boolean;
}

/** Sonderzeichen im WLAN-Format maskieren: \ ; , : " */
export function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

/** WIFI:T:WPA;S:Netz;P:Kennwort;H:true;; */
export function wifiPayload(d: WifiData): string {
  if (!d.ssid) return "";
  const parts = [`T:${d.security}`, `S:${escapeWifi(d.ssid)}`];
  if (d.security !== "nopass") parts.push(`P:${escapeWifi(d.password)}`);
  if (d.hidden) parts.push("H:true");
  return `WIFI:${parts.join(";")};;`;
}

// ---------- Kontakt (vCard 3.0) ----------

export interface VcardData {
  firstName: string;
  lastName: string;
  organization: string;
  title: string;
  phoneWork: string;
  phoneMobile: string;
  email: string;
  website: string;
  street: string;
  zip: string;
  city: string;
  country: string;
}

export const emptyVcard: VcardData = {
  firstName: "",
  lastName: "",
  organization: "",
  title: "",
  phoneWork: "",
  phoneMobile: "",
  email: "",
  website: "",
  street: "",
  zip: "",
  city: "",
  country: "",
};

/** Text-Werte in vCard maskieren: \ , ; und Zeilenumbrüche */
export function escapeVcard(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\r?\n/g, "\\n");
}

export function vcardPayload(d: VcardData): string {
  const e = (s: string) => escapeVcard(s.trim());
  const fullName = [d.firstName, d.lastName].map((s) => s.trim()).filter(Boolean).join(" ");
  if (!fullName && !d.organization.trim()) return "";
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${e(d.lastName)};${e(d.firstName)};;;`, `FN:${e(fullName || d.organization)}`];
  if (d.organization.trim()) lines.push(`ORG:${e(d.organization)}`);
  if (d.title.trim()) lines.push(`TITLE:${e(d.title)}`);
  if (d.phoneWork.trim()) lines.push(`TEL;TYPE=WORK,VOICE:${d.phoneWork.trim()}`);
  if (d.phoneMobile.trim()) lines.push(`TEL;TYPE=CELL:${d.phoneMobile.trim()}`);
  if (d.email.trim()) lines.push(`EMAIL;TYPE=INTERNET:${d.email.trim()}`);
  if (d.website.trim()) lines.push(`URL:${urlPayload(d.website)}`);
  if ([d.street, d.zip, d.city, d.country].some((s) => s.trim())) {
    lines.push(`ADR;TYPE=WORK:;;${e(d.street)};${e(d.city)};;${e(d.zip)};${e(d.country)}`);
  }
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

// ---------- E-Mail, Telefon, SMS ----------

export interface EmailData {
  to: string;
  subject: string;
  body: string;
}

export function emailPayload(d: EmailData): string {
  const to = d.to.trim();
  if (!to) return "";
  const params: string[] = [];
  if (d.subject) params.push(`subject=${encodeURIComponent(d.subject)}`);
  if (d.body) params.push(`body=${encodeURIComponent(d.body)}`);
  return `mailto:${to}${params.length ? `?${params.join("&")}` : ""}`;
}

/** Leerzeichen, Klammern, Bindestriche entfernen; führendes + bleibt erhalten */
export function normalizePhone(phone: string): string {
  const p = phone.trim();
  return (p.startsWith("+") ? "+" : "") + p.replace(/[^\d]/g, "");
}

export function phonePayload(phone: string): string {
  const p = normalizePhone(phone);
  return p.replace("+", "") ? `tel:${p}` : "";
}

export interface SmsData {
  phone: string;
  message: string;
}

export function smsPayload(d: SmsData): string {
  const p = normalizePhone(d.phone);
  if (!p.replace("+", "")) return "";
  return d.message ? `SMSTO:${p}:${d.message}` : `SMSTO:${p}`;
}
