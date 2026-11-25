import { useEffect, useState, type MouseEvent } from "react";
import { formatDateTime } from "../api";
import { Link } from "../components/Link";
import {
  fetchNotifications,
  markAllRead,
  markRead,
  NOTIFICATION_SETTINGS_PATH,
  safeLink,
  timeAgo,
  type NotificationList,
} from "../notifications";
import { navigate } from "../router";

const ALL = 100;

/** Alle Benachrichtigungen der letzten 90 Tage; eingestellt wird unter Konto › Benachrichtigungen. */
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

      <p>
        Welche Benachrichtigungen du in der Glocke, per Mail, in Teams oder als Push bekommst und
        welcher Ton erklingt, stellst du unter{" "}
        <Link to={NOTIFICATION_SETTINGS_PATH}>Konto › Benachrichtigungen</Link> ein.
      </p>
    </div>
  );
}
