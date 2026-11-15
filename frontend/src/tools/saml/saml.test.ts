// @vitest-environment node
import { describe, expect, it } from "vitest";
import { analyzeSaml, decodeSaml } from "./saml";

const REDIRECT =
  "https://idp.example/sso?SAMLRequest=fc%2FNCsIwEATgVyn7AI16XNpA0UuhXlo8SwgLLeTP7Eb6%2BKIiVASPw8B8TMPGu4RdkTmMdCvEUq3eBcZX0ULJAaPhhTEYT4xicerOAx7qHaYcJdrooOpPLVz3UHXMlGWJ4RgDF095onxfLF3GoYVZJDEqxamm1fjkSBnLoJsnhT1zobzB%2F9vmI4H%2B3W3UZlK%2F0%2FdJ%2FQA%3D&RelayState=x";

const RESPONSE = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r1" InResponseTo="_1" Destination="https://sp.example/acs" IssueInstant="2026-11-07T10:00:00Z">
  <saml:Issuer>https://sts.windows.net/abc/</saml:Issuer>
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  <saml:Assertion ID="_a1">
    <saml:Issuer>https://sts.windows.net/abc/</saml:Issuer>
    <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>MIIC
AAA=</ds:X509Certificate></ds:X509Data></ds:KeyInfo></ds:Signature>
    <saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">max@example.com</saml:NameID></saml:Subject>
    <saml:Conditions NotBefore="2026-11-07T09:55:00Z" NotOnOrAfter="2026-11-07T11:00:00Z"><saml:AudienceRestriction><saml:Audience>https://sp.example</saml:Audience></saml:AudienceRestriction></saml:Conditions>
    <saml:AttributeStatement>
      <saml:Attribute Name="http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"><saml:AttributeValue>g1</saml:AttributeValue><saml:AttributeValue>g2</saml:AttributeValue></saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`;

describe("SAML", () => {
  it("dekodiert Redirect-Binding (Deflate) aus einer URL", async () => {
    const r = await decodeSaml(REDIRECT);
    expect(r.binding).toMatch(/Deflate/);
    const info = analyzeSaml(r.xml);
    expect(info.type).toBe("AuthnRequest");
    expect(info.rows).toContainEqual({ label: "ACS-URL", value: "https://sp.example/acs" });
  });

  it("wertet eine Response aus", async () => {
    const r = await decodeSaml(btoa(RESPONSE));
    expect(r.binding).toMatch(/POST/);
    const info = analyzeSaml(r.xml);
    expect(info.rows.find((x) => x.label === "Status")?.value).toBe("Success");
    expect(info.rows.find((x) => x.label === "NameID")?.value).toBe(
      "max@example.com (emailAddress)",
    );
    expect(info.attributes[0]!.values).toEqual(["g1", "g2"]);
    expect(info.signed).toEqual({ message: false, assertion: true });
    expect(info.certificates).toEqual(["MIICAAA="]);
  });
});
