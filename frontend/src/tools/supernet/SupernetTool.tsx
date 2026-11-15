import { useMemo, useState } from "react";
import type { IpVersion } from "../cidr/ip";
import { formatCountShort } from "../cidr/subnet";
import { ErrorBox, Output, ToolSection } from "../ui";
import { aggregate, cidrString, commonSupernet, parseEntries } from "./supernet";

export default function SupernetTool() {
  // Die Liste verrät den Aufbau eines Netzes; sie bleibt auf dieser Seite und steht nicht in der Adresszeile.
  const [list, setList] = useState("");
  const parsed = useMemo(() => parseEntries(list), [list]);
  const results = useMemo(
    () =>
      ([4, 6] as IpVersion[])
        .filter((version) => parsed.entries.some((entry) => entry.version === version))
        .map((version) => ({
          version,
          aggregated: aggregate(parsed.entries, version),
          common: commonSupernet(parsed.entries, version),
          count: parsed.entries.filter((entry) => entry.version === version).length,
        })),
    [parsed],
  );

  return (
    <div className="tool-body settings-form">
      <label>
        Netze, Adressen oder Bereiche (je Zeile eines, oder mit Komma oder Leerzeichen getrennt)
        <textarea
          rows={8}
          value={list}
          spellCheck={false}
          placeholder={"192.168.0.0/24\n192.168.1.0/24\n10.0.0.5\n172.16.0.10 - 172.16.0.20"}
          onChange={(event) => setList(event.target.value)}
        />
      </label>
      {parsed.invalid.length > 0 && <ErrorBox>Nicht erkannt: {parsed.invalid.join(", ")}</ErrorBox>}
      {parsed.unaligned.length > 0 && (
        <p className="hint-box hint-warn" role="status">
          Nicht auf der Netzgrenze, als ganzes Netz gewertet: {parsed.unaligned.join(", ")}
        </p>
      )}
      {results.map(({ version, aggregated, common, count }) => (
        <ToolSection key={version} title={`IPv${version}`}>
          <p className="small" role="status">
            {count} {count === 1 ? "Eintrag" : "Einträge"} →{" "}
            <span className="pill pill-ok">
              {aggregated.cidrs.length} {aggregated.cidrs.length === 1 ? "Netz" : "Netze"}
            </span>{" "}
            · {formatCountShort(aggregated.addresses)} Adressen, genau abgedeckt
          </p>
          <Output
            value={aggregated.cidrs.map((block) => cidrString(version, block)).join("\n")}
            label={`Zusammengefasst (IPv${version})`}
          />
          {common && common.prefix > 0 && aggregated.cidrs.length > 1 && (
            <p className="small">
              Kleinstes gemeinsames Netz:{" "}
              <span className="mono">{cidrString(version, common)}</span>. Es deckt{" "}
              {formatCountShort(common.addresses)} Adressen ab,{" "}
              {formatCountShort(common.addresses - aggregated.addresses)} davon gehören nicht zur
              Liste.
            </p>
          )}
        </ToolSection>
      ))}
      {!list.trim() && (
        <p className="small">
          Überlappende, doppelte und benachbarte Einträge werden zusammengeführt. Das Ergebnis deckt
          genau dieselben Adressen ab. Alles nach # ist Kommentar. Die Liste bleibt auf dieser Seite
          und wird nirgends gespeichert.
        </p>
      )}
    </div>
  );
}
