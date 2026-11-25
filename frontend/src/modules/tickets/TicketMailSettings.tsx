import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from "react";
import { errorText, formatDateTime } from "../../api";
import { useConfirm } from "../../components/ConfirmDialog";
import type { FeedbackMessage } from "../../components/Feedback";
import { InfoTip } from "../../components/InfoTip";
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
export function MailSettingsSection({
  areaId,
  onMessage,
}: {
  areaId: number;
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
  const toggleType = (type: string) =>
    set(
      "allowed_types",
      form.allowed_types.includes(type)
        ? form.allowed_types.filter((t) => t !== type)
        : [...form.allowed_types, type],
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    saveMailSettings(areaId, form)
      .then((result) => {
        setData(result);
        setForm(toSettings(result));
        onMessage({ kind: "status", text: "Die Einstellungen zur E-Mail wurden gespeichert." });
      })
      .catch((problem: unknown) =>
        onMessage({
          kind: "alert",
          text: errorText(problem, "Die Einstellungen konnten nicht gespeichert werden."),
        }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <form className="settings-form ticket-mail-form" onSubmit={submit}>
      {!data.mailbox && (
        <p className="hint-box">
          Für diesen Bereich ist noch kein Postfach eingetragen. Das macht die Ticket-Verwaltung.
        </p>
      )}
      {data.mailbox && (
        <p>
          Postfach: <span className="mono">{data.mailbox}</span>
          {data.checked_at && ` · zuletzt abgerufen ${formatDateTime(data.checked_at)}`}
        </p>
      )}
      {!data.mail_configured && (
        <p className="hint-box">
          Die Anbindung der Postfächer ist noch nicht eingerichtet. Bis dahin entstehen Tickets nur
          von Hand.
        </p>
      )}
      {data.error && <p className="hint-box hint-bad">Letzter Abruf: {data.error}</p>}

      <h4>E-Mail-Eingang</h4>
      <div className="form-grid">
        <label htmlFor={ids.policy}>
          <span>
            Externe Absender
            <InfoTip term="tickets.extern" />
          </span>
          <select
            id={ids.policy}
            value={form.external_policy}
            onChange={(event) =>
              set("external_policy", event.target.value as MailSettings["external_policy"])
            }
          >
            <option value="accept">annehmen</option>
            <option value="review">unbekannte erst prüfen</option>
            <option value="reject">ablehnen</option>
          </select>
        </label>
        <label htmlFor={ids.reopen}>
          Antwort auf ein geschlossenes Ticket
          <select
            id={ids.reopen}
            value={form.reopen_policy}
            onChange={(event) =>
              set("reopen_policy", event.target.value as MailSettings["reopen_policy"])
            }
          >
            <option value="days">wieder öffnen innerhalb von … Tagen, danach neues Ticket</option>
            <option value="always">immer wieder öffnen</option>
            <option value="new">immer neues Ticket</option>
          </select>
        </label>
        {form.reopen_policy === "days" && (
          <label htmlFor={ids.reopenDays}>
            Tage zum Wiederöffnen
            <input
              id={ids.reopenDays}
              type="number"
              min={0}
              max={365}
              value={form.reopen_days}
              onChange={(event) => set("reopen_days", numberField(event.target.value, 14))}
            />
          </label>
        )}
      </div>
      {data.internal_domains.length > 0 ? (
        <p className="small">Als intern gelten: {data.internal_domains.join(", ")}</p>
      ) : (
        <p className="small">
          Es sind keine eigenen Maildomänen eingetragen; alle Absender gelten als intern.
        </p>
      )}
      <div className="form-grid">
        <label htmlFor={ids.size}>
          Höchstgröße je Anhang (MB)
          <input
            id={ids.size}
            type="number"
            min={1}
            max={50}
            value={form.max_attachment_mb}
            onChange={(event) => set("max_attachment_mb", numberField(event.target.value, 15))}
          />
        </label>
        <label htmlFor={ids.processed}>
          „Verarbeitet“ löschen nach (Tagen)
          <input
            id={ids.processed}
            type="number"
            min={1}
            max={365}
            value={form.processed_days}
            onChange={(event) => set("processed_days", numberField(event.target.value, 30))}
          />
        </label>
        <label htmlFor={ids.ignored}>
          „Ignoriert“ löschen nach (Tagen)
          <input
            id={ids.ignored}
            type="number"
            min={1}
            max={365}
            value={form.ignored_days}
            onChange={(event) => set("ignored_days", numberField(event.target.value, 7))}
          />
        </label>
        <label htmlFor={`${ids.ignored}-log`}>
          „Letzte Eingänge“ ohne Ticket löschen nach (Tagen)
          <input
            id={`${ids.ignored}-log`}
            type="number"
            min={7}
            max={3650}
            value={form.intake_log_days}
            onChange={(event) => set("intake_log_days", numberField(event.target.value, 90))}
          />
        </label>
        <label htmlFor={`${ids.ignored}-review`}>
          „Zu prüfen“ verwerfen nach (Tagen ohne Entscheidung)
          <input
            id={`${ids.ignored}-review`}
            type="number"
            min={1}
            max={365}
            value={form.review_days}
            onChange={(event) => set("review_days", numberField(event.target.value, 30))}
          />
        </label>
      </div>
      <fieldset className="ticket-types">
        <legend>Erlaubte Dateitypen für Anhänge</legend>
        {data.all_types.map((type) => (
          <label key={type} className="check-label">
            <input
              type="checkbox"
              checked={form.allowed_types.includes(type)}
              onChange={() => toggleType(type)}
            />
            {TYPE_LABELS[type] ?? type}
          </label>
        ))}
      </fieldset>

      <h4>Mails an den Melder</h4>
      <div className="form-grid">
        <label htmlFor={ids.sender}>
          Absendername
          <input
            id={ids.sender}
            maxLength={120}
            value={form.sender_name}
            onChange={(event) => set("sender_name", event.target.value)}
          />
        </label>
        <label htmlFor={ids.title}>
          Titel in der Kopfzeile
          <input
            id={ids.title}
            maxLength={120}
            value={form.header_title}
            onChange={(event) => set("header_title", event.target.value)}
          />
        </label>
      </div>
      <label htmlFor={ids.signature}>
        Signatur
        <textarea
          id={ids.signature}
          rows={3}
          maxLength={2000}
          value={form.signature}
          onChange={(event) => set("signature", event.target.value)}
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={form.ack_enabled}
          onChange={(event) => set("ack_enabled", event.target.checked)}
        />
        Eingangsbestätigung senden
      </label>
      {form.ack_enabled && (
        <label htmlFor={ids.ack}>
          <span>
            Text der Eingangsbestätigung (leer = Vorgabe; Platzhalter {"{Nr}"}, {"{Betreff}"},{" "}
            {"{Name}"})
          </span>
          <textarea
            id={ids.ack}
            rows={5}
            maxLength={4000}
            placeholder={data.default_ack}
            value={form.ack_text}
            onChange={(event) => set("ack_text", event.target.value)}
          />
        </label>
      )}
      <fieldset className="ticket-events">
        <legend>
          Automatische Mails
          <InfoTip term="tickets.automails" />
        </legend>
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
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? "Wird gespeichert …" : "Mail-Einstellungen speichern"}
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
