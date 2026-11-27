import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from "react";
import { errorText, formatDateTime } from "../../api";
import { useConfirm } from "../../components/ConfirmDialog";
import type { FeedbackMessage } from "../../components/Feedback";
import { Field } from "../../components/Field";
import { InfoTip } from "../../components/InfoTip";
import { FixedChoice } from "../../components/ListChoice";
import { Link } from "../../components/Link";
import {
  actOnReview,
  addBlock,
  fetchBlocks,
  fetchIntake,
  fetchMailSettings,
  fetchReview,
  INTAKE_LABELS,
  MAIL_EVENT_LABELS,
  removeBlock,
  saveMailSettings,
  ticketPath,
  TYPE_LABELS,
  type Block,
  type Intake,
  type MailEvent,
  type MailSettings,
  type MailSettingsOut,
  type Review,
} from "./api";

type OnMessage = (message: FeedbackMessage) => void;

const EVENTS: MailEvent[] = ["in_progress", "assignee", "waiting", "solved", "closed"];

function toSettings(data: MailSettingsOut): MailSettings {
  return {
    external_policy: data.external_policy,
    max_attachment_mb: data.max_attachment_mb,
    allowed_types: data.allowed_types,
    processed_days: data.processed_days,
    ignored_days: data.ignored_days,
    intake_log_days: data.intake_log_days,
    review_days: data.review_days,
    reopen_policy: data.reopen_policy,
    reopen_days: data.reopen_days,
    sender_name: data.sender_name,
    header_title: data.header_title,
    signature: data.signature,
    ack_enabled: data.ack_enabled,
    ack_text: data.ack_text,
    mail_events: data.mail_events,
  };
}

