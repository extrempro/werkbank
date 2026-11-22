import { useEffect, useId, useState, type FormEvent } from "react";
import { errorText, formatDateTime } from "../../api";
import { useConfirm } from "../../components/ConfirmDialog";
import type { FeedbackMessage } from "../../components/Feedback";
import { InfoTip } from "../../components/InfoTip";
import {
  addCategory,
  fetchAreaRetention,
  fetchRetentionDefault,
  previewAreaRetention,
  RETENTION_ACTION_LABELS,
  retentionText,
  saveAreaRetention,
  saveRetentionDefault,
  ticketLabel,
  type AreaRetention,
  type AreaRetentionInput,
  type RetentionAction,
  type RetentionDefault,
  addTemplate,
  deleteTemplate,
  fetchCategories,
  fetchMailSettings,
  fetchTemplates,
  fetchWorkSettings,
  fillTemplate,
  PRIORITY_LABELS,
  saveWorkSettings,
  updateCategory,
  updateTemplate,
  type CategorySetting,
  type Priority,
  type StatusAfter,
  type Template,
  type TemplateInput,
  type WorkSettings,
  type WorkSettingsOut,
} from "./api";

type OnMessage = (message: FeedbackMessage) => void;

const PRIORITIES: Priority[] = ["high", "medium", "low"];
const DAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const failed = (onMessage: OnMessage, text: string) => (problem: unknown) =>
  onMessage({ kind: "alert", text: errorText(problem, text) });

// --- Kategorien ----------------------------------------------------------------------------

export function CategoriesSection({ areaId, onMessage }: { areaId: number; onMessage: OnMessage }) {
  const [items, setItems] = useState<CategorySetting[] | null>(null);
  const [name, setName] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const nameId = useId();
  const priorityId = useId();

  useEffect(() => {
    let active = true;
    fetchCategories(areaId).then(
      (result) => active && setItems(result),
      () => active && setItems([]),
    );
    return () => {
      active = false;
    };
  }, [areaId]);

  const add = (event: FormEvent) => {
    event.preventDefault();
    addCategory(areaId, { name: name.trim(), default_priority: priority, active: true })
      .then((result) => {
        setItems(result);
        setName("");
        onMessage({ kind: "status", text: "Die Kategorie wurde angelegt." });
      })
      .catch(failed(onMessage, "Die Kategorie konnte nicht angelegt werden."));
  };

  const change = (item: CategorySetting, next: Partial<CategorySetting>) =>
    updateCategory(areaId, item.id, {
      name: next.name ?? item.name,
      default_priority: next.default_priority ?? item.default_priority,
      active: next.active ?? item.active,
    })
      .then((result) => {
        setItems(result);
        onMessage({ kind: "status", text: `Die Kategorie „${item.name}“ wurde gespeichert.` });
      })
      .catch(failed(onMessage, "Die Kategorie konnte nicht gespeichert werden."));

  return (
    <div className="settings-form">
      <p className="small">
        Kategorien ordnen Tickets ein und schlagen beim Anlegen eine Priorität vor. Abgeschaltete
        Kategorien bleiben an alten Tickets stehen, lassen sich aber nicht mehr wählen.
        <InfoTip term="tickets.kategorie" />
      </p>
      {items && items.length === 0 && <p className="small">Noch keine Kategorien.</p>}
      {items && items.length > 0 && (
        <ul className="plain ticket-category-list">
          {items.map((item) => (
            <li key={item.id}>
              <span className={item.active ? "" : "muted"}>{item.name}</span>
              <label className="visually-hidden" htmlFor={`${nameId}-p${item.id}`}>
                Priorität für {item.name}
              </label>
              <select
                id={`${nameId}-p${item.id}`}
                value={item.default_priority}
                onChange={(event) =>
                  void change(item, { default_priority: event.target.value as Priority })
                }
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={item.active}
                  onChange={(event) => void change(item, { active: event.target.checked })}
                />{" "}
                aktiv
              </label>
            </li>
          ))}
        </ul>
      )}
      <form className="ticket-participant-add" onSubmit={add}>
        <label htmlFor={nameId} className="visually-hidden">
          Neue Kategorie
        </label>
        <input
          id={nameId}
          placeholder="Neue Kategorie"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <label htmlFor={priorityId} className="visually-hidden">
          Vorgeschlagene Priorität
        </label>
        <select
          id={priorityId}
          value={priority}
          onChange={(event) => setPriority(event.target.value as Priority)}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <button type="submit" className="button" disabled={!name.trim()}>
          Anlegen
        </button>
      </form>
    </div>
  );
}

