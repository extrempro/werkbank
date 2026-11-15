import { useMemo, useState } from "react";
import { analyzeDn, canonicalToDn } from "../ldap/ldap";
import { CopyButton, ErrorBox, InfoTable, ToolSection } from "../ui";

export default function DnTool() {
  // Namen aus dem Verzeichnis bleiben nur auf dieser Seite.
  const [dn, setDn] = useState("");
  const [canonical, setCanonical] = useState("");

  const info = useMemo(() => {
    if (!dn.trim()) {
      return null;
    }
    try {
      return analyzeDn(dn);
    } catch (caught) {
      return { error: (caught as Error).message };
    }
  }, [dn]);

  const fromCanonical = useMemo(() => {
    if (!canonical.trim()) {
      return null;
    }
    try {
      return { dn: canonicalToDn(canonical) };
    } catch (caught) {
      return { error: (caught as Error).message };
    }
  }, [canonical]);

  const levels =
    info && !("error" in info)
      ? info.rdns.flatMap((rdn, index) =>
          rdn.parts.map((part, position) => ({
            key: `${index}-${position}`,
            level: position === 0 ? String(info.rdns.length - index) : "",
            type: part.type.toUpperCase(),
            value: part.value,
            path:
              position === 0
                ? info.rdns
                    .slice(index)
                    .map((entry) => entry.raw)
                    .join(",")
                : "",
          })),
        )
      : [];

  return (
    <div className="tool-body settings-form">
      <ToolSection title="DN zerlegen">
        <label>
          Distinguished Name
          <input
            type="text"
            className="mono"
            autoComplete="off"
            spellCheck={false}
            value={dn}
            onChange={(event) => setDn(event.target.value)}
            placeholder={"CN=Muster\\, Max,OU=Vertrieb,OU=Benutzer,DC=example,DC=com"}
          />
        </label>
        {info && "error" in info && <ErrorBox>{info.error}</ErrorBox>}
        {info && !("error" in info) && (
          <>
            <InfoTable
              caption="Angaben zum DN"
              rows={[
                { label: "Name", value: info.name ?? "–", copy: info.name, plain: true },
                { label: "Domain", value: info.domain ?? "–", copy: info.domain },
                { label: "canonicalName", value: info.canonical ?? "–", copy: info.canonical },
                { label: "Übergeordnet", value: info.parent ?? "–", copy: info.parent },
                { label: "Einheitlich formatiert", value: info.normalized, copy: info.normalized },
              ]}
            />
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Ebenen des DN">
              <table>
                <caption className="visually-hidden">Ebenen des DN</caption>
                <thead>
                  <tr>
                    <th scope="col">Ebene</th>
                    <th scope="col">Typ</th>
                    <th scope="col">Wert</th>
                    <th scope="col">Pfad bis hier</th>
                  </tr>
                </thead>
                <tbody>
                  {levels.map((row) => (
                    <tr key={row.key}>
                      <td>{row.level}</td>
                      <td className="mono">{row.type}</td>
                      <td>{row.value}</td>
                      <td className="mono tool-break">
                        {row.path && (
                          <>
                            {row.path}{" "}
                            <CopyButton value={row.path} label={`Pfad ${row.level} kopieren`} />
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </ToolSection>

      <ToolSection title="canonicalName → DN">
        <div className="tool-field">
          <label>
            canonicalName
            <input
              type="text"
              className="mono"
              autoComplete="off"
              spellCheck={false}
              value={canonical}
              onChange={(event) => setCanonical(event.target.value)}
              placeholder="example.com/Benutzer/Vertrieb/Max Muster"
            />
          </label>
          <p className="small">
            Wie in „Active Directory-Benutzer und -Computer“ auf der Registerkarte „Objekt“.
          </p>
        </div>
        {fromCanonical && "error" in fromCanonical && <ErrorBox>{fromCanonical.error}</ErrorBox>}
        {fromCanonical && "dn" in fromCanonical && (
          <>
            <InfoTable
              caption="DN zum canonicalName"
              rows={[{ label: "DN", value: fromCanonical.dn, copy: fromCanonical.dn }]}
            />
            <p className="small">
              Zwischenebenen werden als OU angenommen (außer Standard-Containern wie Users und
              Computers), das letzte Element als CN. Bei Abweichungen den Typ im DN anpassen.
            </p>
          </>
        )}
      </ToolSection>
    </div>
  );
}
