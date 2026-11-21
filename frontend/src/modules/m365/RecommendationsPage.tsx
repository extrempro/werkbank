import { useEffect, useState, type FormEvent } from "react";
import { FilterBar } from "../../components/FilterBar";
import { ApiError, formatDateTime, type Me } from "../../api";
import { Link } from "../../components/Link";
import { Placeholder } from "../../components/Placeholder";
import {
  fetchRecommendation,
  fetchRecommendations,
  fetchSettings,
  formatScore,
  levelLabel,
  linkRecommendation,
  settingTitle,
  unlinkRecommendation,
  workloadLabel,
  type Recommendation,
  type RecommendationDetail,
  type RecommendationList,
  type RecommendationView,
  type Setting,
} from "./api";

const PATH = "/m365/empfehlungen";

const VIEWS: { value: RecommendationView; label: string }[] = [
  { value: "offen", label: "Offen" },
  { value: "erfuellt", label: "Erfüllt" },
  { value: "alle", label: "Alle" },
];

function viewCount(list: RecommendationList, view: RecommendationView): number {
  if (view === "offen") {
    return list.open_count;
  }
  return view === "erfuellt" ? list.fulfilled_count : list.open_count + list.fulfilled_count;
}

function StatePill({ entry }: { entry: Recommendation }) {
  return (
    <span className={entry.fulfilled ? "pill pill-ok" : "pill pill-todo"}>
      {entry.fulfilled ? "erfüllt" : "offen"}
    </span>
  );
}

interface RecommendationsPageProps {
  me: Me;
  /** Geöffnete Empfehlung. Auf breiten Bildschirmen steht sie neben der Liste. */
  selectedId?: number;
}

