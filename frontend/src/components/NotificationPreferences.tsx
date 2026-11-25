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
import { playTone, toneFor, toneLabel, TONES, type SoundSettings, type ToneId } from "../sounds";
import { PHONE_QUERY, useMediaQuery } from "./FilterBar";
import { Feedback } from "./Feedback";
import { PushDevices } from "./PushDevices";
import { Icon } from "./Icon";

const COLUMNS: { channel: Channel; label: string }[] = [
  { channel: "enabled", label: "Glocke" },
  { channel: "mail", label: "Mail" },
  { channel: "teams", label: "Teams" },
  { channel: "push", label: "Push" },
];

interface Props {
  /** Töne dieses Browsers; der Ton wird je Bereich gewählt */
  sounds: SoundSettings;
  onTone: (module: string, tone: ToneId) => void;
}

/** Ton je Bereich: Auswahl und Anhören */
function AreaTone({ module, sounds, onTone }: { module: string } & Props) {
  const tone = toneFor(sounds, module);
  return (
    <span className="notify-tone">
      <span className="notify-tone-label" aria-hidden="true">
        Ton
      </span>
      <select
        aria-label={`Ton für ${module}`}
        value={tone}
        onChange={(event) => {
          const next = event.target.value as ToneId;
          onTone(module, next);
          playTone(next, sounds.volume);
        }}
      >
        {TONES.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="icon-button notify-listen"
        aria-label={`Ton für ${module} anhören: ${toneLabel(tone)}`}
        disabled={tone === "aus"}
        onClick={() => playTone(tone, Math.max(sounds.volume, 20))}
      >
        <Icon name="lautsprecher" />
      </button>
    </span>
  );
}

/** Kurz, was für eine Art an ist, z. B. „Glocke, Push“ */
function summary(entry: NotificationKind): string {
  if (!entry.enabled) {
    return "Aus";
  }
  return COLUMNS.filter((column) => entry[column.channel])
    .map((column) => column.label)
    .join(", ");
}

/** Welche Benachrichtigungen die Person auf welchem Weg bekommt. Speichert sofort. */
export function NotificationPreferences({ sounds, onTone }: Props) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [openKind, setOpenKind] = useState<string | null>(null);
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
    <section className="panel" aria-labelledby="benachrichtigungen-arten">
      <div className="panel-head">
        <h2 id="benachrichtigungen-arten">Arten und Wege</h2>
        <span className="small">gilt für dich</span>
      </div>
      <div className="detail-body settings-form">
        <p>
          Die Glocke oben meldet, was sich in deinen Bereichen getan hat. Per Mail und in Teams
          bekommst du höchstens alle 15 Minuten eine Sammelnachricht mit der Zahl der neuen
          Benachrichtigungen und einem Link, ohne Inhalte. Push kommt nach wenigen Minuten auf deine
          angemeldeten Geräte und nennt nur Bereich und Anzahl. Mail, Teams und Push sind anfangs
          aus. Den Ton je Bereich wählst du hier, ob Töne erklingen, unter „Töne“.
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
        {kinds && kinds.length > 0 && phone && (
          <div className="notify-phone">
            {groupByModule(kinds).map(([module, entries]) => (
              <section key={module} className="notify-area" aria-label={module}>
                <h3 className="notify-area-title">{module}</h3>
                <div className="notify-area-list">
                  <div className="notify-area-row">
                    <AreaTone module={module} sounds={sounds} onTone={onTone} />
                  </div>
                  {entries.map((entry) => {
                    const open = openKind === entry.kind;
                    const panel = `art-${entry.kind}`;
                    return (
                      <div key={entry.kind} className="notify-kind">
                        <button
                          type="button"
                          className="notify-kind-head"
                          aria-expanded={open}
                          aria-controls={panel}
                          onClick={() => setOpenKind(open ? null : entry.kind)}
                        >
                          <span className="notify-kind-text">
                            <span>{entry.label}</span>
                            <span className="small">{summary(entry)}</span>
                          </span>
                          <Icon name="weiter" />
                        </button>
                        <div id={panel} className="notify-kind-body" hidden={!open}>
                          {COLUMNS.map((column) => (
                            <label key={column.channel} className="notify-switch">
                              <span>{column.label}</span>
                              <input
                                type="checkbox"
                                className="switch"
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
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
        {kinds && kinds.length > 0 && !phone && (
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
                      <span className="notify-module-head">
                        <span>{module}</span>
                        <AreaTone module={module} sounds={sounds} onTone={onTone} />
                      </span>
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