// --- Fristen und Geräte --------------------------------------------------------------------

/** Minuten seit Mitternacht ↔ „HH:MM“. */
export function toClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function fromClock(value: string, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) {
    return fallback;
  }
  return Math.min(24 * 60, Number(match[1]) * 60 + Number(match[2]));
}

/** Arbeitsstunden als Text für die Eingabe, z. B. 90 → „1,5“. */
function hours(minutes: number): string {
  return String(Math.round((minutes / 60) * 100) / 100).replace(".", ",");
}

function minutesOf(value: string, fallback: number): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 60) : fallback;
}

export function WorkSection({ areaId, onMessage }: { areaId: number; onMessage: OnMessage }) {
  const [data, setData] = useState<WorkSettingsOut | null>(null);
  const [form, setForm] = useState<WorkSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const startId = useId();
  const endId = useId();

  const accept = (result: WorkSettingsOut) => {
    setData(result);
    setForm({
      sla_enabled: result.sla_enabled,
      work_days: result.work_days,
      work_start: result.work_start,
      work_end: result.work_end,
      sla: result.sla,
    });
  };

  useEffect(() => {
    let active = true;
    fetchWorkSettings(areaId).then(
      (result) => active && accept(result),
      (problem: unknown) =>
        active && failed(onMessage, "Die Einstellungen konnten nicht geladen werden.")(problem),
    );
    return () => {
      active = false;
    };
    // onMessage ändert sich nicht inhaltlich
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaId]);

  if (!form || !data) {
    return <p className="small">Wird geladen …</p>;
  }
  const set = (next: Partial<WorkSettings>) => setForm({ ...form, ...next });
  const setSla = (priority: Priority, key: "response_minutes" | "solution_minutes", v: string) =>
    set({
      sla: form.sla.map((row) =>
        row.priority === priority ? { ...row, [key]: minutesOf(v, row[key]) } : row,
      ),
    });
  const timesInvalid = form.sla_enabled && form.work_end <= form.work_start;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    saveWorkSettings(areaId, form)
      .then((result) => {
        accept(result);
        onMessage({ kind: "status", text: "Die Fristen wurden gespeichert." });
      })
      .catch(failed(onMessage, "Die Einstellungen konnten nicht gespeichert werden."))
      .finally(() => setBusy(false));
  };

  return (
    <form className="settings-form" onSubmit={submit}>
      <fieldset>
        <legend>
          Fristen
          <InfoTip term="tickets.frist" />
        </legend>
        <label className="check-label">
          <input
            type="checkbox"
            checked={form.sla_enabled}
            onChange={(event) => set({ sla_enabled: event.target.checked })}
          />{" "}
          Fristen in diesem Bereich verwenden
        </label>
        {!form.sla_enabled && (
          <p className="small">Ohne Fristen erscheint im Bereich nirgends eine Frist.</p>
        )}
        {form.sla_enabled && (
          <>
            <fieldset className="ticket-days">
              <legend>Arbeitstage</legend>
              {DAY_LABELS.map((label, day) => (
                <label key={label} className="check-label">
                  <input
                    type="checkbox"
                    checked={form.work_days.includes(day)}
                    onChange={(event) =>
                      set({
                        work_days: event.target.checked
                          ? [...form.work_days, day].sort()
                          : form.work_days.filter((d) => d !== day),
                      })
                    }
                  />{" "}
                  {label}
                </label>
              ))}
            </fieldset>
            <div className="ticket-reminder-row">
              <label htmlFor={startId}>Arbeitszeit von</label>
              <input
                id={startId}
                type="time"
                value={toClock(form.work_start)}
                onChange={(event) =>
                  set({ work_start: fromClock(event.target.value, form.work_start) })
                }
              />
              <label htmlFor={endId}>bis</label>
              <input
                id={endId}
                type="time"
                value={toClock(form.work_end)}
                aria-invalid={timesInvalid}
                onChange={(event) =>
                  set({ work_end: fromClock(event.target.value, form.work_end) })
                }
              />
            </div>
            {timesInvalid && (
              <p className="small" role="alert">
                Das Ende muss nach dem Beginn liegen.
              </p>
            )}
            <table className="ticket-sla-table">
              <caption className="visually-hidden">Fristen je Priorität in Arbeitsstunden</caption>
              <thead>
                <tr>
                  <th scope="col">Priorität</th>
                  <th scope="col">Erste Reaktion (Std.)</th>
                  <th scope="col">Lösung (Std.)</th>
                </tr>
              </thead>
              <tbody>
                {PRIORITIES.map((p) => {
                  const row = form.sla.find((r) => r.priority === p);
                  if (!row) {
                    return null;
                  }
                  return (
                    <tr key={p}>
                      <th scope="row">{PRIORITY_LABELS[p]}</th>
                      <td>
                        <input
                          aria-label={`Erste Reaktion bei ${PRIORITY_LABELS[p]} in Stunden`}
                          inputMode="decimal"
                          defaultValue={hours(row.response_minutes)}
                          onBlur={(event) => setSla(p, "response_minutes", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Lösung bei ${PRIORITY_LABELS[p]} in Stunden`}
                          inputMode="decimal"
                          defaultValue={hours(row.solution_minutes)}
                          onBlur={(event) => setSla(p, "solution_minutes", event.target.value)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="small">
              Gezählt wird nur Arbeitszeit. Bei „Wartet auf Rückmeldung“ ruht die Frist.
            </p>
          </>
        )}
      </fieldset>
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={busy || timesInvalid}>
          {busy ? "Wird gespeichert …" : "Speichern"}
        </button>
      </div>
    </form>
  );
}

// --- Textbausteine -------------------------------------------------------------------------

const EMPTY_TEMPLATE: TemplateInput = {
  name: "",
  shortcut: "",
  kind: "reply",
  status_after: "",
  body: "",
};

const PREVIEW_VALUES: Record<string, string> = {
  Nr: "T-1042",
  Betreff: "Drucker druckt nicht",
  Name: "Max Muster",
  Vorname: "Max",
  Bearbeiter: "Ina Beispiel",
  Datum: "01.12.2026",
};

export function TemplatesSection({ areaId, onMessage }: { areaId: number; onMessage: OnMessage }) {
  const [items, setItems] = useState<Template[] | null>(null);
  const [signature, setSignature] = useState("");
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<TemplateInput>(EMPTY_TEMPLATE);
  const [ask, dialog] = useConfirm();
  const ids = { name: useId(), shortcut: useId(), kind: useId(), after: useId(), body: useId() };

  useEffect(() => {
    let active = true;
    fetchTemplates(areaId).then(
      (result) => active && setItems(result),
      () => active && setItems([]),
    );
    fetchMailSettings(areaId).then(
      (result) => active && setSignature(result.signature),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [areaId]);

  const startEdit = (item: Template | null) => {
    setEditing(item ? item.id : "new");
    setForm(
      item
        ? {
            name: item.name,
            shortcut: item.shortcut,
            kind: item.kind,
            status_after: item.status_after,
            body: item.body,
          }
        : EMPTY_TEMPLATE,
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = { ...form, status_after: form.kind === "reply" ? form.status_after : "" };
    const request =
      editing === "new" ? addTemplate(areaId, body) : updateTemplate(areaId, Number(editing), body);
    request
      .then((result) => {
        setItems(result);
        setEditing(null);
        onMessage({ kind: "status", text: `Der Textbaustein „${body.name}“ wurde gespeichert.` });
      })
      .catch(failed(onMessage, "Der Textbaustein konnte nicht gespeichert werden."));
  };

  const remove = (item: Template) =>
    ask(
      {
        title: `Textbaustein „${item.name}“ löschen?`,
        text: "Bereits gesendete Antworten bleiben unverändert.",
        action: "Löschen",
      },
      () =>
        deleteTemplate(areaId, item.id)
          .then((result) => {
            setItems(result);
            onMessage({ kind: "status", text: "Der Textbaustein wurde gelöscht." });
          })
          .catch(failed(onMessage, "Der Textbaustein konnte nicht gelöscht werden.")),
    );

  const preview = fillTemplate(form.body, PREVIEW_VALUES);

  return (
    <div className="settings-form">
      <p className="small">
        Im Antwortfeld mit Schrägstrich und Kürzel einfügen. Platzhalter: {"{Nr}"}, {"{Betreff}"},{" "}
        {"{Name}"}, {"{Vorname}"}, {"{Bearbeiter}"}, {"{Datum}"}.
        <InfoTip term="tickets.textbausteine" />
      </p>
      {items && items.length === 0 && <p className="small">Noch keine Textbausteine.</p>}
      {items && items.length > 0 && (
        <ul className="plain ticket-category-list">
          {items.map((item) => (
            <li key={item.id}>
              <span>
                <span className="mono">/{item.shortcut}</span> {item.name}
                <span className="small"> · {item.kind === "reply" ? "Antwort" : "Notiz"}</span>
              </span>
              <span>
                <button type="button" className="row-button" onClick={() => startEdit(item)}>
                  Bearbeiten
                </button>
                <button
                  type="button"
                  className="row-button"
                  aria-label={`Textbaustein ${item.name} löschen`}
                  onClick={() => remove(item)}
                >
                  Löschen
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing === null ? (
        <div className="actions">
          <button type="button" className="button" onClick={() => startEdit(null)}>
            Textbaustein anlegen
          </button>
        </div>
      ) : (
        <form className="ticket-template-form" onSubmit={submit}>
          <label htmlFor={ids.name}>Name</label>
          <input
            id={ids.name}
            required
            maxLength={80}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          <label htmlFor={ids.shortcut}>Kürzel (ohne Schrägstrich)</label>
          <input
            id={ids.shortcut}
            required
            maxLength={30}
            pattern="[a-zA-Z0-9äöüßÄÖÜ_\-]+"
            value={form.shortcut}
            onChange={(event) => setForm({ ...form, shortcut: event.target.value })}
          />
          <label htmlFor={ids.kind}>Art</label>
          <select
            id={ids.kind}
            value={form.kind}
            onChange={(event) =>
              setForm({ ...form, kind: event.target.value as TemplateInput["kind"] })
            }
          >
            <option value="reply">Antwort an den Melder</option>
            <option value="note">Interne Notiz</option>
          </select>
          {form.kind === "reply" && (
            <>
              <label htmlFor={ids.after}>Status danach</label>
              <select
                id={ids.after}
                value={form.status_after}
                onChange={(event) =>
                  setForm({ ...form, status_after: event.target.value as StatusAfter })
                }
              >
                <option value="">unverändert</option>
                <option value="waiting">Wartet auf Rückmeldung</option>
                <option value="solved">Gelöst</option>
              </select>
            </>
          )}
          <label htmlFor={ids.body}>Text</label>
          <textarea
            id={ids.body}
            required
            rows={6}
            maxLength={8000}
            value={form.body}
            onChange={(event) => setForm({ ...form, body: event.target.value })}
          />
          {form.body.trim() && (
            <div className="ticket-template-preview">
              <p className="small">Vorschau mit Beispielwerten</p>
              <div className="ticket-entry-body">
                {preview}
                {form.kind === "reply" && signature.trim() && `\n\n${signature.trim()}`}
              </div>
            </div>
          )}
          <div className="actions">
            <button type="submit" className="button button-primary">
              Speichern
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setEditing(null)}
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}
      {dialog}
    </div>
  );
}

// --- Aufbewahrung --------------------------------------------------------------------------

type Unit = "months" | "years";

/** Monate in Zahl und Einheit für das Formular: 24 → 2 Jahre, 18 → 18 Monate. */
export function splitMonths(months: number): { amount: number; unit: Unit } {
  if (months > 0 && months % 12 === 0) {
    return { amount: months / 12, unit: "years" };
  }
  return { amount: months, unit: "months" };
}

export function joinMonths(amount: number, unit: Unit): number {
  const value = Math.max(0, Math.round(amount));
  return Math.min(1200, unit === "years" ? value * 12 : value);
}

/** Frist und Aktion: Zahl, Einheit, „anonymisieren“ oder „vollständig löschen“. */
function RuleFields({
  months,
  action,
  onChange,
  idPrefix,
}: {
  months: number;
  action: RetentionAction;
  onChange: (months: number, action: RetentionAction) => void;
  idPrefix: string;
}) {
  const start = splitMonths(months || 36);
  const [amount, setAmount] = useState(String(start.amount));
  const [unit, setUnit] = useState<Unit>(start.unit);
  const update = (nextAmount: string, nextUnit: Unit) => {
    setAmount(nextAmount);
    setUnit(nextUnit);
    const parsed = Number(nextAmount);
    if (Number.isFinite(parsed) && parsed > 0) {
      onChange(joinMonths(parsed, nextUnit), action);
    }
  };
  return (
    <div className="ticket-reminder-row">
      <label htmlFor={`${idPrefix}-amount`}>Nach</label>
      <input
        id={`${idPrefix}-amount`}
        type="number"
        min={1}
        max={unit === "years" ? 100 : 1200}
        inputMode="numeric"
        value={amount}
        onChange={(event) => update(event.target.value, unit)}
      />
      <label htmlFor={`${idPrefix}-unit`} className="visually-hidden">
        Einheit
      </label>
      <select
        id={`${idPrefix}-unit`}
        value={unit}
        onChange={(event) => update(amount, event.target.value as Unit)}
      >
        <option value="months">Monaten</option>
        <option value="years">Jahren</option>
      </select>
      <span>ab dem Schließen</span>
      <label htmlFor={`${idPrefix}-action`} className="visually-hidden">
        Was dann passiert
      </label>
      <select
        id={`${idPrefix}-action`}
        value={action}
        onChange={(event) => onChange(months, event.target.value as RetentionAction)}
      >
        <option value="anonymize">anonymisieren</option>
        <option value="delete">vollständig löschen</option>
      </select>
    </div>
  );
}

function ruleText(months: number, action: RetentionAction): string {
  return months > 0
    ? `${retentionText(months)} nach dem Schließen ${RETENTION_ACTION_LABELS[action]}`
    : "aus";
}

/** Vorgabe für alle Bereiche (nur Ticket-Verwaltung). */
export function RetentionDefaultSection({ onMessage }: { onMessage: OnMessage }) {
  const [saved, setSaved] = useState<RetentionDefault | null>(null);
  const [form, setForm] = useState<RetentionDefault | null>(null);
  const [ask, dialog] = useConfirm();
  const idPrefix = useId();

  useEffect(() => {
    let active = true;
    fetchRetentionDefault().then(
      (result) => {
        if (active) {
          setSaved(result);
          setForm(result);
        }
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  if (!form || !saved) {
    return null;
  }
  const on = form.months > 0;
  const changed = form.months !== saved.months || form.action !== saved.action;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    ask(
      {
        title: on ? "Vorgabe der Aufbewahrung speichern?" : "Aufbewahrung ausschalten?",
        text: on
          ? `Gilt für alle Bereiche ohne eigene Regel: Tickets werden ${ruleText(form.months, form.action)}. Der tägliche Lauf führt das aus; das lässt sich nicht rückgängig machen.`
          : "Bereiche ohne eigene Regel löschen dann nichts mehr automatisch.",
        action: "Speichern",
      },
      () =>
        saveRetentionDefault(form)
          .then((result) => {
            setSaved(result);
            setForm(result);
            onMessage({ kind: "status", text: "Die Vorgabe der Aufbewahrung wurde gespeichert." });
          })
          .catch(failed(onMessage, "Die Vorgabe konnte nicht gespeichert werden.")),
    );
  };

  return (
    <section className="panel" aria-labelledby={`${idPrefix}-title`}>
      <div className="panel-head">
        <h2 id={`${idPrefix}-title`}>
          Aufbewahrung (Vorgabe)
          <InfoTip term="tickets.aufbewahrung" />
        </h2>
      </div>
      <form className="detail-body settings-form" onSubmit={submit}>
        <p>
          Gilt für alle Bereiche, die keine eigene Regel haben. Ausgeschaltet wird nichts gelöscht.
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            checked={on}
            onChange={(event) =>
              setForm({ ...form, months: event.target.checked ? saved.months || 36 : 0 })
            }
          />{" "}
          Tickets nach einer Frist anonymisieren oder löschen
        </label>
        {on && (
          <RuleFields
            months={form.months}
            action={form.action}
            idPrefix={idPrefix}
            onChange={(months, action) => setForm({ months, action })}
          />
        )}
        <p className="small">Jetzt gespeichert: {ruleText(saved.months, saved.action)}</p>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={!changed}>
            Speichern
          </button>
        </div>
      </form>
      {dialog}
    </section>
  );
}

/** Aufbewahrung eines Bereichs: Vorgabe übernehmen oder eigene Regel, Vorschau, Läufe. */
export function RetentionSection({ areaId, onMessage }: { areaId: number; onMessage: OnMessage }) {
  const [data, setData] = useState<AreaRetention | null>(null);
  const [form, setForm] = useState<AreaRetentionInput | null>(null);
  const [ask, dialog] = useConfirm();
  const idPrefix = useId();

  const accept = (result: AreaRetention) => {
    setData(result);
    setForm({
      custom: result.custom,
      months: result.custom ? result.months : result.default.months,
      action: result.custom ? result.action : result.default.action,
    });
  };

  useEffect(() => {
    let active = true;
    fetchAreaRetention(areaId).then(
      (result) => active && accept(result),
      (problem: unknown) =>
        active && failed(onMessage, "Die Aufbewahrung konnte nicht geladen werden.")(problem),
    );
    return () => {
      active = false;
    };
    // onMessage ändert sich nicht inhaltlich
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaId]);

  if (!data || !form) {
    return <p className="small">Wird geladen …</p>;
  }

  const store = () =>
    saveAreaRetention(areaId, form)
      .then((result) => {
        accept(result);
        onMessage({ kind: "status", text: "Die Aufbewahrung des Bereichs wurde gespeichert." });
      })
      .catch(failed(onMessage, "Die Aufbewahrung konnte nicht gespeichert werden."));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    previewAreaRetention(areaId, form)
      .then(({ due }) => {
        const months = form.custom ? form.months : data.default.months;
        const action = form.custom ? form.action : data.default.action;
        ask(
          {
            title: "Aufbewahrung speichern?",
            text:
              months > 0
                ? `Tickets werden ${ruleText(months, action)}. Beim nächsten Lauf betroffen: ${due === 1 ? "1 Ticket" : `${due} Tickets`}. Das lässt sich nicht rückgängig machen.`
                : "In diesem Bereich wird dann nichts mehr automatisch gelöscht.",
            action: "Speichern",
          },
          () => void store(),
        );
      })
      .catch(failed(onMessage, "Die Vorschau konnte nicht berechnet werden."));
  };

  return (
    <form className="settings-form" onSubmit={submit}>
      <p className="small">
        Wirksam jetzt: {ruleText(data.effective_months, data.effective_action)}
        {data.custom ? " (eigene Regel)" : " (Vorgabe)"}.
        <InfoTip term="tickets.aufbewahrung" />
      </p>
      <fieldset className="ticket-days">
        <legend className="visually-hidden">Regel</legend>
        <label className="check-label">
          <input
            type="radio"
            name={`${idPrefix}-mode`}
            checked={!form.custom}
            onChange={() => setForm({ ...form, custom: false })}
          />{" "}
          Vorgabe übernehmen ({ruleText(data.default.months, data.default.action)})
        </label>
        <label className="check-label">
          <input
            type="radio"
            name={`${idPrefix}-mode`}
            checked={form.custom}
            onChange={() => setForm({ ...form, custom: true })}
          />{" "}
          Eigene Regel
        </label>
      </fieldset>
      {form.custom && (
        <>
          <label className="check-label">
            <input
              type="checkbox"
              checked={form.months > 0}
              onChange={(event) =>
                setForm({ ...form, months: event.target.checked ? data.months || 36 : 0 })
              }
            />{" "}
            Nach einer Frist anonymisieren oder löschen
          </label>
          {form.months > 0 && (
            <RuleFields
              months={form.months}
              action={form.action}
              idPrefix={idPrefix}
              onChange={(months, action) => setForm({ ...form, months, action })}
            />
          )}
        </>
      )}
      <div className="actions">
        <button type="submit" className="button button-primary">
          Speichern
        </button>
      </div>

      <h3>Beim nächsten Lauf betroffen</h3>
      <p>
        {data.effective_months > 0
          ? data.due === 0
            ? "Keine Tickets."
            : `${data.due === 1 ? "1 Ticket" : `${data.due} Tickets`}: ${data.due_numbers.map(ticketLabel).join(", ")}${data.due > data.due_numbers.length ? " …" : ""}`
          : "Nichts, die Aufbewahrung ist aus."}
      </p>
      <p className="small">
        Ausnahmen: {data.holds}
        {data.holds_expiring.length > 0 &&
          ` · enden in den nächsten 30 Tagen: ${data.holds_expiring.map(ticketLabel).join(", ")}`}
      </p>

      <h3>Letzte Läufe</h3>
      {data.runs.length === 0 ? (
        <p className="small">Noch kein Lauf.</p>
      ) : (
        <ul className="plain ticket-category-list">
          {data.runs.map((run) => (
            <li key={run.started_at}>
              <span>{formatDateTime(run.started_at)}</span>
              <span className="small">
                anonymisiert {run.anonymized} · gelöscht {run.deleted} · Ausnahmen verfallen{" "}
                {run.holds_expired}
              </span>
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </form>
  );
}