function numberField(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** E-Mail-Eingang und Mails an den Melder für einen Bereich. */
// Dateitypen in Gruppen, damit die Liste ruhig bleibt; unbekannte Typen stehen unter „Sonstige“
const TYPE_GROUPS: readonly { label: string; types: readonly string[] }[] = [
  { label: "PDF", types: ["pdf"] },
  { label: "Bilder", types: ["png", "jpg", "gif", "webp"] },
  { label: "Office", types: ["docx", "xlsx", "pptx"] },
  { label: "Text und CSV", types: ["txt", "csv"] },
  { label: "Mails", types: ["eml", "msg"] },
  { label: "ZIP", types: ["zip"] },
];

/**
 * Einstellungen zur E-Mail eines Bereichs. `part="email"`: Eingang, Anhänge, Mails an den
 * Melder, automatische Mails (Reiter „E-Mail“). `part="pflege"`: Löschfristen des Eingangs
 * (Reiter „Pflege“ › Aufbewahrung). Beide speichern dieselben Einstellungen.
 */
export function MailSettingsSection({
  areaId,
  part,
  onMessage,
}: {
  areaId: number;
  part: "email" | "pflege";
  onMessage: OnMessage;
}) {
  const [data, setData] = useState<MailSettingsOut | null>(null);
  const [form, setForm] = useState<MailSettings | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = {
    policy: useId(),
    size: useId(),
    processed: useId(),
    ignored: useId(),
    reopen: useId(),
    reopenDays: useId(),
    sender: useId(),
    title: useId(),
    signature: useId(),
    ack: useId(),
  };

  useEffect(() => {
    let active = true;
    fetchMailSettings(areaId).then(
      (result) => {
        if (active) {
          setData(result);
          setForm(toSettings(result));
        }
      },
      (problem: unknown) =>
        active &&
        setFailed(errorText(problem, "Die Einstellungen zur E-Mail konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [areaId]);

  if (failed) {
    return <p className="hint-box hint-bad">{failed}</p>;
  }
  if (!data || !form) {
    return <p role="status">Wird geladen …</p>;
  }
  const set = <K extends keyof MailSettings>(key: K, value: MailSettings[K]) =>
    setForm({ ...form, [key]: value });
  const groups = [
    ...TYPE_GROUPS.map((g) => ({ ...g, types: g.types.filter((t) => data.all_types.includes(t)) })),
    {
      label: "Sonstige",
      types: data.all_types.filter((t) => !TYPE_GROUPS.some((g) => g.types.includes(t))),
    },
  ].filter((g) => g.types.length > 0);
  const toggleGroup = (types: readonly string[], on: boolean) =>
    set(
      "allowed_types",
      on
        ? [...new Set([...form.allowed_types, ...types])]
        : form.allowed_types.filter((t) => !types.includes(t)),
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    saveMailSettings(areaId, form)
      .then((result) => {
        setData(result);
        setForm(toSettings(result));
        onMessage({
          kind: "status",
          text:
            part === "email"
              ? "Die Einstellungen zur E-Mail wurden gespeichert."
              : "Die Aufbewahrung des Eingangs wurde gespeichert.",
        });
      })
      .catch((problem: unknown) =>
        onMessage({
          kind: "alert",
          text: errorText(problem, "Die Einstellungen konnten nicht gespeichert werden."),
        }),
      )
      .finally(() => setBusy(false));
  };

  const days = (
    key: "processed_days" | "ignored_days" | "intake_log_days" | "review_days",
    label: string,
    min: number,
    max: number,
    fallback: number,
  ) => (
    <Field label={label} hint={`${min} bis ${max} Tage`}>
      {(control) => (
        <span className="input-unit">
          <input
            {...control}
            type="number"
            min={min}
            max={max}
            value={form[key]}
            onChange={(event) => set(key, numberField(event.target.value, fallback))}
          />
          <span>Tagen</span>
        </span>
      )}
    </Field>
  );

  if (part === "pflege") {
    return (
      <form className="settings-form" onSubmit={submit}>
        <h3 className="settings-subhead">Eingang ohne Ticket</h3>
        <div className="form-grid">
          {days("processed_days", "„Verarbeitet“ löschen nach", 1, 365, 30)}
          {days("ignored_days", "„Ignoriert“ löschen nach", 1, 365, 7)}
          {days("intake_log_days", "„Letzte Eingänge“ ohne Ticket löschen nach", 7, 3650, 90)}
          {days("review_days", "„Zu prüfen“ ohne Entscheidung verwerfen nach", 1, 365, 30)}
        </div>
        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? "Wird gespeichert …" : "Aufbewahrung des Eingangs speichern"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="settings-form ticket-mail-form" onSubmit={submit}>
      <section className="panel settings-step" aria-labelledby={ids.policy + "-h"}>
        <div className="panel-head">
          <h2 id={ids.policy + "-h"}>
            <span className="form-step-number" aria-hidden="true">
              1
            </span>
            Eingang
          </h2>
        </div>
        <div className="detail-body">
          <p className="settings-step-hint">
            {data.mailbox ? (
              <>
                Was mit Mails an <span className="mono">{data.mailbox}</span> passiert
                {data.checked_at && ` (zuletzt abgerufen ${formatDateTime(data.checked_at)})`}.
              </>
            ) : (
              "Für diesen Bereich ist noch kein Postfach eingetragen. Das macht die Ticket-Verwaltung."
            )}
          </p>
          {!data.mail_configured && (
            <p className="hint-box">
              Die Anbindung der Postfächer ist noch nicht eingerichtet. Bis dahin entstehen Tickets
              nur von Hand.
            </p>
          )}
          {data.error && <p className="hint-box hint-bad">Letzter Abruf: {data.error}</p>}
          <div className="form-grid">
            <FixedChoice
              label="Externe Absender"
              value={form.external_policy}
              onChange={(value) => set("external_policy", value)}
              options={[
                { value: "accept", label: "annehmen" },
                { value: "review", label: "unbekannte erst prüfen" },
                { value: "reject", label: "ablehnen" },
              ]}
              hint={
                <>
                  {data.internal_domains.length > 0
                    ? `Als intern gelten: ${data.internal_domains.join(", ")}.`
                    : "Es sind keine eigenen Maildomänen eingetragen; alle Absender gelten als intern."}{" "}
                  <InfoTip term="tickets.extern" />
                </>
              }
            />
            <FixedChoice
              label="Antwort auf ein geschlossenes Ticket"
              value={form.reopen_policy}
              onChange={(value) => set("reopen_policy", value)}
              options={[
                { value: "days", label: "wieder öffnen innerhalb einer Frist" },
                { value: "always", label: "immer wieder öffnen" },
                { value: "new", label: "immer neues Ticket" },
              ]}
            />
            {form.reopen_policy === "days" && (
              <Field label="Wieder öffnen innerhalb von" hint="danach neues Ticket">
                {(control) => (
                  <span className="input-unit">
                    <input
                      {...control}
                      type="number"
                      min={0}
                      max={365}
                      value={form.reopen_days}
                      onChange={(event) => set("reopen_days", numberField(event.target.value, 14))}
                    />
                    <span>Tagen</span>
                  </span>
                )}
              </Field>
            )}
          </div>
        </div>
      </section>

      <section className="panel settings-step" aria-labelledby={ids.size + "-h"}>
        <div className="panel-head">
          <h2 id={ids.size + "-h"}>
            <span className="form-step-number" aria-hidden="true">
              2
            </span>
            Anhänge
          </h2>
        </div>
        <div className="detail-body">
          <p className="settings-step-hint">
            Andere Dateitypen übernimmt die Werkbank nicht; der Absender bekommt einen Hinweis.
          </p>
          <div className="form-grid">
            <Field label="Höchstgröße je Anhang">
              {(control) => (
                <span className="input-unit">
                  <input
                    {...control}
                    type="number"
                    min={1}
                    max={50}
                    value={form.max_attachment_mb}
                    onChange={(event) =>
                      set("max_attachment_mb", numberField(event.target.value, 15))
                    }
                  />
                  <span>MB</span>
                </span>
              )}
            </Field>
          </div>
          <fieldset className="settings-checks">
            <legend>Erlaubte Dateitypen</legend>
            {groups.map((g) => {
              const on = g.types.every((t) => form.allowed_types.includes(t));
              const some = !on && g.types.some((t) => form.allowed_types.includes(t));
              return (
                <label key={g.label} className="check-label">
                  <input
                    type="checkbox"
                    checked={on}
                    aria-checked={some ? "mixed" : on}
                    onChange={() => toggleGroup(g.types, !on)}
                  />
                  <span>
                    {g.label}
                    {g.types.length > 1 && (
                      <span className="check-hint">
                        {g.types.map((t) => TYPE_LABELS[t] ?? t).join(", ")}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
        </div>
      </section>

      <section className="panel settings-step" aria-labelledby={ids.sender + "-h"}>
        <div className="panel-head">
          <h2 id={ids.sender + "-h"}>
            <span className="form-step-number" aria-hidden="true">
              3
            </span>
            Mails an den Melder
          </h2>
        </div>
        <div className="detail-body">
          <p className="settings-step-hint">
            Gilt für Antworten und automatische Mails. Leer lassen: Name des Bereichs.
          </p>
          <div className="form-grid">
            <Field label="Absendername">
              {(control) => (
                <input
                  {...control}
                  maxLength={120}
                  value={form.sender_name}
                  onChange={(event) => set("sender_name", event.target.value)}
                />
              )}
            </Field>
            <Field label="Titel in der Kopfzeile">
              {(control) => (
                <input
                  {...control}
                  maxLength={120}
                  value={form.header_title}
                  onChange={(event) => set("header_title", event.target.value)}
                />
              )}
            </Field>
            <Field label="Signatur" wide>
              {(control) => (
                <textarea
                  {...control}
                  rows={3}
                  maxLength={2000}
                  value={form.signature}
                  onChange={(event) => set("signature", event.target.value)}
                />
              )}
            </Field>
          </div>
        </div>
      </section>

      <section className="panel settings-step" aria-labelledby={ids.ack + "-h"}>
        <div className="panel-head">
          <h2 id={ids.ack + "-h"}>
            <span className="form-step-number" aria-hidden="true">
              4
            </span>
            Automatische Mails
          </h2>
          <InfoTip term="tickets.automails" />
        </div>
        <div className="detail-body">
          <p className="settings-step-hint">Gehen nur an den Melder, nie an Beteiligte.</p>
          <fieldset className="settings-checks">
            <legend>Mail an den Melder bei …</legend>
            <label className="check-label">
              <input
                type="checkbox"
                checked={form.ack_enabled}
                onChange={(event) => set("ack_enabled", event.target.checked)}
              />
              <span>
                Eingang
                <span className="check-hint">Bestätigung mit Ticketnummer</span>
              </span>
            </label>
            {EVENTS.map((event) => (
              <label key={event} className="check-label">
                <input
                  type="checkbox"
                  checked={form.mail_events[event]}
                  onChange={(change: ChangeEvent<HTMLInputElement>) =>
                    set("mail_events", { ...form.mail_events, [event]: change.target.checked })
                  }
                />
                {MAIL_EVENT_LABELS[event]}
              </label>
            ))}
          </fieldset>
          {form.ack_enabled && (
            <Field
              label="Text der Eingangsbestätigung"
              hint={`Leer = Vorgabe. Platzhalter {Nr}, {Betreff}, {Name}.`}
            >
              {(control) => (
                <textarea
                  {...control}
                  rows={5}
                  maxLength={4000}
                  placeholder={data.default_ack}
                  value={form.ack_text}
                  onChange={(event) => set("ack_text", event.target.value)}
                />
              )}
            </Field>
          )}
        </div>
      </section>

      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? "Wird gespeichert …" : "E-Mail-Einstellungen speichern"}
        </button>
      </div>
    </form>
  );
}

/** „Zu prüfen“: Mails unbekannter externer Absender. */
export function ReviewSection({ areaId, onMessage }: { areaId: number; onMessage: OnMessage }) {
  const [items, setItems] = useState<Review[] | null>(null);
  const [ask, dialog] = useConfirm();
  useEffect(() => {
    let active = true;
    fetchReview(areaId).then(
      (result) => active && setItems(result),
      () => active && setItems([]),
    );
    return () => {
      active = false;
    };
  }, [areaId]);
  const act = (item: Review, action: "anlegen" | "verwerfen" | "sperren") =>
    actOnReview(areaId, item.id, action)
      .then((result) => {
        setItems(result.items);
        onMessage({
          kind: "status",
          text:
            action === "anlegen"
              ? `Ticket T-${result.ticket_number ?? "?"} wurde angelegt.`
              : action === "sperren"
                ? `${item.sender} ist gesperrt.`
                : "Die Mail wurde verworfen.",
        });
      })
      .catch((problem: unknown) =>
        onMessage({ kind: "alert", text: errorText(problem, "Das hat nicht geklappt.") }),
      );
  if (!items) {
    return <p role="status">Wird geladen …</p>;
  }
  if (items.length === 0) {
    return <p className="small">Keine Mails zu prüfen.</p>;
  }
  return (
    <>
      <ul className="plain ticket-review">
        {items.map((item) => (
          <li key={item.id}>
            <span>
              <strong>{item.subject}</strong>
              <span className="small">
                {" "}
                · {item.sender_name ? `${item.sender_name} <${item.sender}>` : item.sender} ·{" "}
                {formatDateTime(item.received_at)}
              </span>
            </span>
            <span className="actions">
              <button type="button" className="button" onClick={() => void act(item, "anlegen")}>
                Als Ticket anlegen
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() =>
                  ask(
                    {
                      title: "Mail verwerfen?",
                      text: "Die Mail kommt in den Ordner „Ignoriert“ und wird dort nach der eingestellten Frist gelöscht.",
                      action: "Verwerfen",
                    },
                    () => act(item, "verwerfen"),
                  )
                }
              >
                Verwerfen
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() =>
                  ask(
                    {
                      title: `${item.sender} sperren?`,
                      text: "Mails dieses Absenders landen künftig in „Ignoriert“. Du kannst die Sperre in der Sperrliste wieder aufheben.",
                      action: "Sperren",
                    },
                    () => act(item, "sperren"),
                  )
                }
              >
                Absender sperren
              </button>
            </span>
          </li>
        ))}
      </ul>
      {dialog}
    </>
  );
}

/** Sperrliste des Postfachs. */
export function BlocksSection({ areaId, onMessage }: { areaId: number; onMessage: OnMessage }) {
  const [items, setItems] = useState<Block[] | null>(null);
  const [value, setValue] = useState("");
  const inputId = useId();
  const [ask, dialog] = useConfirm();
  useEffect(() => {
    let active = true;
    fetchBlocks(areaId).then(
      (result) => active && setItems(result),
      () => active && setItems([]),
    );
    return () => {
      active = false;
    };
  }, [areaId]);
  const add = (event: FormEvent) => {
    event.preventDefault();
    addBlock(areaId, value)
      .then((result) => {
        setItems(result);
        setValue("");
        onMessage({ kind: "status", text: "Der Absender ist gesperrt." });
      })
      .catch((problem: unknown) =>
        onMessage({
          kind: "alert",
          text: errorText(problem, "Der Absender konnte nicht gesperrt werden."),
        }),
      );
  };
  return (
    <div className="settings-form">
      {items && items.length === 0 && <p className="small">Niemand gesperrt.</p>}
      {items && items.length > 0 && (
        <ul className="plain ticket-blocks">
          {items.map((block) => (
            <li key={block.id}>
              <span className="mono">{block.value}</span>
              <button
                type="button"
                className="row-button"
                aria-label={`Sperre für ${block.value} aufheben`}
                onClick={() =>
                  ask(
                    {
                      title: "Sperre aufheben?",
                      text: `Mails von ${block.value} werden wieder verarbeitet.`,
                      action: "Aufheben",
                    },
                    () =>
                      removeBlock(areaId, block.id)
                        .then((result) => {
                          setItems(result);
                          onMessage({ kind: "status", text: "Die Sperre ist aufgehoben." });
                        })
                        .catch((problem: unknown) =>
                          onMessage({
                            kind: "alert",
                            text: errorText(problem, "Das hat nicht geklappt."),
                          }),
                        ),
                  )
                }
              >
                Aufheben
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="ticket-participant-add" onSubmit={add}>
        <label htmlFor={inputId} className="visually-hidden">
          Mailadresse oder @domain sperren
        </label>
        <input
          id={inputId}
          placeholder="name@example.com oder @example.com"
          maxLength={320}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" className="button" disabled={!value.trim()}>
          Sperren
        </button>
      </form>
      {dialog}
    </div>
  );
}

/** Protokoll „Letzte Eingänge“. */
export function IntakeSection({ areaId }: { areaId: number }) {
  const [items, setItems] = useState<Intake[] | null>(null);
  useEffect(() => {
    let active = true;
    fetchIntake(areaId).then(
      (result) => active && setItems(result),
      () => active && setItems([]),
    );
    return () => {
      active = false;
    };
  }, [areaId]);
  if (!items) {
    return <p role="status">Wird geladen …</p>;
  }
  if (items.length === 0) {
    return <p className="small">Noch keine Mails eingegangen.</p>;
  }
  return (
    <div className="table-wrap card-wrap" tabIndex={0} role="region" aria-label="Letzte Eingänge">
      <table className="table-cards">
        <caption className="visually-hidden">Letzte Eingänge, neueste zuerst</caption>
        <thead>
          <tr>
            <th scope="col">Eingang</th>
            <th scope="col">Absender und Betreff</th>
            <th scope="col">Ergebnis</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={`${item.created_at}-${index}`}>
              <td className="nowrap" data-label="Eingang">
                {formatDateTime(item.created_at)}
              </td>
              <th scope="row">
                {item.subject || "(ohne Betreff)"}
                <span className="small"> · {item.sender || "?"}</span>
              </th>
              <td data-label="Ergebnis">
                {INTAKE_LABELS[item.result] ?? item.result}
                {item.detail && <span className="small"> · {item.detail}</span>}
                {item.ticket_number !== null && (
                  <>
                    {" · "}
                    <Link to={ticketPath(item.ticket_number)}>T-{item.ticket_number}</Link>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
