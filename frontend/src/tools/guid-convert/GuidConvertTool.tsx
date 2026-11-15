import { useMemo, useState } from "react";
import { ErrorBox, InfoTable } from "../ui";
import { convertGuid, guidKindLabels } from "./guid";

export default function GuidConvertTool() {
  // Die Kennung gehört zu einem Konto und bleibt deshalb nur auf dieser Seite.
  const [input, setInput] = useState("");

  const result = useMemo(() => {
    if (!input.trim()) {
      return null;
    }
    try {
      return convertGuid(input);
    } catch (caught) {
      return { error: (caught as Error).message };
    }
  }, [input]);

  return (
    <div className="tool-body settings-form">
      <div className="tool-field">
        <label>
          Kennung
          <input
            type="text"
            className="mono"
            autoComplete="off"
            spellCheck={false}
            value={input}
            placeholder="748b2d72-706b-42f8-8b25-82fd8733860f"
            onChange={(event) => setInput(event.target.value)}
          />
        </label>
        <p className="small">
          GUID, ImmutableID (Base64), Hex-Bytes oder die Form für LDAP-Filter.
        </p>
      </div>

      {result && "error" in result && <ErrorBox>{result.error}</ErrorBox>}
      {result && !("error" in result) && (
        <>
          <p role="status">
            Erkannt als <span className="pill pill-neutral">{guidKindLabels[result.detected]}</span>
          </p>
          <InfoTable
            caption="Schreibweisen der Kennung"
            rows={[
              { label: "objectGUID", value: result.guid, copy: result.guid },
              { label: "ImmutableID", value: result.immutableId, copy: result.immutableId },
              { label: "Hex-Bytes", value: result.hex, copy: result.hex },
              {
                label: "LDAP-Filter",
                value: `(objectGUID=${result.ldapFilter})`,
                copy: `(objectGUID=${result.ldapFilter})`,
              },
              {
                label: "PowerShell (AD)",
                value: `Get-ADUser -Filter "ObjectGUID -eq '${result.guid}'"`,
                copy: `Get-ADUser -Filter "ObjectGUID -eq '${result.guid}'"`,
              },
              {
                label: "PowerShell (Graph)",
                value: `Get-MgUser -Filter "onPremisesImmutableId eq '${result.immutableId}'"`,
                copy: `Get-MgUser -Filter "onPremisesImmutableId eq '${result.immutableId}'"`,
              },
            ]}
          />
          <p className="small">
            Die ImmutableID entspricht dem <span className="mono">sourceAnchor</span> in Entra
            Connect und dem Base64 von <span className="mono">msDS-ConsistencyGuid</span>.
          </p>
        </>
      )}
    </div>
  );
}
