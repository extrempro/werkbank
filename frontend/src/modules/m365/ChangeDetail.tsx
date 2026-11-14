import { useEffect, useId, useState } from "react";
import { formatDateTime } from "../../api";
import { Link } from "../../components/Link";
import {
  criticalityLabel,
  formatValue,
  kindLabel,
  settingTitle,
  statusClass,
  statusLabel,
  workloadLabel,
  type Change,
  type ReviewStatus,
} from "./api";

const QUICK_PICKS = [
  "Geplante Änderung",
  "Störungsbehebung",
  "Mit Dienstleister abgestimmt",
  "Wird rückgängig gemacht",
];

interface ChangeDetailProps {
  change: Change;
  canReview: boolean;
  canCreateItem: boolean;
  busy: boolean;
  onReview: (status: ReviewStatus, comment: string) => void;
  onCreateItem: () => void;
}

/** Detailbereich einer Änderung: Vorher/Nachher, Beschreibung, Bewertung. */
export function ChangeDetail({
  change,
  canReview,
  canCreateItem,
  busy,
  onReview,
  onCreateItem,
}: ChangeDetailProps) {
  const [comment, setComment] = useState("");
  const commentId = useId();
  const hintId = useId();

  // Beim Wechsel der Änderung beginnt der Kommentar leer.
  useEffect(() => {
    setComment("");
  }, [change.id]);

  const critical = change.criticality === "hoch";
  const hasComment = comment.trim() !== "";
  const intendedBlocked = critical && !hasComment;
  const unintendedBlocked = !hasComment;
  const rule = critical
    ? "Kritikalität „Hoch“: Für beide Bewertungen ist ein Kommentar nötig."
    : "„Gewollt“ geht ohne Kommentar. Für „ungewollt“ ist ein Kommentar nötig.";

  return (
    <article className="panel detail" aria-labelledby="detail-titel">
      <div className="panel-head">
        <h2 id="detail-titel">Details zur Änderung</h2>
        <span className={statusClass(change.status)}>{statusLabel(change.status)}</span>
      </div>
      <div className="detail-body">
        <div>
          <p className="detail-title">{settingTitle(change)}</p>
          <p className="mono small path">{change.path}</p>
        </div>

        <dl className="detail-facts">
          <div>
            <dt>Workload</dt>
            <dd>{workloadLabel(change.workload)}</dd>
          </div>
          <div>
            <dt>Art</dt>
            <dd>{kindLabel(change.kind)}</dd>
          </div>
          <div>
            <dt>Erkannt</dt>
            <dd>{formatDateTime(change.detected_at)}</dd>
          </div>
          <div>
            <dt>Geändert von</dt>
            <dd>{change.changed_by ?? "unbekannt"}</dd>
          </div>
          {change.criticality && (
            <div>
              <dt>Kritikalität</dt>
              <dd>{criticalityLabel(change.criticality)}</dd>
            </div>
          )}
        </dl>

        <div className="diff" role="group" aria-label="Vorher und nachher">
          <div className="diff-old">
            <span className="diff-sign" aria-hidden="true">
              −
            </span>
            <span className="visually-hidden">Vorher: </span>
            <span className="diff-value">
              {change.kind === "neu" ? "(nicht vorhanden)" : formatValue(change.old_value)}
            </span>
          </div>
          <div className="diff-new">
            <span className="diff-sign" aria-hidden="true">
              +
            </span>
            <span className="visually-hidden">Nachher: </span>
            <span className="diff-value">
              {change.kind === "entfernt" ? "(entfernt)" : formatValue(change.new_value)}
            </span>
          </div>
        </div>

        <div className="hint-box">
          <p className="hint-title">Beschreibung</p>
          <p>{change.description ?? "Für diese Einstellung gibt es noch keine Beschreibung."}</p>
          <Link to={`/m365/einstellungen/${change.setting_id}`}>
            Einstellung und Verlauf öffnen →
          </Link>
        </div>

        {change.reviewed_by && (
          <p className="small">
            Bewertet von {change.reviewed_by}, {formatDateTime(change.reviewed_at)}
            {change.comment && `: ${change.comment}`}
          </p>
        )}

        {canReview && (
          <div className="detail-review">
            <label htmlFor={commentId}>Kommentar zu dieser Änderung</label>
            <div className="chips" role="group" aria-label="Vorschläge für den Kommentar">
              {QUICK_PICKS.map((pick) => (
                <button
                  type="button"
                  key={pick}
                  className="chip"
                  onClick={() => setComment(`${pick}: `)}
                >
                  {pick}
                </button>
              ))}
            </div>
            <textarea
              id={commentId}
              value={comment}
              rows={3}
              maxLength={2000}
              aria-describedby={hintId}
              onChange={(event) => setComment(event.target.value)}
            />
            <p id={hintId} className={hasComment ? "rule rule-ok" : "rule"}>
              {hasComment ? "Kommentar vorhanden." : rule}
            </p>
            <div className="actions">
              <button
                type="button"
                className="button button-primary"
                disabled={busy || intendedBlocked}
                onClick={() => onReview("gewollt", comment.trim())}
              >
                Als gewollt markieren
              </button>
              <button
                type="button"
                className="button button-danger"
                disabled={busy || unintendedBlocked}
                onClick={() => onReview("ungewollt", comment.trim())}
              >
                Als ungewollt markieren
              </button>
              {change.status !== "offen" && (
                <button
                  type="button"
                  className="button button-link"
                  disabled={busy}
                  onClick={() => onReview("offen", "")}
                >
                  Bewertung zurücksetzen
                </button>
              )}
            </div>
          </div>
        )}

        {canCreateItem && (
          <button type="button" className="button button-secondary" onClick={onCreateItem}>
            Evergreen-Vorgang anlegen
          </button>
        )}
      </div>
    </article>
  );
}
