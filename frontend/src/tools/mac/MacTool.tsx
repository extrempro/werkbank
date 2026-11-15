import { useEffect, useMemo, useState } from "react";
import { useToolParams } from "../params";
import { InfoTable, Output } from "../ui";
import {
  eui64,
  extractMacs,
  formatLabels,
  formatMac,
  lookupVendor,
  specialMac,
  type MacFormat,
} from "./mac";

const FORMATS = Object.keys(formatLabels) as MacFormat[];
const SHOWN = 500;

let ouiPromise: Promise<Map<string, string>> | undefined;
const loadOui = () => (ouiPromise ??= import("./oui").then((module) => module.oui()));

export default function MacTool() {
  const [params, setParams] = useToolParams({ format: "colon" });
  const format: MacFormat = FORMATS.includes(params.format as MacFormat)
    ? (params.format as MacFormat)
    : "colon";
  // Die Adressen selbst bleiben auf dieser Seite und stehen nicht in der Adresszeile.
  const [text, setText] = useState("");
  const macs = useMemo(() => extractMacs(text), [text]);
  const [oui, setOui] = useState<Map<string, string> | null>(null);
  const [ouiError, setOuiError] = useState(false);
  const hasMacs = macs.length > 0;

  useEffect(() => {
    // Die Herstellerliste (rund 1,8 MB) wird erst geladen, wenn eine Adresse eingegeben wurde.
    if (hasMacs && !oui) {
      loadOui().then(setOui, () => {
        ouiPromise = undefined;
        setOuiError(true);
      });
    }
  }, [hasMacs, oui]);

  const converted = macs.map((mac) => formatMac(mac.hex, format)).join("\n");
  const single = macs.length === 1 ? macs[0] : undefined;
  const eui = single && !single.multicast ? eui64(single.hex) : null;

  return (
    <div className="tool-body settings-form">
      <label>
        MAC-Adressen in beliebiger Schreibweise, auch ganze Ausgaben von arp -a
        <textarea
          rows={5}
          value={text}
          spellCheck={false}
          placeholder="00:50:56:ab:cd:ef"
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      {hasMacs && (
        <>
          <label className="narrow">
            Ausgabeformat
            <select value={format} onChange={(event) => setParams({ format: event.target.value })}>
              {FORMATS.map((entry) => (
                <option key={entry} value={entry}>
                  {formatLabels[entry]}
                </option>
              ))}
            </select>
          </label>
          <Output
            value={converted}
            label={
              macs.length === 1 ? "1 Adresse umgewandelt" : `${macs.length} Adressen umgewandelt`
            }
          />
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Adressen">
            <table>
              <caption className="visually-hidden">Adressen mit Hersteller und Art</caption>
              <thead>
                <tr>
                  <th scope="col">Adresse</th>
                  <th scope="col">Hersteller</th>
                  <th scope="col">Art</th>
                </tr>
              </thead>
              <tbody>
                {macs.slice(0, SHOWN).map((mac, index) => {
                  const special = specialMac(mac.hex);
                  const vendor = oui ? lookupVendor(oui, mac.hex) : undefined;
                  return (
                    <tr key={`${index}-${mac.hex}`}>
                      <td className="mono nowrap">{formatMac(mac.hex, format)}</td>
                      <td>
                        {mac.multicast
                          ? "–"
                          : mac.local
                            ? "– (lokal vergeben)"
                            : (vendor ??
                              (oui ? "unbekannt" : ouiError ? "Liste nicht geladen" : "lädt …"))}
                      </td>
                      <td>
                        {special ? (
                          <span className="pill pill-neutral">{special}</span>
                        ) : mac.multicast ? (
                          <span className="pill pill-neutral">Multicast</span>
                        ) : mac.local ? (
                          <span className="pill pill-todo">lokal / zufällig</span>
                        ) : (
                          <span className="pill pill-ok">Unicast, global</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {macs.length > SHOWN && (
            <p className="small">Die Tabelle zeigt die ersten {SHOWN} Adressen.</p>
          )}
          {eui && (
            <InfoTable
              caption="Abgeleitete Adressen"
              rows={[
                { label: "EUI-64 (SLAAC)", value: eui.eui, copy: eui.eui },
                { label: "IPv6 Link-Local", value: eui.linkLocal, copy: eui.linkLocal },
              ]}
            />
          )}
          <p className="small">
            „Lokal vergeben“: Das zweite Bit ist gesetzt. Das ist typisch für zufällige
            WLAN-Adressen von Handys und Laptops, für virtuelle Maschinen und Container und für
            virtuelle Router-Adressen; ein Hersteller lässt sich dann nicht ableiten. Die
            Herstellerliste stammt aus den Registrierungen der IEEE und ist in der Werkbank
            enthalten; es gibt keine Abfrage nach außen.
          </p>
        </>
      )}
    </div>
  );
}
