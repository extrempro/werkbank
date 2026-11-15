/** SAML-Nachrichten dekodieren (POST- und Redirect-Binding) und auswerten */
import { attr, find, findAll, formatXml, parseXml, textOf, type XmlNode } from "../lib/xml";

export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  let bin: string;
  try {
    bin = atob(clean + "=".repeat((4 - (clean.length % 4)) % 4));
  } catch {
    throw new Error("Kein gültiges Base64");
  }
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * Nimmt rohes XML, Base64 (POST-Binding), URL-kodiertes Base64 und deflate-komprimiertes Base64 (Redirect-Binding)
 * oder eine ganze URL mit SAMLRequest=/SAMLResponse=.
 */
export async function decodeSaml(input: string): Promise<{ xml: string; binding: string }> {
  let text = input.trim();
  if (text.startsWith("<")) return { xml: text, binding: "XML" };
  const m = text.match(/[?&](SAMLRequest|SAMLResponse)=([^&#\s]+)/);
  if (m) text = m[2]!;
  if (/%[0-9a-f]{2}/i.test(text)) text = decodeURIComponent(text.replace(/\+/g, " "));
  const bytes = base64ToBytes(text);
  const asText = new TextDecoder().decode(bytes);
  if (asText.trimStart().startsWith("<")) return { xml: asText, binding: "POST (Base64)" };
  try {
    return { xml: new TextDecoder().decode(await inflateRaw(bytes)), binding: "Redirect (Base64 + Deflate)" };
  } catch {
    throw new Error("Weder Base64-XML noch Deflate-komprimiert – ist das eine SAML-Nachricht?");
  }
}

export interface SamlInfo {
  type: string;
  rows: { label: string; value: string }[];
  attributes: { name: string; values: string[] }[];
  certificates: string[];
  signed: { message: boolean; assertion: boolean };
  encrypted: boolean;
  pretty: string;
}

export function analyzeSaml(xml: string): SamlInfo {
  const nodes: XmlNode[] = parseXml(xml);
  const root = nodes.find((n) => n.kind === "element");
  if (!root || root.kind !== "element") throw new Error("Kein XML-Element gefunden");
  const type = root.name.replace(/^.*:/, "");
  const rows: SamlInfo["rows"] = [];
  const push = (label: string, value: string | undefined) => value && rows.push({ label, value: value.trim() });
  push("ID", attr(root, "ID"));
  push("Ausgestellt", attr(root, "IssueInstant"));
  push("Ziel (Destination)", attr(root, "Destination"));
  push("Antwort auf (InResponseTo)", attr(root, "InResponseTo"));
  push("ACS-URL", attr(root, "AssertionConsumerServiceURL"));
  push("Aussteller (Issuer)", textOf(find([root], "Issuer")));
  const status = find([root], "StatusCode");
  if (status) {
    const codes = findAll([status], "StatusCode").map((s) => (attr(s, "Value") ?? "").replace(/^urn:oasis:names:tc:SAML:2.0:status:/, ""));
    push("Status", codes.join(" / "));
    push("Statusmeldung", textOf(find([root], "StatusMessage")));
  }
  const nameId = find([root], "NameID");
  if (nameId) push("NameID", `${textOf(nameId)}${attr(nameId, "Format") ? ` (${attr(nameId, "Format")!.replace(/^urn:oasis:names:tc:SAML:[\d.]+:nameid-format:/, "")})` : ""}`);
  const cond = find([root], "Conditions");
  push("Gültig ab (NotBefore)", attr(cond, "NotBefore"));
  push("Gültig bis (NotOnOrAfter)", attr(cond, "NotOnOrAfter"));
  push("Zielgruppe (Audience)", findAll([root], "Audience").map(textOf).join(", "));
  const authn = find([root], "AuthnStatement");
  push("Anmeldung", attr(authn, "AuthnInstant"));
  push("Sitzung bis", attr(authn, "SessionNotOnOrAfter"));
  push("Anmeldeart", textOf(find([root], "AuthnContextClassRef")).replace(/^urn:oasis:names:tc:SAML:2.0:ac:classes:/, ""));
  const attributes = findAll([root], "Attribute").map((a) => ({
    name: attr(a, "FriendlyName") ? `${attr(a, "FriendlyName")} (${attr(a, "Name")})` : (attr(a, "Name") ?? "?"),
    values: findAll([a], "AttributeValue").map((v) => textOf(v).trim()),
  }));
  const assertion = find([root], "Assertion");
  const sigDirect = (el: typeof root) => el.children.some((c) => c.kind === "element" && c.name.replace(/^.*:/, "") === "Signature");
  return {
    type,
    rows,
    attributes,
    certificates: findAll([root], "X509Certificate").map((c) => textOf(c).replace(/\s+/g, "")),
    signed: { message: sigDirect(root), assertion: !!assertion && sigDirect(assertion) },
    encrypted: !!find([root], "EncryptedAssertion"),
    pretty: formatXml(nodes),
  };
}
