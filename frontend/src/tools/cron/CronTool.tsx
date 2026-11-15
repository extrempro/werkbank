import { useMemo, useState } from "react";
import { useToolParams } from "../params";
import { ErrorBox, ToolSection } from "../ui";
import { cronExamples, dayNames, explainCron, nextRuns, parseCron, type Cron } from "./cron";

const format = (utc: boolean) =>
  new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: utc ? "UTC" : undefined,
  });

const FIELDS = ["Minute", "Stunde", "Tag", "Monat", "Wochentag"];

type Result = { cron: Cron; text: string; runs: Date[] } | { error: string };

export default function CronTool() {
  const [params, setParams] = useToolParams({ ausdruck: "0 8 * * 1-5", utc: "0" });
  const expression = params.ausdruck;
  const utc = params.utc === "1";
  // Der Zeitpunkt wird einmal je Seitenaufruf festgehalten.
  const [now] = useState(() => new Date());

  const result = useMemo((): Result => {
    try {
      const cron = parseCron(expression);
      return { cron, text: explainCron(cron), runs: nextRuns(cron, now, 10, utc) };
    } catch (caught) {
      return { error: (caught as Error).message };
    }
  }, [expression, utc, now]);
  const parts = expression.trim().split(/\s+/);
  const names = parts.length === 6 ? ["Sekunde", ...FIELDS] : FIELDS;

  return (
    <div className="tool-body settings-form">
      <div className="tool-field">
        <label>
          Cron-Ausdruck
          <input
            type="text"
            className="mono"
            autoComplete="off"
            spellCheck={false}
            value={expression}
            onChange={(event) => setParams({ ausdruck: event.target.value })}
          />
        </label>
        <p className="small">Auch eine ganze Zeile aus der crontab.</p>
        {!expression.startsWith("@") && parts.length >= 5 && (
          <p className="small">
            {names.map((name, index) => (
              <span key={name} className="cron-part">
                <span className="mono">{parts[index]}</span> {name}
              </span>
            ))}
          </p>
        )}
      </div>
      <div className="chips" role="group" aria-label="Beispiele">
        {cronExamples.map((example) => (
          <button
            key={example.expr}
            type="button"
            className="chip"
            onClick={() => setParams({ ausdruck: example.expr })}
          >
            <span className="mono">{example.expr}</span> · {example.label}
          </button>
        ))}
      </div>
      {"error" in result && <ErrorBox>{result.error}</ErrorBox>}
      {"cron" in result && (
        <>
          <p className="tool-result tool-result-title" role="status">
            {result.text}
          </p>
          {!result.cron.reboot && (
            <ToolSection title="Nächste Ausführungen">
              <label className="check-label">
                <input
                  type="checkbox"
                  className="check"
                  checked={utc}
                  onChange={(event) => setParams({ utc: event.target.checked ? "1" : "0" })}
                />
                Server läuft in UTC (sonst Zeitzone dieses Browsers)
              </label>
              <ol className="tool-list mono" aria-label="Nächste Ausführungen">
                {result.runs.map((run) => (
                  <li key={run.getTime()}>{format(utc).format(run)}</li>
                ))}
              </ol>
              {!result.cron.dom.any && !result.cron.dow.any && (
                <p className="small">
                  Tag und Wochentag sind beide gesetzt: cron führt aus, wenn <strong>einer</strong>{" "}
                  von beiden passt (nicht beide).
                </p>
              )}
            </ToolSection>
          )}
          <p className="small">
            Wochentage: {dayNames.map((day, index) => `${index}=${day.slice(0, 2)}`).join(", ")},
            7=So
          </p>
        </>
      )}
    </div>
  );
}
