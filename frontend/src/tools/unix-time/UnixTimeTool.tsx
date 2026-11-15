import { useEffect, useMemo, useState } from "react";
import {
  excelSerial,
  isoWeek,
  parseTimestamp,
  relativeText,
  unitLabels,
  type Unit,
} from "../lib/time";
import { useToolParams } from "../params";
import { ErrorBox, InfoTable, ToolSection, type InfoRow } from "../ui";

const full = new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeStyle: "long" });
const pad = (value: number) => String(value).padStart(2, "0");
const toLocalInput = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
const UNITS = Object.keys(unitLabels) as Unit[];

export default function UnixTimeTool() {
  const [params, setParams] = useToolParams({ wert: "", einheit: "auto" });
  const input = params.wert;
  const unit = UNITS.find((entry) => entry === params.einheit);
  const [now, setNow] = useState(() => Date.now());
  const [dateInput, setDateInput] = useState(() => toLocalInput(new Date()));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const parsed = useMemo(() => {
    if (!input.trim()) {
      return null;
    }
    try {
      return parseTimestamp(input, unit);
    } catch (caught) {
      return { error: (caught as Error).message };
    }
  }, [input, unit]);

  let rows: InfoRow[] = [];
  if (parsed && "date" in parsed) {
    const date = parsed.date;
    rows = [
      {
        label: "Erkannt als",
        value: unitLabels[parsed.unit] + (parsed.fraction ? ` (${parsed.fraction})` : ""),
        plain: true,
      },
      { label: "Lokal", value: full.format(date), copy: full.format(date), plain: true },
      { label: "UTC (ISO 8601)", value: date.toISOString(), copy: date.toISOString() },
      { label: "RFC 2822", value: date.toUTCString(), copy: date.toUTCString() },
      { label: "Relativ", value: relativeText(date, now), plain: true },
      { label: "Kalenderwoche", value: `KW ${isoWeek(date)}`, plain: true },
      {
        label: "Excel-Wert",
        value: excelSerial(date).toFixed(6),
        copy: excelSerial(date).toFixed(6),
      },
    ];
  }

  const reverse = useMemo((): InfoRow[] | null => {
    const date = new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    const seconds = String(Math.floor(date.getTime() / 1000));
    return [
      { label: "Sekunden", value: seconds, copy: seconds },
      { label: "Millisekunden", value: String(date.getTime()), copy: String(date.getTime()) },
      { label: "UTC (ISO 8601)", value: date.toISOString(), copy: date.toISOString() },
    ];
  }, [dateInput]);

  return (
    <div className="tool-body settings-form">
      <p className="small">
        Jetzt: <span className="mono">{Math.floor(now / 1000)}</span> ·{" "}
        <span className="mono">{new Date(now).toISOString()}</span>
      </p>
      <ToolSection title="Zeitstempel → Datum">
        <div className="tool-row">
          <label className="narrow">
            Zeitstempel
            <input
              type="text"
              className="mono"
              value={input}
              onChange={(event) => setParams({ wert: event.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="narrow">
            Einheit
            <select
              value={unit ?? "auto"}
              onChange={(event) => setParams({ einheit: event.target.value })}
            >
              <option value="auto">automatisch</option>
              {UNITS.map((entry) => (
                <option key={entry} value={entry}>
                  {unitLabels[entry]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {parsed && "error" in parsed && <ErrorBox>{parsed.error}</ErrorBox>}
        {rows.length > 0 && <InfoTable caption="Datum zum Zeitstempel" rows={rows} />}
      </ToolSection>
      <ToolSection title="Datum → Zeitstempel">
        <label className="narrow">
          Datum und Uhrzeit (lokal)
          <input
            type="datetime-local"
            step={1}
            value={dateInput}
            onChange={(event) => setDateInput(event.target.value)}
          />
        </label>
        {reverse && <InfoTable caption="Zeitstempel zum Datum" rows={reverse} />}
      </ToolSection>
    </div>
  );
}
