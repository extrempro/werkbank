import { useEffect, useRef, useState } from "react";
import { errorText, formatDateTime } from "../../../api";
import { ConfirmButton, useConfirm } from "../../../components/ConfirmDialog";
import { Feedback, type FeedbackMessage } from "../../../components/Feedback";
import { ChoiceCards, Field } from "../../../components/Field";
import { FilterBar } from "../../../components/FilterBar";
import { InfoTip } from "../../../components/InfoTip";
import { Link } from "../../../components/Link";
import { replaceParams } from "./params";
import { useSearchParam } from "../../../router";
import {
  createFgException,
  deleteFgException,
  fetchFgFindings,
  findingsCsvUrl,
  type FgFinding,
  type FgFindingFilter,
  type FgFindings,
  type FgSeverity,
} from "./api";

/* IT-Monitoring › FortiGate › Befunde: Prüfregeln über alle Geräte, mit Ausnahmen. */

export const SEVERITY_LABELS: Record<FgSeverity, string> = {
  hoch: "Hoch",
  mittel: "Mittel",
  hinweis: "Hinweis",
};
export const SEVERITY_CLASS: Record<FgSeverity, string> = {
  hoch: "pill pill-bad",
  mittel: "pill pill-todo",
  hinweis: "pill pill-info",
};
const SEVERITIES: FgSeverity[] = ["hoch", "mittel", "hinweis"];
type Duration = "6" | "12" | "0";
const DURATIONS: { value: Duration; label: string; hint?: string }[] = [
  { value: "6", label: "6 Monate" },
  { value: "12", label: "12 Monate" },
  { value: "0", label: "unbegrenzt", hint: "bis sich der Gegenstand ändert" },
];

export function SeverityPill({ severity }: { severity: FgSeverity }) {
  return <span className={SEVERITY_CLASS[severity]}>{SEVERITY_LABELS[severity]}</span>;
}

function initial(name: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? "";
}

