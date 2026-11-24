import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { errorText } from "../../api";
import type { FeedbackMessage } from "../../components/Feedback";
import { Icon } from "../../components/Icon";
import { InfoTip } from "../../components/InfoTip";
import { Link } from "../../components/Link";
import { useModal } from "../../components/nav/useModal";
import { MembersEditor } from "./MembersEditor";
import {
  fetchRights,
  notifyTreeChanged,
  PAGE_ROLE_LABELS,
  pagePath,
  saveMembers,
  saveRights,
  SPACE_ROLE_LABELS,
  type PersonRight,
  type Rights,
} from "./api";

/** Recht aus dem Arbeitsbereich an der Seite (Verwalten zählt wie Bearbeiten). */
function fromSpace(role: string): string {
  return role === "manage" ? "edit" : role;
}

/**
 * „Rechte und Teilen“: Seite wie der Arbeitsbereich oder mit eigenen Rechten (Schloss), für
 * jede Person mit Bearbeiten. Wer im Arbeitsbereich „Verwalten“ hat, ändert hier auch die
 * Personen des Arbeitsbereichs.
 */
export function RightsDialog({
  pageId,
  spaceId,
  space,
  onClose,
  onFeedback,
  onSaved,
}: {
  pageId: string;
  spaceId: number;
  space: string;
  onClose: () => void;
  onFeedback: (message: FeedbackMessage) => void;
  onSaved: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [rights, setRights] = useState<Rights | null>(null);
  const [own, setOwn] = useState(false);
  const [people, setPeople] = useState<PersonRight[]>([]);
  const [members, setMembers] = useState<PersonRight[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useModal(box, true, onClose);

  useEffect(() => {
    let active = true;
    fetchRights(pageId).then(
      (result) => {
        if (!active) {
          return;
        }
        setRights(result);
        setOwn(result.own_rights);
        setMembers(result.space_members);
        // Alle Mitglieder mit ihrem Recht, Abweichungen und weitere Personen darüber
        const overrides = new Map(result.entries.map((entry) => [entry.oid, entry]));
        const list = result.space_members.map((member) => ({
          oid: member.oid,
          name: member.name,
          role: overrides.get(member.oid)?.role ?? fromSpace(member.role),
        }));
        for (const entry of result.entries) {
          if (!result.space_members.some((member) => member.oid === entry.oid)) {
            list.push(entry);
          }
        }
        setPeople(list);
      },
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Die Rechte konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [pageId]);

  const memberRole = new Map(members.map((member) => [member.oid, fromSpace(member.role)]));
  const save = () => {
    setBusy(true);
    // Gespeichert wird nur, was vom Arbeitsbereich abweicht
    const entries = people.filter((person) => memberRole.get(person.oid) !== person.role);
    saveRights(pageId, { own_rights: own, entries }).then(
      () => {
        notifyTreeChanged();
        onSaved();
        onFeedback({ kind: "status", text: "Die Rechte wurden gespeichert." });
        onClose();
      },
      (problem: unknown) => {
        setBusy(false);
        onFeedback({
          kind: "alert",
          text: errorText(problem, "Die Rechte konnten nicht gespeichert werden."),
        });
      },
    );
  };
  const saveSpace = () => {
    setBusy(true);
    saveMembers(spaceId, members).then(
      (result) => {
        setBusy(false);
        setMembers(result);
        notifyTreeChanged();
        onFeedback({ kind: "status", text: "Die Personen im Arbeitsbereich wurden gespeichert." });
      },
      (problem: unknown) => {
        setBusy(false);
        onFeedback({
          kind: "alert",
          text: errorText(problem, "Die Personen konnten nicht gespeichert werden."),
        });
      },
    );
  };

  const inherited = rights?.inherited_from ?? null;
  return createPortal(
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        ref={box}
        className="confirm-dialog doku-dialog doku-rights"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="doku-dialog-head">
          <h2 id={titleId}>Rechte und Teilen</h2>
          <button
            type="button"
            className="button button-secondary doku-icon-only"
            aria-label="Schließen"
            onClick={onClose}
          >
            <Icon name="schliessen" />
          </button>
        </div>
        {failed && (
          <p className="hint-box hint-bad" role="alert">
            {failed}
          </p>
        )}
        {!rights && !failed && <p role="status">Wird geladen …</p>}
        {rights && inherited && (
          <p className="hint-box">
            Für diese Seite gelten die eigenen Rechte von „
            <Link to={pagePath(inherited.id)}>{inherited.title}</Link>“. Ändern kannst du sie dort.
          </p>
        )}
        {rights && !inherited && (
          <>
            <fieldset className="doku-choice">
              <legend>
                Rechte dieser Seite <InfoTip term="doku.eigene-rechte" />
              </legend>
              <label>
                <input type="radio" checked={!own} onChange={() => setOwn(false)} />
                <span>
                  <strong>Wie der Arbeitsbereich „{space}“</strong>
                  <span className="small">Ändert sich mit dem Arbeitsbereich.</span>
                </span>
              </label>
              <label>
                <input type="radio" checked={own} onChange={() => setOwn(true)} />
                <span>
                  <strong>Eigene Rechte</strong>
                  <span className="small">
                    Gelten für diese Seite und ihre Unterseiten, im Seitenbaum mit Schloss.
                  </span>
                </span>
              </label>
            </fieldset>
            {own && (
              <MembersEditor
                people={people}
                roles={PAGE_ROLE_LABELS}
                defaultRole="read"
                caption="Rechte dieser Seite"
                pickerLabel="Person hinzufügen"
                fixed={new Set(members.map((member) => member.oid))}
                onChange={setPeople}
              />
            )}
            <p className="small">Rechte ändern darf jede Person, die die Seite bearbeiten darf.</p>
            <div className="confirm-actions">
              <button type="button" className="button button-secondary" onClick={onClose}>
                Abbrechen
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={save}
              >
                Speichern
              </button>
            </div>
          </>
        )}
        {rights?.can_manage_space && (
          <details className="doku-space-members">
            <summary>Personen im Arbeitsbereich „{space}“</summary>
            <p className="small">
              Diese Rechte gelten für alle Seiten im Arbeitsbereich. Seiten mit Schloss haben eigene
              Rechte; dort zählt eine abweichende Angabe.
            </p>
            <MembersEditor
              people={members}
              roles={SPACE_ROLE_LABELS}
              defaultRole="read"
              caption="Personen im Arbeitsbereich"
              pickerLabel="Person zum Arbeitsbereich hinzufügen"
              roleLabel="Rolle im Arbeitsbereich für"
              onChange={setMembers}
            />
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              onClick={saveSpace}
            >
              Personen speichern
            </button>
          </details>
        )}
      </div>
    </div>,
    document.body,
  );
}
