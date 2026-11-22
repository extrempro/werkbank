import { useEffect, useState } from "react";
import { errorText } from "../api";
import {
  fetchNotificationSettings,
  groupByModule,
  saveNotificationSettings,
  toggleChannel,
  type Channel,
  type NotificationChannels,
  type NotificationKind,
} from "../notifications";
import { PushDevices } from "./PushDevices";
import { Feedback } from "./Feedback";

const COLUMNS: { channel: Channel; label: string }[] = [
  { channel: "enabled", label: "Glocke" },
  { channel: "mail", label: "Mail" },
  { channel: "teams", label: "Teams" },
  { channel: "push", label: "Push" },
];

/** Konto: welche Benachrichtigungen die Person auf welchem Weg bekommt. Speichert sofort. */
export function NotificationPreferences() {
  const [kinds, setKinds] = useState<NotificationKind[] | null>(null);
  const [channels, setChannels] = useState<NotificationChannels | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetchNotificationSettings().then(
      (result) => {
        if (active) {
          setKinds(result.kinds);
          setChannels(result.channels);
        }
      },
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, []);

  const available = (channel: Channel): boolean => {
    if (channel === "enabled") {
      return true;
    }
    // Push braucht keine Mailadresse, nur ein angemeldetes Gerät
    if (channel === "push") {
      return Boolean(channels?.push);
    }
    return Boolean(channels?.has_email && channels[channel]);
  };

  const toggle = (kind: string, channel: Channel, on: boolean) => {
    if (!kinds) {
      return;
    }
    const before = kinds;
    // Sofort anzeigen; schlägt das Speichern fehl, gilt wieder der alte Stand
    const next = toggleChannel(kinds, kind, channel, on);
    setKinds(next);
    setBusy(true);
    setMessage(null);
    saveNotificationSettings(next)
      .then((result) => {
        setKinds(result.kinds);
        setChannels(result.channels);
        setMessage({ kind: "status", text: "Gespeichert." });
      })
      .catch((error: unknown) => {
        setKinds(before);
        setMessage({
          kind: "alert",
          text: errorText(error, "Die Einstellung konnte nicht gespeichert werden."),
        });
      })
      .finally(() => setBusy(false));
  };

  return (
    <section className="panel" aria-labelledby="konto-benachrichtigungen">
      <div className="panel-head">
        <h2 id="konto-benachrichtigungen">Benachrichtigungen</h2>
        <span className="small">gilt für dich</span>
      </div>
      <div className="detail-body settings-form">
        <p>
          Die Glocke oben meldet, was sich in deinen Bereichen getan hat. Per Mail und in Teams
          bekommst du höchstens alle 15 Minuten eine Sammelnachricht mit der Zahl der neuen
          Benachrichtigungen und einem Link, ohne Inhalte. Push kommt nach wenigen Minuten auf deine
          angemeldeten Geräte und nennt nur Bereich und Anzahl. Mail, Teams und Push sind anfangs
          aus.
        </p>
        {failed && (
          <p role="alert" className="hint-box hint-bad">
            Die Einstellungen konnten nicht geladen werden.
          </p>
        )}
        {!failed && !kinds && <p role="status">Wird geladen …</p>}
        {kinds && kinds.length === 0 && <p>Für deine Rollen gibt es keine Benachrichtigungen.</p>}
        {channels && !channels.has_email && (
          <p className="small">
            Für dein Konto ist keine E-Mail-Adresse hinterlegt. Ohne sie gehen weder Mail noch
            Teams.
          </p>
        )}
        {channels?.has_email && (!channels.mail || !channels.teams) && (
          <p className="small">
            {!channels.mail && !channels.teams
              ? "Mail und Teams hat die Verwaltung noch nicht eingerichtet."
              : !channels.mail
                ? "Mail hat die Verwaltung noch nicht eingerichtet."
                : "Teams hat die Verwaltung noch nicht eingerichtet."}
          </p>
        )}
        {channels?.push && <PushDevices />}
        {kinds && kinds.length > 0 && (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Benachrichtigungen">
            <table className="notify-table">
              <caption className="visually-hidden">
                Arten von Benachrichtigungen und auf welchem Weg du sie bekommst
              </caption>
              <thead>
                <tr>
                  <th scope="col">Art</th>
                  {COLUMNS.map((column) => (
                    <th key={column.channel} scope="col" className="notify-col">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              {groupByModule(kinds).map(([module, entries]) => (
                <tbody key={module}>
                  <tr>
                    <th scope="colgroup" colSpan={COLUMNS.length + 1} className="notify-module">
                      {module}
                    </th>
                  </tr>
                  {entries.map((entry) => (
                    <tr key={entry.kind}>
                      <th scope="row" className="notify-label">
                        {entry.label}
                      </th>
                      {COLUMNS.map((column) => (
                        <td key={column.channel} className="notify-col">
                          <input
                            type="checkbox"
                            className="check"
                            aria-label={`${entry.label}: ${column.label}`}
                            checked={entry[column.channel]}
                            disabled={
                              busy ||
                              !available(column.channel) ||
                              (column.channel !== "enabled" && !entry.enabled)
                            }
                            onChange={(event) =>
                              toggle(entry.kind, column.channel, event.target.checked)
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
        <Feedback message={message} onClose={() => setMessage(null)} />
      </div>
    </section>
  );
}
