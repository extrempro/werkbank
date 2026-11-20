import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { TASKS_CHANGED } from "../api";
import {
  fetchNotifications,
  markAllRead,
  markRead,
  NOTIFICATIONS_PATH,
  safeLink,
  timeAgo,
  type NotificationList,
} from "../notifications";
import { navigate } from "../router";
import { Icon } from "./Icon";

/** Abstand, in dem die Glocke nachfragt. */
const REFRESH_MS = 5 * 60 * 1000;
const SHOWN = 10;

/** Glocke in der Kopfzeile: Zahl der ungelesenen Benachrichtigungen und die neuesten zum Aufklappen. */
export function NotificationBell({ path }: { path: string }) {
  const [list, setList] = useState<NotificationList | null>(null);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const headingId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const unread = list?.unread ?? 0;

  // Neu laden wie die Aufgaben: Seitenwechsel, Änderung, Rückkehr ins Fenster, alle 5 Minuten.
  useEffect(() => {
    let active = true;
    let round = 0;
    const reload = () => {
      const mine = ++round;
      fetchNotifications(SHOWN).then((result) => {
        if (active && mine === round) {
          setList(result);
        }
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        reload();
      }
    };
    reload();
    window.addEventListener(TASKS_CHANGED, reload);
    document.addEventListener("visibilitychange", onVisible);
    // Installierte App am Handy: Beim Zurückkommen meldet nicht jedes Gerät „visibilitychange“.
    window.addEventListener("pageshow", reload);
    window.addEventListener("focus", reload);
    const timer = window.setInterval(reload, REFRESH_MS);
    return () => {
      active = false;
      window.removeEventListener(TASKS_CHANGED, reload);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", reload);
      window.removeEventListener("focus", reload);
      window.clearInterval(timer);
    };
  }, [path]);

  // Schließen mit Escape oder einem Klick außerhalb
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const go = (event: MouseEvent<HTMLAnchorElement>, target: string, id?: number) => {
    event.preventDefault();
    setOpen(false);
    if (id !== undefined) {
      // Ein Fehler beim Markieren hält den Wechsel nicht auf
      markRead(id).catch(() => undefined);
    }
    navigate(target);
    document.getElementById("inhalt")?.focus();
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
    <div className="bell" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="header-tasks"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={unread > 0 ? `Benachrichtigungen: ${unread} ungelesen` : "Benachrichtigungen"}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="glocke" />
        {unread > 0 && (
          <span className="header-tasks-count" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      <div
        id={panelId}
        className="bell-panel"
        role="region"
        aria-labelledby={headingId}
        hidden={!open}
      >
        <div className="bell-head">
          <h2 id={headingId}>Benachrichtigungen</h2>
          {unread > 0 && (
            <button type="button" className="button button-quiet" onClick={onAllRead}>
              Alle als gelesen
            </button>
          )}
        </div>
        {list && list.entries.length === 0 ? (
          <p className="bell-empty">Keine Benachrichtigungen.</p>
        ) : (
          <ul className="bell-list">
            {(list?.entries ?? []).map((entry) => (
              <li key={entry.id} className={entry.read ? "" : "bell-unread"}>
                <a
                  href={safeLink(entry.link)}
                  onClick={(event) => go(event, safeLink(entry.link), entry.id)}
                >
                  <span className="bell-title">
                    {!entry.read && <span className="visually-hidden">Ungelesen: </span>}
                    {entry.title}
                  </span>
                  <span className="small">
                    {entry.module} · {timeAgo(entry.created_at)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <a
          className="bell-all"
          href={NOTIFICATIONS_PATH}
          onClick={(event) => go(event, NOTIFICATIONS_PATH)}
        >
          Alle anzeigen
        </a>
      </div>
    </div>
  );
}
