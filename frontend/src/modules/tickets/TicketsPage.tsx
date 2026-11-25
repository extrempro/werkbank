import { useEffect, useState } from "react";
import { errorText, formatDateTime } from "../../api";
import { FilterBar } from "../../components/FilterBar";
import { InfoTip } from "../../components/InfoTip";
import { Link } from "../../components/Link";
import { useDebounced } from "../inventory/paged";
import {
  exportUrl,
  fetchTickets,
  PRIORITY_LABELS,
  STATUS_LABELS,
  ticketLabel,
  ticketPath,
  TICKETS_NEW_PATH,
  VIEW_LABELS,
  type TicketAccess,
  type TicketItem,
  type TicketStatus,
  type View,
} from "./api";

const VIEWS: View[] = ["open", "mine", "unassigned", "waiting", "reminder", "done", "all"];

/** Darstellung des Status: Text immer dabei, Farbe nur zusätzlich. */
export const STATUS_PILLS: Record<TicketStatus, string> = {
  new: "pill pill-info",
  in_progress: "pill pill-todo",
  waiting: "pill pill-neutral",
  reminder: "pill pill-neutral",
  solved: "pill pill-ok",
  closed: "pill pill-neutral",
  merged: "pill pill-neutral",
};

/** Ansicht aus der Adresszeile, z. B. `/tickets?ansicht=mine` (von der Übersicht). */
export function viewFromUrl(search = window.location.search): View {
  const value = new URLSearchParams(search).get("ansicht");
  return VIEWS.find((v) => v === value) ?? "open";
}

