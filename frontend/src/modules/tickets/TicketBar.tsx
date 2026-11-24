import { useEffect, useId, useState, type MouseEvent, type ReactNode } from "react";
import { TASKS_CHANGED } from "../../api";
import { useConfirm } from "../../components/ConfirmDialog";
import { Icon } from "../../components/Icon";
import { readGroups, saveGroups } from "../../components/nav/SideMenu";
import { STATUS_LABELS, ticketLabel, ticketPath } from "./api";
import { STATUS_PILLS } from "./TicketsPage";
import {
  clearBar,
  DOT_LABELS,
  dotKind,
  loadTicketBar,
  removeFromBar,
  setFavorite,
  useTicketBar,
  type BarTicket,
  type DotKind,
} from "./ticketBar";

const GROUP_KEYS = { favoriten: "tickets-favoriten", geoeffnet: "tickets-geoeffnet" } as const;

interface TicketBarProps {
  /** Nummer des gerade offenen Tickets (hervorgehoben). */
  activeNumber: number | null;
  /** „side“: Seitenleiste am PC und Tablet, „sheet“: Menü-Blatt am Handy. */
  variant: "side" | "sheet";
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void;
}

/**
 * Gruppen „Favoriten“ und „Geöffnet“ unter „Neues Ticket“. Reihenfolge des ersten Öffnens; der
 * Stern hält ein Ticket fest, das X nimmt es aus der Liste. Aufgeklappt oder zu gilt je Browser.
 */
export function TicketBar({ activeNumber, variant, onNavigate }: TicketBarProps) {
  const bar = useTicketBar();
  const [stored, setStored] = useState(readGroups);
  const [ask, dialog] = useConfirm();
  const baseId = useId();

  // Laden beim Start; neu nach Änderungen an Tickets (Status) und beim Zurückkommen ins Fenster
  useEffect(() => {
    const reload = () => void loadTicketBar();
    reload();
    window.addEventListener(TASKS_CHANGED, reload);
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener(TASKS_CHANGED, reload);
      window.removeEventListener("focus", reload);
    };
  }, []);

  const isOpen = (key: string) => stored[key] ?? true;
  const toggle = (key: string) => {
    const next = { ...stored, [key]: !isOpen(key) };
    setStored(next);
    saveGroups(next);
  };

  const row = (ticket: BarTicket, favorite: boolean) => {
    const label = `${ticketLabel(ticket.number)} · ${ticket.subject}`;
    const kind = dotKind(ticket.status);
    const status = STATUS_LABELS[ticket.status];
    return (
      <li className="ticket-bar-item" key={ticket.number}>
        <a
          href={ticketPath(ticket.number)}
          aria-current={ticket.number === activeNumber ? "page" : undefined}
          title={bar.compact ? `${label} (${status})` : label}
          onClick={(event) => onNavigate(event, ticketPath(ticket.number))}
        >
          {bar.compact && <span className={`ticket-dot ticket-dot-${kind}`} aria-hidden="true" />}
          <span className="ticket-bar-text">
            <span className="ticket-bar-subject">{label}</span>
            {bar.compact ? (
              <span className="visually-hidden">, {status}</span>
            ) : (
              <>
                {" "}
                <span className={STATUS_PILLS[ticket.status]}>{status}</span>
              </>
            )}
          </span>
        </a>
        <button
          type="button"
          className={favorite ? "ticket-bar-button pin-on" : "ticket-bar-button"}
          aria-pressed={favorite}
          aria-label={`${ticketLabel(ticket.number)} als Favorit`}
          title={favorite ? "Favorit entfernen" : "Als Favorit markieren"}
          onClick={() => void setFavorite(ticket.number, !favorite)}
        >
          <Icon name="stern" filled={favorite} />
        </button>
        <button
          type="button"
          className="ticket-bar-button"
          aria-label={`${ticketLabel(ticket.number)} aus der Liste nehmen`}
          title="Aus der Liste nehmen"
          onClick={() => void removeFromBar(ticket.number)}
        >
          <Icon name="schliessen" />
        </button>
      </li>
    );
  };

  const kinds = [...bar.favorites, ...bar.recent].map((t) => dotKind(t.status));
  const legend = (Object.keys(DOT_LABELS) as DotKind[]).filter((kind) => kinds.includes(kind));

  const group = (
    key: string,
    title: string,
    tickets: BarTicket[],
    favorite: boolean,
    empty: string,
    footer?: ReactNode,
  ) => {
    const open = isOpen(key);
    const listId = `${baseId}-${key}`;
    return (
      <div className={variant === "side" ? "side-group ticket-bar" : "sheet-group ticket-bar"}>
        <button
          type="button"
          className="side-group-toggle"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => toggle(key)}
        >
          <span>
            {title} · {tickets.length}
          </span>
          <Icon name="pfeil-unten" />
        </button>
        <div id={listId} hidden={!open}>
          {tickets.length === 0 ? (
            <p className="side-hint">{empty}</p>
          ) : (
            <ul aria-label={title}>{tickets.map((ticket) => row(ticket, favorite))}</ul>
          )}
          {footer}
        </div>
      </div>
    );
  };

  if (!bar.loaded) {
    return null;
  }
  return (
    <>
      {group(
        GROUP_KEYS.favoriten,
        "Favoriten",
        bar.favorites,
        true,
        "Mit dem Stern hältst du Tickets hier fest.",
      )}
      {group(
        GROUP_KEYS.geoeffnet,
        "Geöffnet",
        bar.recent,
        false,
        "Noch keine Tickets geöffnet.",
        <>
          {bar.recent.length > 0 && (
            <button
              type="button"
              className="row-button ticket-bar-clear"
              onClick={() =>
                ask(
                  {
                    title: "Liste leeren?",
                    text: "Alle Tickets ohne Stern verschwinden aus „Geöffnet“. Die Tickets selbst bleiben unverändert; beim nächsten Öffnen stehen sie wieder in der Liste.",
                    action: "Leeren",
                  },
                  () => clearBar(),
                )
              }
            >
              Liste leeren
            </button>
          )}
        </>,
      )}
      {bar.compact && legend.length > 0 && (
        <p className="ticket-legend">
          {legend.map((kind) => (
            <span key={kind}>
              <span className={`ticket-dot ticket-dot-${kind}`} aria-hidden="true" />
              {DOT_LABELS[kind]}
            </span>
          ))}
        </p>
      )}
      {bar.error && (
        <p className="side-error" role="alert">
          {bar.error}
        </p>
      )}
      {dialog}
    </>
  );
}
