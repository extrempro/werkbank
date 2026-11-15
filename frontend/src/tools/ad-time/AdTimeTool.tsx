import { useMemo, useState } from "react";
import { useToolParams } from "../params";
import { ErrorBox, InfoTable, ToolSection, type InfoRow } from "../ui";
import { dateToFileTime, dateToGeneralizedTime, parseAdTime, relativeTime } from "./ad-time";

const localFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeStyle: "medium" });
const pad = (value: number) => String(value).padStart(2, "0");
const toLocalInput = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

export default function AdTimeTool() {
  const [params, setParams] = useToolParams({ wert: "" });
  const input = params.wert;
  const [dateInput, setDateInput] = useState(() => toLocalInput(new Date()));

  const parsed = useMemo(() => {
    if (!input.trim()) {
      return null;
    }
    try {
      return parseAdTime(input);
    } catch (caught) {
      return { error: (caught as Error).message };
    }
  }, [input]);

  const rows: InfoRow[] = [];
  if (parsed && !("error" in parsed)) {
    if (parsed.date) {
      const iso = parsed.date.toISOString();
      const local = localFormat.format(parsed.date);
      const unix = String(Math.floor(parsed.date.getTime() / 1000));
      const generalized = dateToGeneralizedTime(parsed.date);
      rows.push(
        { label: "Lokale Zeit", value: local, copy: local, plain: true },
        { label: "UTC (ISO 8601)", value: iso, copy: iso },
        { label: "Relativ", value: relativeTime(parsed.date), plain: true },
        { label: "Unix-Zeit (s)", value: unix, copy: unix },
        { label: "Generalized Time", value: generalized, copy: generalized },
      );
    }
    if (parsed.filetime !== undefined) {
      const filetime = parsed.filetime.toString();
      rows.push({ label: "FILETIME", value: filetime, copy: filetime });
    }
  }

  const reverse = useMemo(() => {
    const date = new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return { filetime: dateToFileTime(date).toString(), generalized: dateToGeneralizedTime(date) };
  }, [dateInput]);

  return (
    <div className="tool-body settings-form">
      <ToolSection title="AD-Wert → Datum">
        <div className="tool-field">
          <label>
            AD-Wert
            <input
              type="text"
              className="mono"
              autoComplete="off"
              spellCheck={false}
              value={input}
              placeholder="133485408000000000"
              onChange={(event) => setParams({ wert: event.target.value })}
            />
          </label>
          <p className="small">
            FILETIME (z. B. 133485408000000000) oder Generalized Time (z. B. 20231015123045.0Z).
          </p>
        </div>
        {parsed && "error" in parsed && <ErrorBox>{parsed.error}</ErrorBox>}
        {parsed && !("error" in parsed) && parsed.special && (
          <p className="hint-box hint-neutral" role="status">
            {parsed.special}
          </p>
        )}
        {rows.length > 0 && <InfoTable caption="Datum zum AD-Wert" rows={rows} />}
        <p className="small">
          <span className="mono">lastLogonTimestamp</span> wird nur alle 9 bis 14 Tage repliziert.
          Für die genaue letzte Anmeldung <span className="mono">lastLogon</span> auf allen
          Domänencontrollern abfragen.
        </p>
      </ToolSection>

      <ToolSection title="Datum → AD-Wert">
        <label className="narrow">
          Datum und Uhrzeit (lokal)
          <input
            type="datetime-local"
            value={dateInput}
            onChange={(event) => setDateInput(event.target.value)}
          />
        </label>
        {reverse && (
          <InfoTable
            caption="AD-Wert zum Datum"
            rows={[
              { label: "FILETIME", value: reverse.filetime, copy: reverse.filetime },
              { label: "Generalized Time", value: reverse.generalized, copy: reverse.generalized },
              {
                label: "LDAP-Filter (Beispiel)",
                value: `(lastLogonTimestamp<=${reverse.filetime})`,
                copy: `(lastLogonTimestamp<=${reverse.filetime})`,
              },
            ]}
          />
        )}
      </ToolSection>
    </div>
  );
}
