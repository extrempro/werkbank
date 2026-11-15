/** URL-Kodierung und Zerlegung von URLs */

export type UrlMode = "component" | "uri" | "form";

export function urlEncode(text: string, mode: UrlMode): string {
  if (mode === "uri") return encodeURI(text);
  const e = encodeURIComponent(text);
  return mode === "form" ? e.replace(/%20/g, "+") : e;
}

export function urlDecode(text: string, plusAsSpace: boolean): string {
  const t = plusAsSpace ? text.replace(/\+/g, " ") : text;
  try {
    return decodeURIComponent(t);
  } catch {
    throw new Error("Ungültige %-Folge (z. B. ein einzelnes % oder kein gültiges UTF-8)");
  }
}

export interface UrlParts {
  protocol: string;
  username: string;
  password: string;
  host: string;
  port: string;
  path: string;
  params: { key: string; value: string }[];
  hash: string;
}

export function parseUrl(text: string): UrlParts | null {
  let u: URL;
  try {
    u = new URL(text.trim());
  } catch {
    return null;
  }
  return {
    protocol: u.protocol.replace(/:$/, ""),
    username: decodeURIComponent(u.username),
    password: u.password ? "••••" : "",
    host: u.hostname,
    port: u.port,
    path: decodeURIComponent(u.pathname),
    params: [...u.searchParams].map(([key, value]) => ({ key, value })),
    hash: decodeURIComponent(u.hash.replace(/^#/, "")),
  };
}
