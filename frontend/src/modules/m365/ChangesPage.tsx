import { useEffect, useRef, useState } from "react";
import { ApiError, formatDateTime, type Me } from "../../api";
import { Placeholder } from "../../components/Placeholder";
import { navigate } from "../../router";
import { createItemFromChange } from "../evergreen/api";
import {
  fetchChanges,
  kindLabel,
  reviewChanges,
  settingTitle,
  statusClass,
  statusLabel,
  workloadLabel,
  type Change,
  type ChangeCounts,
  type ReviewStatus,
} from "./api";
import { ChangeDetail } from "./ChangeDetail";

interface ChangesPageProps {
  me: Me;
}

const FILTERS: { value: "" | ReviewStatus; label: string; key: keyof ChangeCounts }[] = [
  { value: "offen", label: "Offen", key: "offen" },
  { value: "ungewollt", label: "Ungewollt", key: "ungewollt" },
  { value: "gewollt", label: "Gewollt", key: "gewollt" },
  { value: "", label: "Alle", key: "alle" },
];

type Message = { kind: "status" | "alert"; text: string };

export function ChangesPage({ me }: ChangesPageProps) {
  const [filter, setFilter] = useState<string>("offen");
  const [reloadKey, setReloadKey] = useState(0);
  const [entries, setEntries] = useState<Change[]>([]);
  const [counts, setCounts] = useState<ChangeCounts | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [current, setCurrent] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkComment, setBulkComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const canReview = me.roles.includes("Config.Reviewer");
  const canCreateItem = me.roles.includes("Evergreen.IT");

  useEffect(() => {
    let active = true;
    fetchChanges(filter, 0)
      .then((page) => {
        if (active) {
          setEntries(page.entries);
          setHasMore(page.has_more);
          setCounts(page.counts ?? null);
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
  }, [filter, reloadKey]);

  const loadMore = () => {
    fetchChanges(filter, entries.length)
      .then((page) => {
        setEntries((previous) => [...previous, ...page.entries]);
        setHasMore(page.has_more);
      })
      .catch(() => {
        setStatus("error");
      });
  };

  const pickFilter = (value: string) => {
    if (value === filter) {
      return;
    }
    setStatus("loading");
    setSelected([]);
    setCurrent(null);
    setMessage(null);
    setFilter(value);
  };

  const open = (id: number) => {
    setCurrent(id);
    setMessage(null);
    // Auf schmalen Bildschirmen steht der Detailbereich unter der Liste.
    window.requestAnimationFrame(() => {
      const target = detailRef.current;
      if (target && typeof target.scrollIntoView === "function" && window.innerWidth < 1100) {
        target.scrollIntoView({ block: "start" });
      }
    });
  };

  const onCreateItem = (entry: Change) => {
    setMessage(null);
    createItemFromChange(entry.id)
      .then((item) => {
        navigate(`/evergreen/${item.id}`);
      })
      .catch((error: unknown) => {
        const detail = error instanceof ApiError ? error.detail : null;
        setMessage({ kind: "alert", text: detail ?? "Der Vorgang konnte nicht angelegt werden." });
      });
  };

  const send = (ids: number[], target: ReviewStatus, comment: string, after: () => void) => {
    setBusy(true);
    setMessage(null);
    reviewChanges(ids, target, comment)
      .then((result) => {
        const text =
          target === "offen"
            ? `${result.updated} Bewertung(en) zurückgesetzt.`
            : `${result.updated} Änderung(en) als ${statusLabel(target).toLowerCase()} bewertet.`;
        setMessage({ kind: "status", text });
        after();
        setReloadKey((key) => key + 1);
      })
      .catch((error: unknown) => {
        const detail = error instanceof ApiError ? error.detail : null;
        setMessage({
          kind: "alert",
          text: detail ?? "Die Bewertung konnte nicht gespeichert werden.",
        });
      })
      .finally(() => setBusy(false));
  };

  const reviewSelection = (target: ReviewStatus) => {
    if (selected.length === 0) {
      setMessage({ kind: "alert", text: "Bitte zuerst mindestens eine Änderung auswählen." });
      return;
    }
    if (target === "ungewollt" && bulkComment.trim() === "") {
      setMessage({ kind: "alert", text: "Für „ungewollt“ ist ein Kommentar nötig." });
      return;
    }
    send(selected, target, bulkComment.trim(), () => {
      setSelected([]);
      setBulkComment("");
    });
  };

  const toggle = (id: number) => {
    setSelected((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
  };

  const shown = entries.find((entry) => entry.id === current) ?? null;

  return (
    <div className="page page-wide">
      <header className="page-head">
        <p className="module-label">M365-Konfiguration</p>
        <h1>Änderungen</h1>
        <p className="page-sub">
          Erkannte Änderungen an Einstellungen des Tenants. Jede Änderung wird als gewollt oder
          ungewollt bewertet.
        </p>
      </header>

      <div className="chips" role="group" aria-label="Änderungen filtern">
        {FILTERS.map((option) => (
          <button
            type="button"
            key={option.key}
            className="chip chip-filter"
            aria-pressed={filter === option.value}
            onClick={() => pickFilter(option.value)}
          >
            {option.label}
            {counts && ` (${counts[option.key]})`}
          </button>
        ))}
      </div>

      {message && (
        <p role={message.kind} className={message.kind === "alert" ? "hint-box hint-bad" : ""}>
          {message.text}
        </p>
      )}

      {status === "error" && <p role="alert">Die Änderungen konnten nicht geladen werden.</p>}
      {status === "loading" && <p role="status">Wird geladen …</p>}
      {status === "ready" && entries.length === 0 && (
        <p className="panel panel-empty">Keine Änderungen für diese Auswahl.</p>
      )}

      {entries.length > 0 && (
        <div className="split">
          <div className="split-list">
            <section className="panel" aria-label="Änderungen">
              <ul className="rows change-rows">
                {entries.map((entry) => (
                  <li key={entry.id} className={entry.id === current ? "row-current" : undefined}>
                    {canReview && (
                      <input
                        type="checkbox"
                        className="check"
                        checked={selected.includes(entry.id)}
                        onChange={() => toggle(entry.id)}
                        aria-label={`${settingTitle(entry)} auswählen`}
                      />
                    )}
                    <span className="row-main">
                      <button
                        type="button"
                        className="row-title row-button"
                        aria-current={entry.id === current ? "true" : undefined}
                        onClick={() => open(entry.id)}
                      >
                        {settingTitle(entry)}
                      </button>
                      <span className="small">
                        <span className="module-tag">{workloadLabel(entry.workload)}</span>{" "}
                        {kindLabel(entry.kind)} · {formatDateTime(entry.detected_at)} · von{" "}
                        {entry.changed_by ?? "unbekannt"}
                      </span>
                    </span>
                    <span className={statusClass(entry.status)}>{statusLabel(entry.status)}</span>
                  </li>
                ))}
              </ul>
            </section>
            {hasMore && (
              <button
                type="button"
                className="button button-secondary load-more"
                onClick={loadMore}
              >
                Weitere laden
              </button>
            )}

            {canReview && (
              <section className="panel bulk" aria-labelledby="bewerten-titel">
                <div className="panel-head">
                  <h2 id="bewerten-titel">Auswahl bewerten</h2>
                  <span className="small">{selected.length} ausgewählt</span>
                </div>
                <div className="detail-body">
                  <label>
                    Kommentar für die Auswahl (Pflicht bei „ungewollt“)
                    <textarea
                      value={bulkComment}
                      maxLength={2000}
                      rows={2}
                      onChange={(event) => setBulkComment(event.target.value)}
                    />
                  </label>
                  <div className="actions">
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={busy}
                      onClick={() => reviewSelection("gewollt")}
                    >
                      Als gewollt bewerten
                    </button>
                    <button
                      type="button"
                      className="button button-danger"
                      disabled={busy}
                      onClick={() => reviewSelection("ungewollt")}
                    >
                      Als ungewollt bewerten
                    </button>
                    <button
                      type="button"
                      className="button button-link"
                      disabled={busy}
                      onClick={() => reviewSelection("offen")}
                    >
                      Bewertung zurücksetzen
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>

          <div className="split-detail" ref={detailRef}>
            {shown ? (
              <ChangeDetail
                key={`${shown.id}-${shown.status}`}
                change={shown}
                canReview={canReview}
                canCreateItem={canCreateItem}
                busy={busy}
                onReview={(target, comment) => send([shown.id], target, comment, () => undefined)}
                onCreateItem={() => onCreateItem(shown)}
              />
            ) : (
              <Placeholder>
                Änderung in der Liste wählen, um Vorher und Nachher zu sehen.
              </Placeholder>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