export function FortigateFindingsPage() {
  const [filter, setFilter] = useState<FgFindingFilter>(() => ({
    severity: initial("stufe"),
    device: initial("geraet"),
    code: initial("regel"),
    excepted: initial("ausnahmen") === "1",
  }));
  const [data, setData] = useState<FgFindings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  const [reload, setReload] = useState(0);
  const selected = useSearchParam("auswahl");
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    fetchFgFindings(filter).then(
      (value) => {
        if (active) {
          setData(value);
          setError(null);
        }
      },
      (caught: unknown) =>
        active && setError(errorText(caught, "Die Befunde konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [filter, reload]);

  const change = (next: Partial<FgFindingFilter>) => {
    setFilter((current) => ({ ...current, ...next }));
    replaceParams({ auswahl: "" });
  };
  const rows = data?.rows ?? [];
  const current = rows.find((row) => row.key === selected) ?? null;
  const moreActive = [filter.device, filter.code].filter(Boolean).length;
  const total = data ? SEVERITIES.reduce((sum, key) => sum + data.counts[key], 0) : null;

  const choose = (row: FgFinding) => {
    replaceParams({ auswahl: row.key });
    window.setTimeout(() => {
      if (detailRef.current && window.matchMedia?.("(max-width: 1023px)").matches) {
        detailRef.current.scrollIntoView({ block: "start" });
      }
    }, 0);
  };
  const done = (text: string) => {
    setMessage({ kind: "status", text });
    replaceParams({ auswahl: "" });
    setReload((value) => value + 1);
  };

  return (
    <div className="page page-wide fg-page">
      <header className="page-head fg-head">
        <div>
          <p className="module-label">IT-Monitoring · FortiGate</p>
          <h1>Befunde</h1>
          <p className="page-sub">
            Was die Prüfregeln in den Policies und Objekten aller Geräte finden. Bewusst
            hingenommene Befunde stehen als Ausnahme mit Begründung und Frist.
          </p>
        </div>
        <div className="fg-head-actions">
          <a className="button button-secondary" href={findingsCsvUrl(filter)} download>
            CSV exportieren
          </a>
        </div>
      </header>
      <FilterBar<string>
        status={{
          label: "Stufe",
          value: filter.severity,
          onChange: (value) => change({ severity: value }),
          options: [
            { value: "", label: "Alle", count: total },
            ...SEVERITIES.map((value) => ({
              value,
              label: SEVERITY_LABELS[value],
              count: data ? data.counts[value] : null,
            })),
          ],
        }}
        moreActive={moreActive}
        onReset={
          moreActive || filter.severity
            ? () => change({ device: "", code: "", severity: "" })
            : undefined
        }
        more={
          <>
            <label className="filter-field">
              Gerät
              <select
                value={filter.device}
                onChange={(event) => change({ device: event.target.value })}
              >
                <option value="">Alle Geräte</option>
                {(data?.devices ?? []).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              Regel
              <select
                value={filter.code}
                onChange={(event) => change({ code: event.target.value })}
              >
                <option value="">Alle Regeln</option>
                {(data?.rules ?? []).map((rule) => (
                  <option key={rule.code} value={rule.code}>
                    {rule.title}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      />
      <div className="fg-switches">
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={filter.excepted}
            onChange={(event) => change({ excepted: event.target.checked })}
          />
          Ausnahmen zeigen{data ? ` (${data.excepted})` : ""}
        </label>
        <InfoTip term="fortigate.ausnahme" />
      </div>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {data && (
        <p className="small fg-count" role="status">
          {filter.excepted
            ? `${rows.length} ${rows.length === 1 ? "Ausnahme" : "Ausnahmen"}`
            : `${rows.length} ${rows.length === 1 ? "Befund" : "Befunde"}`}
          {data.rules.some((rule) => !rule.active) &&
            " · einige Regeln sind in der Verwaltung abgeschaltet"}
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      <div className="fg-layout">
        <div className="fg-list">
          {data && rows.length === 0 && (
            <p className="empty">
              {filter.excepted
                ? "Keine Ausnahme passt zur Auswahl."
                : "Kein Befund passt zur Auswahl."}
            </p>
          )}
          {rows.length > 0 && (
            <div className="table-wrap card-wrap">
              <table className="table-cards fg-table" aria-label="Befunde">
                <thead>
                  <tr>
                    <th scope="col">
                      Stufe <InfoTip term="fortigate.befund-stufe" />
                    </th>
                    <th scope="col">Befund</th>
                    <th scope="col">Gerät</th>
                    <th scope="col">Gegenstand</th>
                    <th scope="col">Seit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isSelected = row.key === selected;
                    return (
                      <tr key={row.key} className={isSelected ? "is-selected" : undefined}>
                        <td data-label="Stufe">
                          <SeverityPill severity={row.severity} />
                        </td>
                        <th scope="row">
                          <button
                            type="button"
                            className="button-link fg-pick"
                            aria-pressed={isSelected}
                            onClick={() => choose(row)}
                          >
                            {row.rule}
                          </button>
                          <span className="fg-sub">{row.detail}</span>
                        </th>
                        <td data-label="Gerät">{row.device || "alle Geräte"}</td>
                        <td data-label="Gegenstand">{row.label}</td>
                        <td data-label="Seit">{row.since ? formatDateTime(row.since) : "–"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <aside ref={detailRef} className="panel fg-detail" aria-label="Detail des Befunds">
          {current ? (
            <FindingDetail
              key={current.key}
              row={current}
              description={
                data?.rules.find((rule) => rule.code === current.code)?.description ?? ""
              }
              canExcept={Boolean(data?.can_except)}
              onDone={done}
              onError={(text) => setMessage({ kind: "alert", text })}
            />
          ) : (
            <p className="small fg-detail-empty">
              Wähle einen Befund aus der Liste, um ihn zu prüfen
              {data?.can_except ? " oder als Ausnahme hinzunehmen" : ""}.
            </p>
          )}
        </aside>
      </div>
      <Feedback message={message} onClose={() => setMessage(null)} />
    </div>
  );
}

function FindingDetail({
  row,
  description,
  canExcept,
  onDone,
  onError,
}: {
  row: FgFinding;
  description: string;
  canExcept: boolean;
  onDone: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState<Duration>("12");
  const [problem, setProblem] = useState<string | null>(null);
  const [ask, dialog] = useConfirm();

  const submit = () => {
    if (reason.trim().length < 3) {
      setProblem("Bitte gib eine Begründung an (mindestens drei Zeichen).");
      return;
    }
    setProblem(null);
    const label = DURATIONS.find((entry) => entry.value === duration)?.label ?? "";
    ask(
      {
        title: "Befund als Ausnahme hinnehmen?",
        text: `Der Befund erscheint dann nicht mehr in der Liste (${label}). Ändert sich der Gegenstand, gilt die Ausnahme nicht mehr.`,
        action: "Hinnehmen",
      },
      () =>
        createFgException(row.key, reason.trim(), Number(duration) as 0 | 6 | 12).then(
          () => onDone("Der Befund ist als Ausnahme hingenommen."),
          (caught: unknown) =>
            onError(errorText(caught, "Die Ausnahme konnte nicht gespeichert werden.")),
        ),
    );
  };

  return (
    <div className="detail-body fg-detail-body">
      <p className="small fg-sub">
        <SeverityPill severity={row.severity} /> {row.device || "alle Geräte"}
      </p>
      <h2 className="fg-detail-title">{row.rule}</h2>
      <dl className="facts">
        <div>
          <dt>Gegenstand</dt>
          <dd>
            {row.label}
            <span className="fg-sub">
              <Link to={row.link}>
                {row.policy_id !== null
                  ? "Policy ansehen"
                  : row.code === "unused_objects"
                    ? "Unbenutzte Objekte ansehen"
                    : "Objekt ansehen"}
              </Link>
            </span>
          </dd>
        </div>
        <div>
          <dt>Was gefunden wurde</dt>
          <dd>{row.detail}</dd>
        </div>
        <div>
          <dt>Regel</dt>
          <dd>{description}</dd>
        </div>
        <div>
          <dt>Seit</dt>
          <dd>{row.since ? formatDateTime(row.since) : "–"}</dd>
        </div>
        {row.exception && (
          <div>
            <dt>Ausnahme</dt>
            <dd>
              {row.exception.reason}
              <span className="fg-sub">
                {row.exception.expires_at
                  ? `gilt bis ${formatDateTime(row.exception.expires_at)}`
                  : "unbegrenzt, bis sich der Gegenstand ändert"}
                {row.exception.created_by ? ` · von ${row.exception.created_by}` : ""} · am{" "}
                {formatDateTime(row.exception.created_at)}
              </span>
            </dd>
          </div>
        )}
      </dl>
      {canExcept && row.exception && (
        <ConfirmButton
          className="button button-secondary"
          confirm={{
            title: "Ausnahme aufheben?",
            text: "Der Befund erscheint dann wieder in der Liste.",
            action: "Aufheben",
          }}
          onConfirm={() =>
            deleteFgException(row.exception!.id).then(
              () => onDone("Die Ausnahme ist aufgehoben."),
              (caught: unknown) =>
                onError(errorText(caught, "Die Ausnahme konnte nicht aufgehoben werden.")),
            )
          }
        >
          Ausnahme aufheben
        </ConfirmButton>
      )}
      {canExcept && !row.exception && (
        <form
          className="fg-exception"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <h3>Als Ausnahme hinnehmen</h3>
          <Field
            label="Begründung"
            required
            error={problem}
            hint="Warum ist das so gewollt? Steht im Audit."
          >
            {(control) => (
              <textarea
                {...control}
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>
          <ChoiceCards<Duration>
            legend="Gültig"
            value={duration}
            options={DURATIONS}
            onChange={setDuration}
          />
          <button type="submit" className="button button-primary">
            Als Ausnahme hinnehmen
          </button>
        </form>
      )}
      <p className="small fg-muted">Nur ansehen: Die Werkbank ändert nichts an den FortiGates.</p>
      {dialog}
    </div>
  );
}
