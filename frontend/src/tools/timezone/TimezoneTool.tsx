import { ComboField, type ComboItem } from "../../components/ComboField";
import { FixedChoice } from "../../components/ListChoice";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { allZones, defaultZones, formatOffset, wallTimeToDate, zoneOffset } from "../lib/time";
import { CopyButton, ErrorBox } from "../ui";

export const ZONES_KEY = "werkbank-it-tools-zeitzonen";

const pad = (value: number) => String(value).padStart(2, "0");
const localInput = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

function loadZones(): string[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(ZONES_KEY) ?? "null");
    if (Array.isArray(stored) && stored.every((zone) => typeof zone === "string")) {
      return stored as string[];
    }
  } catch {
    // Standardliste
  }
  return defaultZones;
}

const format = (zone: string) =>
  new Intl.DateTimeFormat("de-DE", {
    timeZone: zone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function TimezoneTool() {
  const zonesAll = useMemo(() => allZones(), []);
  const [time, setTime] = useState(() => localInput(new Date()));
  const [source, setSource] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [zones, setZonesState] = useState(loadZones);
  const latestZones = useRef(zones);
  useEffect(() => {
    latestZones.current = zones;
  });
  // Suche über alle Zeitzonen ohne die schon gezeigten (höchstens 20 Treffer)
  const searchZones = useCallback(
    (query: string) => {
      const needle = query.trim().toLowerCase();
      const hits = zonesAll.filter(
        (zone) => !latestZones.current.includes(zone) && zone.toLowerCase().includes(needle),
      );
      return Promise.resolve({
        items: hits.slice(0, 20).map((zone) => ({ id: zone, label: zone, detail: "" })),
        total: hits.length,
      });
    },
    [zonesAll],
  );

  const setZones = (next: string[]) => {
    setZonesState(next);
    try {
      window.localStorage.setItem(ZONES_KEY, JSON.stringify(next));
    } catch {
      // Speicher gesperrt: die Liste gilt dann nur bis zum Neuladen.
    }
  };

  const at = useMemo(() => {
    try {
      const date = wallTimeToDate(time, source);
      return Number.isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }, [time, source]);

  const rows = useMemo(() => {
    if (!at) {
      return [];
    }
    const result = [];
    for (const zone of zones) {
      try {
        const offset = zoneOffset(zone, at);
        const january = zoneOffset(zone, new Date(Date.UTC(at.getUTCFullYear(), 0, 1)));
        const july = zoneOffset(zone, new Date(Date.UTC(at.getUTCFullYear(), 6, 1)));
        result.push({
          zone,
          offset,
          summer: january !== july && offset === Math.max(january, july),
          text: format(zone).format(at),
        });
      } catch {
        // Unbekannte Zone aus einem alten Speicherstand: auslassen.
      }
    }
    return result;
  }, [at, zones]);

  return (
    <div className="tool-body settings-form">
      <div className="tool-row">
        <label className="narrow">
          Datum und Uhrzeit
          <input
            type="datetime-local"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
        </label>
        <FixedChoice
          label="in Zeitzone"
          value={String(source)}
          options={[...zonesAll.map((zone) => ({ value: String(zone), label: String(zone) }))]}
          onChange={(value) => setSource(value)}
        />
      </div>
      {!at && <ErrorBox>Ungültiges Datum</ErrorBox>}
      {at && (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Uhrzeit je Zeitzone">
          <table>
            <caption className="visually-hidden">Uhrzeit je Zeitzone</caption>
            <thead>
              <tr>
                <th scope="col">Zeitzone</th>
                <th scope="col">Uhrzeit</th>
                <th scope="col">Abstand zu UTC</th>
                <th scope="col">
                  <span className="visually-hidden">Aktionen</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.zone} className={row.zone === source ? "tool-hit" : undefined}>
                  <th scope="row">{row.zone.replace(/_/g, " ")}</th>
                  <td className="mono">{row.text}</td>
                  <td>
                    <span className="mono">{formatOffset(row.offset)}</span>
                    {row.summer && <span className="pill pill-todo tool-pill-gap">Sommerzeit</span>}
                  </td>
                  <td className="tool-info-copy">
                    <CopyButton
                      value={`${row.text} (${row.zone})`}
                      label={`${row.zone} kopieren`}
                    />{" "}
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => setZones(zones.filter((zone) => zone !== row.zone))}
                    >
                      Entfernen <span className="visually-hidden">– {row.zone}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="tool-row">
        <ComboField<ComboItem>
          label="Zeitzone hinzufügen"
          placeholder="Stadt oder Region, z. B. Tokyo"
          unit="Zeitzonen"
          search={searchZones}
          value={null}
          onChange={(item) => item && setZones([...zones, String(item.id)])}
        />
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setZones(defaultZones)}
        >
          Standardliste
        </button>
      </div>
      <p className="small">Die Liste der Zeitzonen merkt sich dieser Browser.</p>
    </div>
  );
}
