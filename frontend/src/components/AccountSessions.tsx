import { useEffect, useState } from "react";
import { deleteJson, errorText, formatDateTime, getJson, postJson } from "../api";
import { ConfirmButton } from "./ConfirmDialog";
import { Feedback } from "./Feedback";

export interface AccountSession {
  id: string;
  /** z. B. „Edge unter Windows“ */
  device: string;
  authenticated_at: string;
  last_seen_at: string;
  expires_at: string;
  current: boolean;
}

const BASE = "/api/account/sessions";

export function fetchAccountSessions(): Promise<AccountSession[]> {
  return getJson<AccountSession[]>(BASE);
}

type Message = { kind: "status" | "alert"; text: string };

/**
 * Konto › Angemeldete Geräte: alle eigenen Sitzungen, dieses Gerät zuerst. Andere Geräte lassen
 * sich einzeln oder alle auf einmal abmelden; dieses Gerät über „Abmelden“.
 */
export function AccountSessions() {
  const [sessions, setSessions] = useState<AccountSession[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let active = true;
    fetchAccountSessions()
      .then((list) => {
        if (active) {
          setSessions(list);
          setFailed(false);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [round]);

  const run = (action: () => Promise<{ ended: number }>, done: (ended: number) => string) => {
    setBusy(true);
    setMessage(null);
    return action()
      .then((result) => {
        setMessage({ kind: "status", text: done(result.ended) });
        setRound((value) => value + 1);
      })
      .catch((problem: unknown) => {
        setMessage({ kind: "alert", text: errorText(problem, "Das hat nicht geklappt.") });
        setRound((value) => value + 1);
      })
      .finally(() => setBusy(false));
  };

  const others = sessions?.filter((entry) => !entry.current) ?? [];

  return (
    <section className="panel" aria-labelledby="konto-geraete">
      <div className="panel-head">
        <h2 id="konto-geraete">Angemeldete Geräte</h2>
        {sessions && (
          <span className="small">
            {sessions.length === 1 ? "1 Gerät" : `${sessions.length} Geräte`}
          </span>
        )}
      </div>
      <div className="detail-body">
        {failed && <p role="alert">Die Geräte konnten nicht geladen werden.</p>}
        {!failed && sessions === null && <p role="status">Wird geladen …</p>}
        {sessions && (
          <ul className="rows account-sessions" aria-label="Angemeldete Geräte">
            {sessions.map((entry) => (
              <li key={entry.id}>
                <span className="row-main">
                  <span className="row-title">
                    {entry.device}
                    {entry.current && <span className="pill pill-ok">Dieses Gerät</span>}
                  </span>
                  <span className="small">
                    Angemeldet seit {formatDateTime(entry.authenticated_at)} · zuletzt aktiv{" "}
                    {formatDateTime(entry.last_seen_at)}
                    {entry.current && ` · läuft spätestens ${formatDateTime(entry.expires_at)} ab`}
                  </span>
                </span>
                {entry.current ? (
                  <button type="submit" form="konto-abmelden" className="button button-secondary">
                    Abmelden
                  </button>
                ) : (
                  <ConfirmButton
                    className="button button-link"
                    disabled={busy}
                    confirm={{
                      title: `${entry.device} abmelden?`,
                      text: `Die Sitzung auf diesem Gerät endet, zuletzt aktiv ${formatDateTime(entry.last_seen_at)}. Dort meldest du dich danach neu an.`,
                      action: "Abmelden",
                    }}
                    onConfirm={() =>
                      run(
                        () => deleteJson<{ ended: number }>(`${BASE}/${entry.id}`),
                        () => `${entry.device} ist abgemeldet.`,
                      )
                    }
                  >
                    Abmelden<span className="visually-hidden"> – {entry.device}</span>
                  </ConfirmButton>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="small">
          Ohne Aktivität endet eine Sitzung früher. Eine neue Anmeldung beendet die bisherige
          Sitzung desselben Browsers. Gibst du ein Gerät weiter oder hast du es verloren, melde es
          hier ab.
        </p>
        {others.length > 0 && (
          <div className="actions">
            <ConfirmButton
              className="button button-secondary"
              disabled={busy}
              confirm={{
                title: "Auf allen anderen Geräten abmelden?",
                text: `${others.length === 1 ? "1 anderes Gerät wird" : `${others.length} andere Geräte werden`} abgemeldet. Auf diesem Gerät bleibst du angemeldet.`,
                action: "Abmelden",
              }}
              onConfirm={() =>
                run(
                  () => postJson<{ ended: number }>(`${BASE}/logout-others`),
                  (ended) =>
                    ended === 1
                      ? "1 anderes Gerät ist abgemeldet."
                      : `${ended} andere Geräte sind abgemeldet.`,
                )
              }
            >
              Auf allen anderen Geräten abmelden
            </ConfirmButton>
          </div>
        )}
        <Feedback message={message} onClose={() => setMessage(null)} />
        <form id="konto-abmelden" method="post" action="/auth/logout" hidden />
      </div>
    </section>
  );
}
