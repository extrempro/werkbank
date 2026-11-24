import { useEffect, useId, useState } from "react";
import { errorText, formatDateTime } from "../../api";
import { InfoTip } from "../../components/InfoTip";
import { Link } from "../../components/Link";
import type { HelpKey } from "../../help/terms";
import {
  fetchStats,
  STATUS_LABELS,
  ticketLabel,
  ticketPath,
  TICKETS_PATH,
  type Count,
  type Stats,
  type TicketAccess,
  type TicketItem,
  type View,
} from "./api";

interface Tile {
  label: string;
  value: string;
  sub: string;
  view: View | null;
  warn?: boolean;
  term?: HelpKey;
}

/** Anteil als Text, z. B. 0,875 → „88 %“. */
export function shareText(part: number, total: number): string {
  if (total <= 0) {
    return "–";
  }
  return `${Math.round((part / total) * 100)} %`;
}

/** Kacheln der Übersicht; Frist-Kacheln nur, wenn ein Bereich Fristen hat. */
export function tilesOf(stats: Stats): Tile[] {
  const tiles: Tile[] = [
    { label: "Offen", value: String(stats.open), sub: "in deinen Bereichen", view: "open" },
    { label: "Mir zugewiesen", value: String(stats.mine), sub: "offen", view: "mine" },
    {
      label: "Neu und frei",
      value: String(stats.unassigned_new),
      sub: "noch niemand zuständig",
      view: "unassigned",
      warn: stats.unassigned_new > 0,
    },
    {
      label: "Wartet",
      value: String(stats.waiting),
      sub: "auf Rückmeldung",
      view: "waiting",
    },
    { label: "Erinnerung", value: String(stats.reminder), sub: "beiseitegelegt", view: "reminder" },
    {
      label: "Gelöst",
      value: String(stats.solved_recent),
      sub: "in den letzten 30 Tagen",
      view: "done",
    },
  ];
  if (stats.overdue !== null) {
    tiles.push({
      label: "Überfällig",
      value: String(stats.overdue),
      sub: "Frist überschritten",
      view: null,
      warn: stats.overdue > 0,
      term: "tickets.frist",
    });
  }
  if (stats.sla !== null) {
    tiles.push({
      label: "Frist eingehalten",
      value: shareText(stats.sla.met, stats.sla.total),
      sub: `${stats.sla.met} von ${stats.sla.total} in 90 Tagen`,
      view: null,
      term: "tickets.frist",
    });
  }
  return tiles;
}

function Bars({ items, label }: { items: Count[]; label: string }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  const total = items.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) {
    return <p className="empty">Keine Tickets.</p>;
  }
  return (
    <ul className="stat-bars" aria-label={label}>
      {items.map((item) => (
        <li key={item.key} title={`${item.label}: ${item.count}`}>
          <span className="stat-bar-label">{item.label}</span>
          <span className="stat-bar-track" aria-hidden="true">
            <span
              className="stat-bar"
              style={{ width: `${item.count === 0 ? 0 : Math.max(1, (item.count / max) * 100)}%` }}
            />
          </span>
          <span className="stat-bar-value">{item.count}</span>
        </li>
      ))}
    </ul>
  );
}

