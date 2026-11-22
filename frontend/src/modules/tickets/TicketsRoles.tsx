import { useEffect, useId, useState } from "react";
import { errorText, formatDateTime } from "../../api";
import { InfoTip } from "../../components/InfoTip";
import { Link } from "../../components/Link";
import {
  AUDIT_LABELS,
  type AreaSettings,
  auditDetails,
  fetchAudit,
  ROLE_LABELS,
  ticketLabel,
  ticketPath,
  type AreaRole,
  type AuditEntry,
  type TicketSettings,
} from "./api";

const ROLES: AreaRole[] = ["admin", "edit", "read"];

/** Übersicht: wer in welchem Bereich welche Rolle hat (alle Bereiche, die du einstellen darfst). */
export function RolesOverview({ settings }: { settings: TicketSettings }) {
  return (
    <section className="panel" aria-labelledby="ticket-rollen">
      <div className="panel-head">
        <h2 id="ticket-rollen">Alle Bereiche</h2>
      </div>
      {settings.areas.length === 0 && (
        <p className="detail-body empty">Es gibt noch keinen Bereich.</p>
      )}
      {settings.areas.length > 0 && (
        <div className="table-wrap card-wrap" tabIndex={0} role="region" aria-label="Rollen">
          <table className="table-cards">
            <caption className="visually-hidden">Rollen je Bereich</caption>
            <thead>
              <tr>
                <th scope="col">Bereich</th>
                {ROLES.map((role) => (
                  <th key={role} scope="col">
                    {ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settings.areas.map((a) => (
                <tr key={a.id}>
                  <th scope="row">
                    {a.name}
                    {!a.active && <span className="small"> (inaktiv)</span>}
                  </th>
                  {ROLES.map((role) => {
                    const grants = a.grants.filter((g) => g.role === role);
                    return (
                      <td key={role} data-label={ROLE_LABELS[role]}>
                        {grants.length === 0
                          ? "–"
                          : grants
                              .map((g) =>
                                g.kind === "group"
                                  ? `Gruppe ${g.name}${g.members === null ? "" : ` (${g.members})`}`
                                  : g.name,
                              )
                              .join(", ")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Protokoll des Moduls: Ticket-Verwaltung alles, Bereichsverwaltung ihre Bereiche. */
export function AuditLog({ areas }: { areas: AreaSettings[] }) {
  const [area, setArea] = useState<number | null>(null);
  const [audit, setAudit] = useState<{
    key: number | null;
    items: AuditEntry[];
    hasMore: boolean;
  } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const areaId = useId();

  useEffect(() => {
    let active = true;
    fetchAudit(area, 0).then(
      (page) => active && setAudit({ key: area, items: page.items, hasMore: page.has_more }),
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Das Protokoll konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [area]);

  const current = audit && audit.key === area ? audit : null;

  const loadMore = () => {
    if (!current) {
      return;
    }
    setLoadingMore(true);
    fetchAudit(area, current.items.length)
      .then((page) =>
        setAudit({ ...current, items: [...current.items, ...page.items], hasMore: page.has_more }),
      )
      .catch((problem: unknown) =>
        setFailed(errorText(problem, "Weitere Einträge konnten nicht geladen werden.")),
      )
      .finally(() => setLoadingMore(false));
  };

  return (
    <>
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      <section className="panel" aria-labelledby="ticket-protokoll">
        <div className="panel-head">
          <h2 id="ticket-protokoll">Protokoll</h2>
          <InfoTip term="tickets.protokoll" />
        </div>
        {areas.length > 1 && (
          <div className="detail-body">
            <label htmlFor={areaId} className="filter-field">
              Bereich
              <select
                id={areaId}
                value={area ?? ""}
                onChange={(event) =>
                  setArea(event.target.value === "" ? null : Number(event.target.value))
                }
              >
                <option value="">Alle</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {!current && !failed && (
          <p className="detail-body" role="status">
            Wird geladen …
          </p>
        )}
        {current && current.items.length === 0 && (
          <p className="detail-body empty">Noch keine Einträge.</p>
        )}
        {current && current.items.length > 0 && (
          <div className="table-wrap card-wrap" tabIndex={0} role="region" aria-label="Protokoll">
            <table className="table-cards">
              <caption className="visually-hidden">Protokoll, neueste zuerst</caption>
              <thead>
                <tr>
                  <th scope="col">Zeitpunkt</th>
                  <th scope="col">Wer</th>
                  <th scope="col">Bereich</th>
                  <th scope="col">Aktion</th>
                  <th scope="col">Ticket</th>
                  <th scope="col">Angaben</th>
                </tr>
              </thead>
              <tbody>
                {current.items.map((entry, index) => (
                  <tr key={`${entry.occurred_at}-${index}`}>
                    <td className="nowrap" data-label="Zeitpunkt">
                      {formatDateTime(entry.occurred_at)}
                    </td>
                    <td data-label="Wer">{entry.actor_name || "–"}</td>
                    <td data-label="Bereich">{entry.area || "–"}</td>
                    <td data-label="Aktion">{AUDIT_LABELS[entry.action] ?? entry.action}</td>
                    <td data-label="Ticket">
                      {entry.ticket_number === null ? (
                        "–"
                      ) : (
                        <Link to={ticketPath(entry.ticket_number)}>
                          {ticketLabel(entry.ticket_number)}
                        </Link>
                      )}
                    </td>
                    <td className="small" data-label="Angaben">
                      {auditDetails(entry.details) || "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {current?.hasMore && (
          <p className="detail-body">
            <button type="button" className="button" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Wird geladen …" : "Weitere anzeigen"}
            </button>
          </p>
        )}
      </section>
    </>
  );
}
