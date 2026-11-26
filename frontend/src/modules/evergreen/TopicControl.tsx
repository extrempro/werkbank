import { useState } from "react";
import { errorText } from "../../api";
import { Feedback } from "../../components/Feedback";
import { InfoTip } from "../../components/InfoTip";
import { FixedChoice } from "../../components/ListChoice";
import { TOPICS, TOPIC_COLORS, TOPIC_LABELS, setTopic, topicOf, type Entry } from "./api";

const AUTO = "auto";

/** Kategorie als farbiger Chip mit Namen (die Farbe hilft nur beim Wiederfinden). */
export function TopicChip({ topic, manual }: { topic: string; manual?: boolean }) {
  const key = topicOf(topic);
  return (
    <span className={`ev-topic bereich-${TOPIC_COLORS[key]}`}>
      <span className="bereich-punkt" aria-hidden="true" />
      {TOPIC_LABELS[key]}
      {manual === false && <span className="small"> (automatisch)</span>}
    </span>
  );
}

/** Kategorie eines Eintrags ansehen und, mit Schreibrecht, von Hand ändern oder zurücksetzen. */
export function TopicControl({
  entry,
  onChanged,
}: {
  entry: Entry;
  onChanged: (entry: Entry) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<string>(entry.topic_manual ? entry.topic : AUTO);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);

  const save = () => {
    setBusy(true);
    setTopic(entry.id, choice === AUTO ? null : topicOf(choice)).then(
      (updated) => {
        setBusy(false);
        setEditing(false);
        setMessage({ kind: "status", text: "Kategorie gespeichert." });
        onChanged(updated);
      },
      (problem: unknown) => {
        setBusy(false);
        setMessage({
          kind: "alert",
          text: errorText(problem, "Die Kategorie konnte nicht gespeichert werden."),
        });
      },
    );
  };

  return (
    <div className="ev-topic-row">
      <span className="small">Kategorie</span>
      <TopicChip topic={entry.topic} manual={entry.topic_manual} />
      <InfoTip term="evergreen.kategorie" />
      {entry.can_edit && !editing && (
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            setChoice(entry.topic_manual ? entry.topic : AUTO);
            setEditing(true);
          }}
        >
          Kategorie ändern
        </button>
      )}
      {editing && (
        <div className="ev-topic-edit">
          <FixedChoice
            label="Kategorie"
            value={choice}
            options={[
              { value: AUTO, label: "Automatisch", hint: "aus dem Dienst der Meldung" },
              ...TOPICS.map((topic) => ({ value: topic, label: TOPIC_LABELS[topic] })),
            ]}
            onChange={setChoice}
            hint="Eine eigene Wahl bleibt, auch wenn Microsoft die Meldung aktualisiert."
          />
          <div className="project-actions">
            <button type="button" className="button" disabled={busy} onClick={save}>
              Übernehmen
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setEditing(false)}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
      <Feedback message={message} onClose={() => setMessage(null)} />
    </div>
  );
}
