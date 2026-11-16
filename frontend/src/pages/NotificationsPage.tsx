import { useEffect, useState, type MouseEvent } from "react";
import { errorText, formatDateTime } from "../api";
import {
  fetchNotifications,
  fetchNotificationSettings,
  groupByModule,
  markAllRead,
  markRead,
  safeLink,
  saveNotificationSettings,
  timeAgo,
  type NotificationKind,
  type NotificationList,
} from "../notifications";
import { navigate } from "../router";

const ALL = 100;

/** Welche Arten die Person bekommt. Vorgabe: alle; jede Änderung wird sofort gespeichert. */
function NotificationSettings() {
  const [kinds, setKinds] = useState<NotificationKind[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetchNotificationSettings().then(
      (result) => active && setKinds(result.kinds),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, []);

  const toggle = (kind: string, enabled: boolean) => {
    if (!kinds) {
      return;
    }
    const before = kinds;
    // Sofort anzeigen; schlägt das Speichern fehl, gilt wieder der alte Stand
    const next = kinds.map((entry) => (entry.kind === kind ? { ...entry, enabled } : entry));
    setKinds(next);
    setBusy(true);
    setMessage(null);
    saveNotificationSettings(next.filter((entry) => !entry.enabled).map((entry) => entry.kind))
      .then((result) => {
        setKinds(result.kinds);
        setMessage({ kind: "status", text: "Gespeichert." });
      })
      .catch((error: unknown) => {
        setKinds(before);
        setMessage({
          kind: "alert",
          text: errorText(error, "Die Einstellung konnte nicht gespeichert werden."),
        });
      })
      .finally(() => setBusy(false));
  };

  return (
    <section className="panel" aria-labelledby="benachrichtigungen-einstellungen">
      <div className="panel-head">
        <h2 id="benachrichtigungen-einstellungen">Was die Glocke meldet</h2>
        <span className="small">gilt für dich</span>
      </div>
      <div className="detail-body settings-form">
        {failed && (
          <p role="alert" className="hint-box hint-bad">
            Die Einstellungen konnten nicht geladen werden.
          </p>
        )}
        {!failed && !kinds && <p role="status">Wird geladen …</p>}
        {kinds && kinds.length === 0 && <p>Für deine Rollen gibt es keine Benachrichtigungen.</p>}
        {kinds &&
          groupByModule(kinds).map(([module, entries]) => (
            <fieldset key={module} className="notify-group">
              <legend>{module}</legend>
              {entries.map((entry) => (
                <label key={entry.kind} className="check-label">
                  <input
                    type="checkbox"
                    className="check"
                    checked={entry.enabled}
                    disabled={busy}
                    onChange={(event) => toggle(entry.kind, event.target.checked)}
                  />
                  {entry.label}
                </label>
              ))}
            </fieldset>
          ))}
        <p className="small">
          Ausgeschaltete Arten erscheinen nicht mehr in der Glocke. Was schon gemeldet wurde, bleibt
          in der Liste.
        </p>
        {message && (
          <p
            role={message.kind}
            className={message.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
          >
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}

/** Alle Benachrichtigungen der letzten 90 Tage und die Einstellungen dazu. */
export function NotificationsPage() {
  const [list, setList] = useState<NotificationList | null>(null);

  useEffect(() => {
    let active = true;
    fetchNotifications(ALL).then((result) => active && setList(result));
    return () => {
      active = false;
    };
  }, []);

  const open = (event: MouseEvent<HTMLAnchorElement>, link: string, id: number) => {
    event.preventDefault();
    markRead(id).catch(() => undefined);
    navigate(link);
  };

  const onAllRead = () => {
    markAllRead().then(
      (result) =>
        setList((current) =>
          current
            ? {
                unread: result.unread,
                entries: current.entries.map((entry) => ({ ...entry, read: true })),
              }
            : current,
        ),
      () => undefined,
    );
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Benachrichtigungen</h1>
        <p className="page-sub">
          Was sich in deinen Bereichen getan hat. Die Werkbank sieht alle fünf Minuten nach und
          bewahrt Benachrichtigungen 90 Tage auf.
        </p>
      </header>

      <section className="panel" aria-labelledby="benachrichtigungen-liste">
        <div className="panel-head">
          <h2 id="benachrichtigungen-liste">Neueste</h2>
          {list && list.unread > 0 && (
            <button type="button" className="button button-quiet" onClick={onAllRead}>
              Alle als gelesen
            </button>
          )}
        </div>
        {!list && (
          <p role="status" className="detail-body">
            Wird geladen …
          </p>
        )}
        {list && list.entries.length === 0 && (
          <p className="detail-body">Keine Benachrichtigungen.</p>
        )}
        {list && list.entries.length > 0 && (
          <ul className="bell-list bell-list-page">
            {list.entries.map((entry) => (
              <li key={entry.id} className={entry.read ? "" : "bell-unread"}>
                <a
                  href={safeLink(entry.link)}
                  onClick={(event) => open(event, safeLink(entry.link), entry.id)}
                >
                  <span className="bell-title">
                    {!entry.read && <span className="visually-hidden">Ungelesen: </span>}
                    {entry.title}
                  </span>
                  <span className="small">
                    {entry.module} ·{" "}
                    <time dateTime={entry.created_at} title={formatDateTime(entry.created_at)}>
                      {timeAgo(entry.created_at)}
                    </time>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <NotificationSettings />
    </div>
  );
}
