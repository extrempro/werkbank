import { FixedChoice } from "../../components/ListChoice";
import { useMemo } from "react";
import { useToolParams } from "../params";
import { Output, ToolSection } from "../ui";
import { firewallCommands, groups, searchPorts, type PortGroup } from "./ports";

/**
 * Name für die Firewall-Regel. Der Suchbegriff kann aus einem geteilten Link stammen und landet
 * in einem Befehl zum Kopieren; deshalb sind nur harmlose Zeichen erlaubt.
 */
export function ruleName(query: string, group: string | undefined): string {
  const candidate = (query.trim() || group || "").replace(/&/g, "und");
  return /^[A-Za-z0-9ÄÖÜäöüß ._,-]{1,40}$/.test(candidate) ? candidate : "Freigabe";
}

export default function PortsTool() {
  const [params, setParams] = useToolParams({ suche: "", bereich: "" });
  const query = params.suche.slice(0, 200);
  const group = (groups as string[]).includes(params.bereich)
    ? (params.bereich as PortGroup)
    : undefined;
  const list = useMemo(() => searchPorts(query, group), [query, group]);
  const commands = useMemo(
    () =>
      list.length > 0 && list.length <= 30 ? firewallCommands(list, ruleName(query, group)) : null,
    [list, query, group],
  );

  return (
    <div className="tool-body settings-form">
      <div className="form-grid">
        <label>
          Port oder Dienst (mehrere Ports mit Leerzeichen)
          <input
            type="search"
            value={query}
            maxLength={200}
            placeholder="445, ldap, 3389 5985"
            onChange={(event) => setParams({ suche: event.target.value })}
          />
        </label>
        <FixedChoice
          label="Bereich"
          value={String(group ?? "")}
          options={[
            { value: "", label: "alle" },
            ...groups.map((entry) => ({ value: String(entry), label: String(entry) })),
          ]}
          onChange={(value) => setParams({ bereich: value })}
        />
      </div>
      <p className="small" role="status">
        {list.length === 1 ? "1 Eintrag" : `${list.length} Einträge`}
      </p>
      {list.length > 0 && (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Ports">
          <table>
            <caption className="visually-hidden">Ports und Dienste</caption>
            <thead>
              <tr>
                <th scope="col">Port</th>
                <th scope="col">Protokoll</th>
                <th scope="col">Dienst</th>
                <th scope="col">Beschreibung</th>
              </tr>
            </thead>
            <tbody>
              {list.map((entry) => (
                <tr key={`${entry.port}/${entry.proto}/${entry.name}`}>
                  <td className="mono nowrap">{entry.port}</td>
                  <td className="nowrap">{entry.proto}</td>
                  <td>
                    <strong>{entry.name}</strong>
                  </td>
                  <td>
                    {entry.desc}{" "}
                    {entry.warn && <span className="pill pill-todo">{entry.warn}</span>}
                    {!group && <span className="small"> · {entry.group}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.length === 0 && query && (
        <p className="small">
          Nicht in der Liste. Offiziell registrierte Ports führt die IANA (Service Name and
          Transport Protocol Port Number Registry).
        </p>
      )}
      {commands && (
        <ToolSection title="Als Firewall-Regel (eingehend)">
          <Output value={commands.windows} label="Windows (PowerShell)" />
          <Output value={commands.ufw} label="Linux (ufw)" />
        </ToolSection>
      )}
    </div>
  );
}