/** M365-Konfiguration › Empfehlungen: Controls aus Microsoft Secure Score mit Stand im Tenant. */
export function RecommendationsPage({ me, selectedId }: RecommendationsPageProps) {
  const [view, setView] = useState<RecommendationView>("offen");
  const [list, setList] = useState<RecommendationList | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    fetchRecommendations(view)
      .then((result) => {
        if (active) {
          setList(result);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (active) {
          setStatus("error");
        }
      });
    return () => {
      active = false;
    };
  }, [view, reloadKey]);

  const hasDetail = selectedId !== undefined;
  const entries = list?.entries ?? [];
  const empty = status === "ready" && list !== null && viewCount(list, "alle") === 0;

  return (
    <div className={hasDetail ? "page page-wide has-detail" : "page page-wide"}>
      <header className="page-head list-only">
        <p className="module-label">M365-Konfiguration</p>
        {hasDetail ? <p className="page-title">Empfehlungen</p> : <h1>Empfehlungen</h1>}
        <p className="page-sub">
          Empfehlungen von Microsoft Secure Score mit dem Stand in deinem Tenant. Titel und Texte
          kommen von Microsoft und sind auf Englisch.
        </p>
      </header>

      <div className="split">
        <div className="split-list split-narrow list-only">
          <section className="panel tree" aria-label="Empfehlungen">
            <div className="tree-filter">
              {list && viewCount(list, "alle") > 0 && (
                <p className="small" role="status">
                  Erreicht: {formatScore(list.score, list.max_score)} Punkten · Stand{" "}
                  {formatDateTime(list.fetched_at)}
                </p>
              )}
              <FilterBar
                plain
                status={{
                  label: "Empfehlungen filtern",
                  value: view,
                  onChange: (value) => {
                    if (value !== view) {
                      setStatus("loading");
                      setView(value);
                    }
                  },
                  options: VIEWS.map((option) => ({
                    value: option.value,
                    label: option.label,
                    count: list ? viewCount(list, option.value) : null,
                  })),
                }}
              />
            </div>

            {status === "error" && (
              <p role="alert" className="panel-empty">
                Die Empfehlungen konnten nicht geladen werden.
              </p>
            )}
            {status === "loading" && (
              <p role="status" className="panel-empty">
                Wird geladen …
              </p>
            )}
            {empty && (
              <p className="panel-empty">
                {list?.enabled
                  ? "Es wurden noch keine Empfehlungen gelesen. Der erste Abruf läuft innerhalb einer Stunde nach dem Einschalten."
                  : "Der Abruf von Microsoft Secure Score ist in dieser Installation nicht eingeschaltet (siehe Anleitung zur Einrichtung)."}
              </p>
            )}
            {status === "ready" && !empty && entries.length === 0 && (
              <p className="panel-empty">Keine Empfehlungen in dieser Ansicht.</p>
            )}
            {status === "ready" && entries.length > 0 && (
              <ul className="tree-group">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <Link
                      to={`${PATH}/${entry.id}`}
                      className={entry.id === selectedId ? "tree-item tree-current" : "tree-item"}
                      aria-current={entry.id === selectedId ? "page" : undefined}
                    >
                      <span className="tree-text">
                        <span className="tree-name">{entry.title}</span>
                        <span className="small">
                          {[entry.category, formatScore(entry.score, entry.max_score) + " Punkten"]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="tree-badges">
                        <StatePill entry={entry} />
                        {entry.linked_settings > 0 && (
                          <span className="pill pill-neutral">
                            {entry.linked_settings}
                            <span className="visually-hidden"> zugeordnete Einstellungen</span>
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="split-detail split-wide">
          {hasDetail ? (
            <RecommendationPanel
              key={selectedId}
              id={selectedId}
              canEdit={me.roles.includes("Config.Reviewer")}
              onChanged={() => setReloadKey((key) => key + 1)}
            />
          ) : (
            <Placeholder>Empfehlung in der Liste wählen, um die Details zu sehen.</Placeholder>
          )}
        </div>
      </div>
    </div>
  );
}

interface RecommendationPanelProps {
  id: number;
  canEdit: boolean;
  onChanged: () => void;
}

function RecommendationPanel({ id, canEdit, onChanged }: RecommendationPanelProps) {
  const [detail, setDetail] = useState<RecommendationDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<Setting[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchRecommendation(id)
      .then((result) => {
        if (active) {
          setDetail(result);
          setStatus("ready");
        }
      })
      .catch((error: unknown) => {
        if (active) {
          const missing = error instanceof ApiError && [404, 422].includes(error.status);
          setStatus(missing ? "missing" : "error");
        }
      });
    return () => {
      active = false;
    };
  }, [id]);

  const back = (
    <p className="back">
      <Link to={PATH}>Zurück zu den Empfehlungen</Link>
    </p>
  );

  if (status !== "ready" || !detail) {
    return (
      <div className="page">
        {back}
        {status === "loading" && <p role="status">Wird geladen …</p>}
        {status === "missing" && <p>Diese Empfehlung gibt es nicht.</p>}
        {status === "error" && <p role="alert">Die Empfehlung konnte nicht geladen werden.</p>}
      </div>
    );
  }

  const entry = detail.recommendation;
  const linkedIds = new Set(detail.settings.map((setting) => setting.id));

  const change = (request: Promise<RecommendationDetail>) => {
    setBusy(true);
    setFailed(null);
    request
      .then((result) => {
        setDetail(result);
        onChanged();
      })
      .catch((error: unknown) => {
        const text = error instanceof ApiError ? error.detail : null;
        setFailed(text ?? "Das hat nicht geklappt. Bitte versuche es erneut.");
      })
      .finally(() => setBusy(false));
  };

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    const term = search.trim();
    if (!term) {
      setHits(null);
      return;
    }
    setFailed(null);
    fetchSettings({ search: term, workload: "", includeRemoved: false, onlyDeviating: false }, 0)
      .then((page) => setHits(page.entries.slice(0, 25)))
      .catch(() => setFailed("Die Suche hat nicht geklappt. Bitte versuche es erneut."));
  };

  return (
    <div className="page">
      {back}
      <article className="panel setting" aria-labelledby="empfehlung-titel">
        <header className="setting-head">
          <p className="module-label">Microsoft Secure Score</p>
          <p className="small">
            {[entry.category, entry.service].filter(Boolean).join(" › ") || "Empfehlung"}
          </p>
          <h1 id="empfehlung-titel" lang="en">
            {entry.title}
          </h1>
          <p className="mono small path">{entry.control_id}</p>
        </header>

        <dl className="strip">
          <div>
            <dt>Stand</dt>
            <dd>
              <StatePill entry={entry} />
            </dd>
          </div>
          <div>
            <dt>Punkte</dt>
            <dd>{formatScore(entry.score, entry.max_score)}</dd>
          </div>
          <div>
            <dt>Auswirkung auf Nutzer</dt>
            <dd>{levelLabel(entry.user_impact)}</dd>
          </div>
          <div>
            <dt>Aufwand</dt>
            <dd>{levelLabel(entry.implementation_cost)}</dd>
          </div>
        </dl>

        <section className="setting-section" aria-labelledby="empfehlung-stand">
          <div className="section-head">
            <h2 id="empfehlung-stand">Stand im Tenant</h2>
            <span className="small">Abruf {formatDateTime(detail.fetched_at)}</span>
          </div>
          <p className="text" lang="en">
            {entry.status_text ?? (
              <span className="empty" lang="de">
                Microsoft liefert für diese Empfehlung keinen Statustext.
              </span>
            )}
          </p>
        </section>

        <section className="setting-section" aria-labelledby="empfehlung-umsetzung">
          <div className="section-head">
            <h2 id="empfehlung-umsetzung">Umsetzung laut Microsoft</h2>
          </div>
          <p className="text" lang="en">
            {detail.remediation ?? (
              <span className="empty" lang="de">
                Kein Hinweis zur Umsetzung vorhanden.
              </span>
            )}
          </p>
          {detail.action_url && (
            <p>
              <a href={detail.action_url} rel="noreferrer noopener" target="_blank">
                Bei Microsoft öffnen (neues Fenster)
              </a>
            </p>
          )}
        </section>

        <section className="setting-section" aria-labelledby="empfehlung-einstellungen">
          <div className="section-head">
            <h2 id="empfehlung-einstellungen">Zugeordnete Einstellungen</h2>
            <span className="small">{detail.settings.length}</span>
          </div>
          <p className="small">
            Microsoft nennt nicht, welche Einstellungen eine Empfehlung betrifft. Die Zuordnung
            pflegen Reviewer hier von Hand; sie erscheint dann auch bei der Einstellung.
          </p>
          {detail.settings.length === 0 ? (
            <p className="empty">Noch keine Einstellung zugeordnet.</p>
          ) : (
            <ul className="rows">
              {detail.settings.map((setting) => (
                <li key={setting.id}>
                  <span className="row-main">
                    <Link to={`/m365/einstellungen/${setting.id}`} className="row-title">
                      {settingTitle(setting)}
                    </Link>
                    <span className="small">{workloadLabel(setting.workload)}</span>
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => change(unlinkRecommendation(id, setting.id))}
                    >
                      Lösen <span className="visually-hidden">– {settingTitle(setting)}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <>
              <form className="link-search" role="search" onSubmit={onSearch}>
                <label>
                  Einstellung suchen (Name oder Pfad)
                  <input
                    type="search"
                    value={search}
                    maxLength={200}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <button type="submit" className="button button-secondary">
                  Suchen
                </button>
              </form>
              {hits !== null && hits.length === 0 && (
                <p className="empty" role="status">
                  Keine Einstellung gefunden.
                </p>
              )}
              {hits !== null && hits.length > 0 && (
                <ul className="rows" aria-label="Suchergebnis">
                  {hits.map((hit) => (
                    <li key={hit.id}>
                      <span className="row-main">
                        <span className="row-title">{settingTitle(hit)}</span>
                        <span className="small">{workloadLabel(hit.workload)}</span>
                      </span>
                      {linkedIds.has(hit.id) ? (
                        <span className="pill pill-ok">zugeordnet</span>
                      ) : (
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={busy}
                          onClick={() => change(linkRecommendation(id, hit.id))}
                        >
                          Zuordnen <span className="visually-hidden">– {settingTitle(hit)}</span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {failed && (
            <p role="alert" className="hint-box hint-bad">
              {failed}
            </p>
          )}
        </section>
      </article>
    </div>
  );
}