function ShortList({
  title,
  items,
  view,
  empty,
}: {
  title: string;
  items: TicketItem[];
  view: View;
  empty: string;
}) {
  const id = useId();
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-head">
        <h2 id={id}>{title}</h2>
        <Link to={`${TICKETS_PATH}?ansicht=${view}`}>Alle anzeigen</Link>
      </div>
      <div className="detail-body">
        {items.length === 0 ? (
          <p className="empty">{empty}</p>
        ) : (
          <ul className="plain ticket-short-list">
            {items.map((t) => (
              <li key={t.number}>
                <Link to={ticketPath(t.number)}>
                  <span className="mono">{ticketLabel(t.number)}</span> {t.subject}
                </Link>
                <span className="small">
                  {" "}
                  · {STATUS_LABELS[t.status]} · {formatDateTime(t.updated_at)}
                  {t.sla_overdue && " · überfällig"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function TicketsOverviewPage({ access }: { access: TicketAccess }) {
  const [area, setArea] = useState<number | null>(null);
  const [stats, setStats] = useState<{ key: number | null; data: Stats } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const areaId = useId();

  useEffect(() => {
    let active = true;
    fetchStats(area).then(
      (data) => {
        if (active) {
          setFailed(null);
          setStats({ key: area, data });
        }
      },
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Die Übersicht konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [area]);

  const data = stats?.data ?? null;
  const loading = stats !== null && stats.key !== area;

  return (
    <div className="page page-wide stat-page">
      <header className="page-head">
        <div>
          <p className="module-label">Tickets</p>
          <h1>Übersicht</h1>
          <p className="page-sub">
            Was in deinen Bereichen ansteht
            <InfoTip term="tickets.bereich" />
          </p>
        </div>
      </header>

      {access.areas.length > 1 && (
        <section className="panel stat-filters" aria-label="Filter">
          <label htmlFor={areaId} className="filter-field">
            Bereich
            <select
              id={areaId}
              value={area ?? ""}
              onChange={(event) =>
                setArea(event.target.value === "" ? null : Number(event.target.value))
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
          <p className="small stat-loading" role="status">
            {loading ? "Wird aktualisiert …" : ""}
          </p>
        </section>
      )}

      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      {!data && !failed && <p role="status">Wird geladen …</p>}

      {data && (
        <>
          <ul className="stat-kpi-grid" aria-label="Kennzahlen">
            {tilesOf(data).map((tile) => {
              const content = (
                <>
                  <span className="stat-kpi-label">
                    {tile.label}
                    <span className="visually-hidden">: </span>
                  </span>
                  <span className={tile.warn ? "stat-kpi-value stat-kpi-warn" : "stat-kpi-value"}>
                    {tile.value}
                    <span className="visually-hidden">, </span>
                  </span>
                  <span className="stat-kpi-sub">{tile.sub}</span>
                </>
              );
              return (
                <li key={tile.label}>
                  {tile.view ? (
                    <Link className="stat-kpi" to={`${TICKETS_PATH}?ansicht=${tile.view}`}>
                      {content}
                    </Link>
                  ) : (
                    <div className="stat-kpi">{content}</div>
                  )}
                  {tile.term && (
                    <span className="stat-kpi-tip">
                      <InfoTip term={tile.term} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="stat-cards">
            <ShortList
              title="Mir zugewiesen"
              items={data.mine_list}
              view="mine"
              empty="Dir ist gerade nichts zugewiesen."
            />
            <ShortList
              title="Neu und nicht zugewiesen"
              items={data.unassigned_list}
              view="unassigned"
              empty="Keine freien neuen Tickets."
            />
            <section className="panel stat-card" aria-labelledby="ticket-eingang">
              <div className="panel-head">
                <h2 id="ticket-eingang">Eingang nach Weg</h2>
              </div>
              <div className="detail-body">
                <p className="small">Neue Tickets der letzten 30 Tage</p>
                <Bars items={data.created_by_channel} label="Neue Tickets nach Eingangsweg" />
              </div>
            </section>
            <section className="panel stat-card" aria-labelledby="ticket-kategorien">
              <div className="panel-head">
                <h2 id="ticket-kategorien">Offen nach Kategorie</h2>
                <InfoTip term="tickets.kategorie" />
              </div>
              <div className="detail-body">
                <Bars items={data.open_by_category} label="Offene Tickets nach Kategorie" />
              </div>
            </section>
            <section className="panel stat-card" aria-labelledby="ticket-loesungen">
              <div className="panel-head">
                <h2 id="ticket-loesungen">Gelöst nach Lösungsart</h2>
                <InfoTip term="tickets.loesung" />
              </div>
              <div className="detail-body">
                <p className="small">Gelöste und geschlossene Tickets der letzten 30 Tage</p>
                {data.solved_by_type.length > 0 ? (
                  <Bars items={data.solved_by_type} label="Gelöste Tickets nach Lösungsart" />
                ) : (
                  <p className="small">Noch keine gelösten Tickets.</p>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