export function TicketsPage({ access }: { access: TicketAccess }) {
  const [view, setView] = useState<View>(() => viewFromUrl());
  const [area, setArea] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const query = useDebounced(search);
  // Ergebnis mit der Auswahl, für die es gilt; eine andere Auswahl zählt als „lädt“
  const key = `${view}|${area ?? ""}|${query}`;
  const [result, setResult] = useState<{
    key: string;
    items: TicketItem[];
    total: number;
    hasMore: boolean;
  } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const current = result && result.key === key ? result : null;
  const items = current ? current.items : null;
  const total = current ? current.total : 0;
  const hasMore = current ? current.hasMore : false;
  const [loadingMore, setLoadingMore] = useState(false);
  const canCreate = access.areas.some((a) => a.role === "edit" || a.role === "admin");
  // Export nur für die Bereichsverwaltung, nur aus deren Bereichen
  const adminAreas = access.areas.filter((a) => a.role === "admin");
  const canExport =
    adminAreas.length > 0 && (area === null || adminAreas.some((a) => a.id === area));

  useEffect(() => {
    let active = true;
    fetchTickets({ view, area, q: query, offset: 0 }).then(
      (page) => {
        if (active) {
          setFailed(null);
          setResult({
            key: `${view}|${area ?? ""}|${query}`,
            items: page.items,
            total: page.total,
            hasMore: page.has_more,
          });
        }
      },
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Die Tickets konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [view, area, query]);

  const loadMore = () => {
    if (!current) {
      return;
    }
    setLoadingMore(true);
    fetchTickets({ view, area, q: query, offset: current.items.length })
      .then((page) => {
        setResult({
          ...current,
          items: [...current.items, ...page.items],
          hasMore: page.has_more,
        });
      })
      .catch((problem: unknown) =>
        setFailed(errorText(problem, "Weitere Tickets konnten nicht geladen werden.")),
      )
      .finally(() => setLoadingMore(false));
  };

  const filtered = view !== "open" || area !== null || search.trim() !== "";
  const showArea = access.areas.length > 1;

  return (
    <div className="page page-wide">
      <header className="page-head project-head">
        <div>
          <p className="module-label">Tickets</p>
          <h1>Alle Tickets</h1>
          <p className="page-sub">
            Tickets aus deinen Bereichen
            <InfoTip term="tickets.bereich" />
          </p>
        </div>
        <div className="actions">
          {canExport && (
            <a
              className="button button-secondary"
              href={exportUrl(view, area, query)}
              download
              aria-describedby={adminAreas.length < access.areas.length ? "export-hint" : undefined}
            >
              Als Excel exportieren
            </a>
          )}
          {canCreate && (
            <Link className="button button-primary" to={TICKETS_NEW_PATH}>
              Neues Ticket
            </Link>
          )}
        </div>
      </header>
      {canExport && adminAreas.length < access.areas.length && (
        <p className="small" id="export-hint">
          Der Export enthält nur Tickets aus Bereichen, die du verwaltest.
          <InfoTip term="tickets.export" />
        </p>
      )}

      <section className="panel" aria-labelledby="tickets-liste">
        <div className="panel-head">
          <h2 id="tickets-liste">Tickets</h2>
        </div>
        <FilterBar
          plain
          search={{
            label: "Suchen",
            value: search,
            placeholder: "Nr., Betreff oder Melder …",
            onChange: setSearch,
            hits: (items ?? []).map((ticket) => ({
              key: ticket.number,
              title: ticket.subject,
              extra: `${STATUS_LABELS[ticket.status]} · ${ticket.area.name}`,
              meta: ticketLabel(ticket.number),
              href: ticketPath(ticket.number),
            })),
            total: items?.length ?? 0,
          }}
          status={{
            label: "Auswahl",
            value: view,
            onChange: setView,
            options: VIEWS.map((id) => ({ value: id, label: VIEW_LABELS[id] })),
          }}
          more={
            showArea ? (
              <label className="filter-field">
                Bereich
                <select
                  value={area ?? ""}
                  onChange={(event) =>
                    setArea(event.target.value ? Number(event.target.value) : null)
                  }
                >
                  <option value="">Alle Bereiche</option>
                  {access.areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : undefined
          }
          moreActive={area !== null ? 1 : 0}
          onReset={
            filtered
              ? () => {
                  setView("open");
                  setArea(null);
                  setSearch("");
                }
              : undefined
          }
        />
        {failed && (
          <p role="alert" className="hint-box hint-bad">
            {failed}
          </p>
        )}
        {!failed && !items && (
          <p role="status" className="detail-body">
            Wird geladen …
          </p>
        )}
        {items && (
          <p className="small detail-body" role="status">
            {items.length === 0
              ? "Keine Tickets für diese Auswahl."
              : `${items.length} von ${total} Tickets`}
          </p>
        )}
        {items && items.length > 0 && <TicketTable items={items} showArea={showArea} />}
        {hasMore && (
          <p className="detail-body">
            <button type="button" className="button" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Wird geladen …" : "Weitere anzeigen"}
            </button>
          </p>
        )}
      </section>
    </div>
  );
}

/** Tabelle der Tickets; Kategorie und Frist nur, wenn ein Ticket sie hat. */
export function TicketTable({ items, showArea }: { items: TicketItem[]; showArea: boolean }) {
  const showCategory = items.some((t) => t.category);
  const showDue = items.some((t) => t.sla_solution_due);
  return (
    <div className="table-wrap card-wrap" tabIndex={0} role="region" aria-label="Ticketliste">
      <table className="table-cards ticket-table">
        <caption className="visually-hidden">Tickets, zuletzt geändert zuerst</caption>
        <thead>
          <tr>
            <th scope="col">Ticket</th>
            <th scope="col">Status</th>
            {showArea && <th scope="col">Bereich</th>}
            {showCategory && <th scope="col">Kategorie</th>}
            <th scope="col">Priorität</th>
            {showDue && <th scope="col">Frist</th>}
            <th scope="col">Zuständig</th>
            <th scope="col">Melder</th>
            <th scope="col">Geändert</th>
          </tr>
        </thead>
        <tbody>
          {items.map((ticket) => (
            <tr key={ticket.number}>
              <th scope="row">
                <Link to={ticketPath(ticket.number)}>
                  <span className="mono">{ticketLabel(ticket.number)}</span> {ticket.subject}
                </Link>
              </th>
              <td data-label="Status">
                <span className={STATUS_PILLS[ticket.status]}>{STATUS_LABELS[ticket.status]}</span>
                {ticket.status === "reminder" && ticket.reminder_at && (
                  <span className="small"> bis {formatDateTime(ticket.reminder_at)}</span>
                )}
              </td>
              {showArea && <td data-label="Bereich">{ticket.area.name}</td>}
              {showCategory && <td data-label="Kategorie">{ticket.category || "–"}</td>}
              <td data-label="Priorität">{PRIORITY_LABELS[ticket.priority]}</td>
              {showDue && (
                <td className="nowrap" data-label="Frist">
                  {ticket.sla_solution_due ? formatDateTime(ticket.sla_solution_due) : "–"}
                  {ticket.sla_overdue && <span className="pill pill-bad">überfällig</span>}
                </td>
              )}
              <td data-label="Zuständig">{ticket.assignee_name || "–"}</td>
              <td data-label="Melder">{ticket.reporter_name || "–"}</td>
              <td className="nowrap" data-label="Geändert">
                {formatDateTime(ticket.updated_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
