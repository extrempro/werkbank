import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { ConfirmButton } from "../../components/ConfirmDialog";
import { Feedback } from "../../components/Feedback";
import { Field } from "../../components/Field";
import { InfoTip } from "../../components/InfoTip";
import { ListChoice } from "../../components/ListChoice";
import type { Kind } from "./api";
import {
  addAccessory,
  addTemplate,
  fetchIssueSettings,
  REASON_LABELS,
  removeAccessory,
  removeTemplate,
  saveRules,
  type IssueReason,
  type IssueSettings,
} from "./issuesApi";

type Notice = { kind: "status" | "alert"; text: string } | null;

/** Stammdaten › Ausgabe: Zubehör je Art, Vorlagen der Checkliste, Nutzungsregeln. */
export function IssueSettingsPanel({ kinds, canEdit }: { kinds: Kind[]; canEdit: boolean }) {
  const [settings, setSettings] = useState<IssueSettings | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [accessoryKind, setAccessoryKind] = useState("");
  const [accessory, setAccessory] = useState("");
  const [target, setTarget] = useState("-1");
  const [label, setLabel] = useState("");
  const [rules, setRules] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchIssueSettings().then(
      (result) => {
        if (active) {
          setSettings(result);
          setRules(result.rules_text);
        }
      },
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Die Einstellungen konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, []);

  if (failed) {
    return (
      <p role="alert" className="hint-box hint-bad">
        {failed}
      </p>
    );
  }
  if (!settings) {
    return <p role="status">Wird geladen …</p>;
  }

  const run = (promise: Promise<IssueSettings>, text: string, then?: () => void) => {
    setBusy(true);
    return promise.then(
      (next) => {
        setSettings(next);
        setBusy(false);
        setNotice({ kind: "status", text });
        then?.();
      },
      (problem: unknown) => {
        setBusy(false);
        setNotice({ kind: "alert", text: errorText(problem, "Das hat nicht geklappt.") });
      },
    );
  };

  const kindOptions = kinds.map((kind) => ({ id: kind.id, label: kind.name }));
  const targetOptions = [
    ...(Object.keys(REASON_LABELS) as IssueReason[]).map((reason, index) => ({
      id: -(index + 1),
      label: `Anlass: ${REASON_LABELS[reason]}`,
      reason,
    })),
    ...kinds.map((kind) => ({ id: kind.id, label: `Art: ${kind.name}`, reason: null })),
  ];
  const chosenTarget = targetOptions.find((entry) => String(entry.id) === target) ?? null;

  const onAccessory = (event: FormEvent) => {
    event.preventDefault();
    if (!accessoryKind || !accessory.trim()) {
      setNotice({ kind: "alert", text: "Bitte wähle eine Art und trag das Zubehör ein." });
      return;
    }
    void run(
      addAccessory(Number(accessoryKind), accessory.trim()),
      "Das Zubehör ist angelegt.",
      () => setAccessory(""),
    );
  };

  const onTemplate = (event: FormEvent) => {
    event.preventDefault();
    if (!chosenTarget || !label.trim()) {
      setNotice({ kind: "alert", text: "Bitte wähle, wofür der Punkt gilt, und trag ihn ein." });
      return;
    }
    void run(
      addTemplate(
        chosenTarget.reason ? { reason: chosenTarget.reason } : { kind_id: chosenTarget.id },
        label.trim(),
      ),
      "Der Punkt ist in der Vorlage.",
      () => setLabel(""),
    );
  };

  const groups = targetOptions
    .map((entry) => ({
      ...entry,
      items: settings.templates.filter((row) =>
        entry.reason ? row.reason === entry.reason : row.kind_id === entry.id,
      ),
    }))
    .filter((entry) => entry.items.length > 0);

  return (
    <>
      <Feedback message={notice} onClose={() => setNotice(null)} />
      <section className="panel" aria-labelledby="stamm-zubehoer">
        <div className="panel-head">
          <h2 id="stamm-zubehoer">Zubehör je Hardware-Art</h2>
        </div>
        <div className="detail-body form-stack">
          <p className="small">
            Wird bei einer Ausgabe zum Gerät dieser Art zum Ankreuzen angeboten.
          </p>
          {canEdit && (
            <form className="form-grid" onSubmit={onAccessory} noValidate>
              <ListChoice
                label="Hardware-Art"
                options={kindOptions}
                value={accessoryKind}
                onChange={setAccessoryKind}
                compact
              />
              <Field label="Zubehör" hint="z. B. Netzteil, Tasche, Headset">
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    maxLength={80}
                    value={accessory}
                    onChange={(event) => setAccessory(event.target.value)}
                  />
                )}
              </Field>
              <div className="project-actions field-wide">
                <button type="submit" className="button button-secondary" disabled={busy}>
                  Zubehör anlegen
                </button>
              </div>
            </form>
          )}
          {settings.accessories.length === 0 ? (
            <p className="empty">Noch kein Zubehör.</p>
          ) : (
            <ul className="link-list">
              {settings.accessories.map((row) => (
                <li key={row.id}>
                  <span className="small">{row.kind}:</span> {row.name}{" "}
                  {canEdit && (
                    <ConfirmButton
                      className="button-link"
                      disabled={busy}
                      confirm={{
                        title: "Zubehör entfernen?",
                        text: `„${row.name}“ wird bei ${row.kind} nicht mehr angeboten. Bestehende Ausgaben behalten es.`,
                        action: "Entfernen",
                        danger: true,
                      }}
                      onConfirm={() => run(removeAccessory(row.id), "Das Zubehör ist entfernt.")}
                    >
                      Entfernen
                    </ConfirmButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="panel" aria-labelledby="stamm-checkliste">
        <div className="panel-head">
          <h2 id="stamm-checkliste">
            Vorlagen der Checkliste <InfoTip term="bestand.ausgabe-vorbereitung" />
          </h2>
        </div>
        <div className="detail-body form-stack">
          <p className="small">
            Bei einer neuen Ausgabe kommen erst die Punkte des Anlasses, dann für jedes Gerät die
            Punkte seiner Art. Änderungen gelten nur für neue Ausgaben.
          </p>
          {canEdit && (
            <form className="form-grid" onSubmit={onTemplate} noValidate>
              <ListChoice
                label="Gilt für"
                options={targetOptions.map(({ id, label: text }) => ({ id, label: text }))}
                value={target}
                onChange={setTarget}
                compact
              />
              <Field label="Punkt" hint="z. B. „In Intune registriert“">
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    maxLength={160}
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                  />
                )}
              </Field>
              <div className="project-actions field-wide">
                <button type="submit" className="button button-secondary" disabled={busy}>
                  Punkt hinzufügen
                </button>
              </div>
            </form>
          )}
          {groups.length === 0 ? (
            <p className="empty">Noch keine Vorlagen.</p>
          ) : (
            groups.map((group) => (
              <div key={group.id}>
                <h3 className="sub-head">{group.label}</h3>
                <ul className="link-list">
                  {group.items.map((row) => (
                    <li key={row.id}>
                      {row.label}{" "}
                      {canEdit && (
                        <ConfirmButton
                          className="button-link"
                          disabled={busy}
                          confirm={{
                            title: "Punkt entfernen?",
                            text: `„${row.label}“ kommt bei neuen Ausgaben nicht mehr in die Checkliste.`,
                            action: "Entfernen",
                            danger: true,
                          }}
                          onConfirm={() => run(removeTemplate(row.id), "Der Punkt ist entfernt.")}
                        >
                          Entfernen
                        </ConfirmButton>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel" aria-labelledby="stamm-regeln">
        <div className="panel-head">
          <h2 id="stamm-regeln">
            Nutzungsregeln <InfoTip term="bestand.nutzungsregeln" />
          </h2>
        </div>
        <form
          className="detail-body form-stack"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void run(saveRules(rules), "Die Nutzungsregeln sind gespeichert.");
          }}
        >
          <Field
            label="Text"
            hint="Nur Text, bis 5000 Zeichen. Leer lassen: Ausgaben ohne Nutzungsregeln."
            wide
          >
            {(control) => (
              <textarea
                {...control}
                rows={8}
                maxLength={5000}
                value={rules}
                disabled={!canEdit}
                onChange={(event) => setRules(event.target.value)}
              />
            )}
          </Field>
          {canEdit && (
            <div className="project-actions">
              <button
                type="submit"
                className="button button-primary"
                disabled={busy || rules === settings.rules_text}
              >
                Nutzungsregeln speichern
              </button>
            </div>
          )}
        </form>
      </section>
    </>
  );
}
