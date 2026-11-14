import { useEffect, useState } from "react";
import { Link } from "../components/Link";
import { fetchItems, formatDate, type Item } from "../modules/evergreen/api";
import { fetchOverview, type Overview } from "../modules/m365/api";

interface Tile {
  title: string;
  link: string;
  status: string;
  /** true: es gibt etwas zu tun (orange), false: alles in Ordnung (grün). */
  attention: boolean;
  lines: { label: string; value: string }[];
}

const CONFIG_ROLES = ["Config.Reader", "Config.Reviewer"];
const EVERGREEN_ROLES = ["Evergreen.IT", "Evergreen.Team", "Evergreen.Betriebsrat", "Evergreen.GF"];

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function shortTime(iso: string | null | undefined): string {
  if (!iso) {
    return "noch keiner";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "–";
  }
  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function configTile(overview: Overview): Tile {
  const open = count(overview.open_changes);
  const snapshot = overview.last_snapshot ?? null;
  return {
    title: "M365-Konfiguration",
    link: "/m365",
    status: open > 0 ? `${open} offen` : "alles geprüft",
    attention: open > 0,
    lines: [
      { label: "Überwachte Einstellungen", value: String(count(overview.settings_total)) },
      { label: "Abweichungen vom Soll-Wert", value: String(count(overview.deviations)) },
      { label: "Letzter Abruf", value: shortTime(snapshot?.finished_at ?? snapshot?.started_at) },
    ],
  };
}

function evergreenTile(entries: Item[], hasMore: boolean): Tile {
  const mine = entries.filter((item) => item.waiting_for_me).length;
  const rollouts = entries
    .map((item) => item.rollout_date)
    .filter((date): date is string => typeof date === "string")
    .sort();
  const today = new Date().toISOString().slice(0, 10);
  const next = rollouts.find((date) => date >= today) ?? null;
  return {
    title: "Evergreen",
    link: "/evergreen",
    status: mine > 0 ? `${mine} für mich` : "nichts für mich",
    attention: mine > 0,
    lines: [
      { label: "Offene Vorgänge", value: hasMore ? `${entries.length}+` : String(entries.length) },
      { label: "Wartet auf mich", value: String(mine) },
      { label: "Nächster Rollout", value: next ? formatDate(next) : "–" },
    ],
  };
}

/** Kacheln der Module auf der Startseite. Lädt nur, was die Person sehen darf. */
export function ModuleTiles({ roles }: { roles: readonly string[] }) {
  const showConfig = CONFIG_ROLES.some((role) => roles.includes(role));
  const showEvergreen = EVERGREEN_ROLES.some((role) => roles.includes(role));
  const [config, setConfig] = useState<Tile | null>(null);
  const [evergreen, setEvergreen] = useState<Tile | null>(null);

  useEffect(() => {
    let active = true;
    if (showConfig) {
      fetchOverview()
        .then((overview) => {
          if (active && overview && typeof overview === "object") {
            setConfig(configTile(overview));
          }
        })
        .catch(() => undefined);
    }
    if (showEvergreen) {
      fetchItems("offen", 0)
        .then((list) => {
          if (active && list && Array.isArray(list.entries)) {
            setEvergreen(evergreenTile(list.entries, list.has_more === true));
          }
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [showConfig, showEvergreen]);

  const tiles = [config, evergreen].filter((tile): tile is Tile => tile !== null);
  if (tiles.length === 0) {
    return null;
  }
  return (
    <div className="tiles">
      {tiles.map((tile) => (
        <section className="tile" key={tile.title} aria-label={tile.title}>
          <div className="tile-head">
            <Link to={tile.link} className="tile-title">
              {tile.title}
            </Link>
            <span className={tile.attention ? "pill pill-todo" : "pill pill-ok"}>
              {tile.status}
            </span>
          </div>
          <dl className="tile-lines">
            {tile.lines.map((line) => (
              <div key={line.label}>
                <dt>{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
