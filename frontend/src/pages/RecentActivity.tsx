import { useEffect, useState, type MouseEvent } from "react";
import { formatDateTime } from "../api";
import { Link } from "../components/Link";
import {
  fetchNotifications,
  markRead,
  NOTIFICATIONS_PATH,
  safeLink,
  timeAgo,
  type NotificationEntry,
} from "../notifications";
import { navigate } from "../router";

/** So viele Meldungen zeigt die Startseite. */
export const RECENT_COUNT = 8;

/** Letzte Aktivitäten: die neuesten Meldungen der Glocke, gelesen oder nicht. */
export function RecentActivity() {
  const [entries, setEntries] = useState<NotificationEntry[] | null>(null);

  useEffect(() => {
    let active = true;
    fetchNotifications(RECENT_COUNT).then((result) => {
      if (active) {
        setEntries(result.entries);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const open = (event: MouseEvent<HTMLAnchorElement>, link: string, id: number) => {
    // Neuer Tab oder Fenster: dem Browser überlassen
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    markRead(id).catch(() => undefined);
    navigate(link);
  };

  return (
    <section className="panel start-activity" aria-labelledby="aktivitaeten-titel">
      <div className="panel-head">
        <h2 id="aktivitaeten-titel">Letzte Aktivitäten</h2>
        <Link to={NOTIFICATIONS_PATH} className="small">
          Alle Benachrichtigungen
        </Link>
      </div>
      {entries === null && (
        // Ohne role="status": Die Aufgaben daneben melden das Laden schon.
        <p className="panel-empty">Wird geladen …</p>
      )}
      {entries !== null && entries.length === 0 && (
        <p className="panel-empty">Noch nichts Neues aus deinen Bereichen.</p>
      )}
      {entries !== null && entries.length > 0 && (
        <ul className="bell-list bell-list-page">
          {entries.map((entry) => (
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
  );
}
