import { useMemo } from "react";
import { useToolParams } from "../params";
import { CopyButton, ErrorBox, InfoTable, ToolSection } from "../ui";
import { commonUacValues, decodeUac, ldapBitFilter, parseUac, uacFlags } from "./uac";

const hex = (value: number) => `0x${value.toString(16).toUpperCase().padStart(4, "0")}`;

export default function UacTool() {
  const [params, setParams] = useToolParams({ wert: "512" });
  const input = params.wert;

  const parsed = useMemo(() => {
    try {
      return { value: parseUac(input) };
    } catch (caught) {
      return { error: (caught as Error).message };
    }
  }, [input]);
  const value = "value" in parsed ? parsed.value : null;
  const set = (next: number) => setParams({ wert: String(next >>> 0) });
  const info = decodeUac(value ?? 0);
  const disabledFilter = `(&(objectCategory=person)(objectClass=user)${ldapBitFilter(2)})`;

  return (
    <div className="tool-body settings-form">
      <div className="tool-row">
        <label className="narrow">
          Wert
          <input
            type="text"
            className="mono"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(event) => setParams({ wert: event.target.value })}
          />
        </label>
        {value !== null && (
          <p className="badges" role="status">
            <span className="pill pill-neutral mono">{value}</span>
            <span className="pill pill-neutral mono">{hex(value)}</span>
          </p>
        )}
      </div>
      <p className="small">Dezimal oder hexadezimal mit 0x.</p>
      <div className="chips" role="group" aria-label="Übliche Werte">
        {commonUacValues.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className="chip"
            aria-pressed={value === entry.value}
            onClick={() => set(entry.value)}
          >
            <span className="mono">{entry.value}</span> · {entry.label}
          </button>
        ))}
      </div>
      {"error" in parsed && <ErrorBox>{parsed.error}</ErrorBox>}

      {value !== null && (
        <>
          {info.warnings.length > 0 && (
            <ul className="tool-list" aria-label="Hinweise">
              {info.warnings.map((warning) => (
                <li key={warning}>
                  <span className="pill pill-todo">Hinweis</span> {warning}
                </li>
              ))}
            </ul>
          )}
          <ToolSection title="Flags (ankreuzen zum Setzen oder Entfernen)">
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Flags">
              <table>
                <caption className="visually-hidden">Flags von userAccountControl</caption>
                <thead>
                  <tr>
                    <th scope="col">Gesetzt</th>
                    <th scope="col">Flag</th>
                    <th scope="col">Hex</th>
                    <th scope="col" className="number">
                      Dezimal
                    </th>
                    <th scope="col">LDAP-Filter</th>
                  </tr>
                </thead>
                <tbody>
                  {uacFlags.map((flag) => {
                    const on = (value & flag.bit) !== 0;
                    return (
                      <tr key={flag.bit} className={on ? "tool-hit" : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            className="check"
                            aria-label={flag.name}
                            checked={on}
                            onChange={() => set(value ^ flag.bit)}
                          />
                        </td>
                        <td>
                          <span className="mono">{flag.name}</span>
                          <span className="small tenant-part">
                            {flag.label}
                            {flag.computed && " (berechnet)"}
                          </span>
                        </td>
                        <td className="mono">{hex(flag.bit)}</td>
                        <td className="mono number">{flag.bit}</td>
                        <td>
                          {on && (
                            <CopyButton
                              value={ldapBitFilter(flag.bit)}
                              label={`Filter für ${flag.name} kopieren`}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {info.unknown !== 0 && (
              <p className="hint-box hint-warn">Unbekannte Bits gesetzt: {hex(info.unknown)}</p>
            )}
          </ToolSection>
          <ToolSection title="Suchen in AD">
            <InfoTable
              caption="Suchen in AD"
              rows={[
                { label: "Alle deaktivierten Konten", value: disabledFilter, copy: disabledFilter },
                {
                  label: "Konten mit genau diesem Wert",
                  value: `Get-ADUser -Filter 'userAccountControl -eq ${value}'`,
                  copy: `Get-ADUser -Filter 'userAccountControl -eq ${value}'`,
                },
              ]}
            />
            <p className="small">
              Der erste Eintrag ist ein LDAP-Filter, z. B. für Get-ADUser -LDAPFilter.
            </p>
          </ToolSection>
        </>
      )}
    </div>
  );
}
