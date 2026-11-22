import { useEffect, useId, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { useConfirm } from "../../components/ConfirmDialog";
import type { FeedbackMessage } from "../../components/Feedback";
import { InfoTip } from "../../components/InfoTip";
import {
  addCategory,
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
      devices_enabled: result.devices_enabled,
      device_kinds: result.device_kinds,
      device_suggest: result.device_suggest,
      device_in_inventory: result.device_in_inventory,
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
        onMessage({ kind: "status", text: "Fristen und Geräte wurden gespeichert." });
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
      <fieldset>
        <legend>
          Geräte
          <InfoTip term="tickets.geraet" />
        </legend>
        <label className="check-label">
          <input
            type="checkbox"
            checked={form.devices_enabled}
            onChange={(event) => set({ devices_enabled: event.target.checked })}
          />{" "}
          Tickets mit Geräten aus dem IT-Bestand verknüpfen
        </label>
        {form.devices_enabled && (
          <>
            <fieldset className="ticket-days">
              <legend>Nur diese Arten (keine Auswahl: alle)</legend>
              {data.kinds.map((kind) => (
                <label key={kind.id} className="check-label">
                  <input
                    type="checkbox"
                    checked={form.device_kinds.includes(kind.id)}
                    onChange={(event) =>
                      set({
                        device_kinds: event.target.checked
                          ? [...form.device_kinds, kind.id]
                          : form.device_kinds.filter((k) => k !== kind.id),
                      })
                    }
                  />{" "}
                  {kind.name}
                </label>
              ))}
            </fieldset>
            <label className="check-label">
              <input
                type="checkbox"
                checked={form.device_suggest}
                onChange={(event) => set({ device_suggest: event.target.checked })}
              />{" "}
              Geräte des Melders vorschlagen
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={form.device_in_inventory}
                onChange={(event) => set({ device_in_inventory: event.target.checked })}
              />{" "}
              Tickets auf der Seite des Geräts im IT-Bestand zeigen
            </label>
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
