import { EmojiPicker } from "../../components/EmojiPicker";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Segmented } from "../../components/Field";
import { errorText, formatDateTime } from "../../api";
import { useConfirm } from "../../components/ConfirmDialog";
import { Feedback, type FeedbackMessage } from "../../components/Feedback";
import { InfoTip } from "../../components/InfoTip";
import { Tabs, tabIds } from "../../components/Tabs";
import { navigate } from "../../router";
import { MembersEditor } from "./MembersEditor";
import {
  ADMIN_TABS,
  adminPath,
  createSpace,
  deleteSpace,
  fetchAdminSpaces,
  fetchDokuSettings,
  fetchOwnRights,
  fetchTrash,
  notifyTreeChanged,
  purgeTrash,
  resetRights,
  restoreTrash,
  saveDokuSettings,
  SPACE_ROLE_LABELS,
  updateSpace,
  type AdminSpace,
  type AdminTab,
  type DokuSettings,
  type OwnRightsPage,
  type PersonRight,
  type TrashItem,
} from "./api";

type Notify = (message: FeedbackMessage) => void;

function SpaceForm({
  space,
  onSaved,
  onCancel,
  notify,
}: {
  space: AdminSpace | null;
  onSaved: () => void;
  onCancel: () => void;
  notify: Notify;
}) {
  const id = useId();
  const [name, setName] = useState(space?.name ?? "");
  const [description, setDescription] = useState(space?.description ?? "");
  const [icon, setIcon] = useState(space?.icon ?? "");
  const [archived, setArchived] = useState(space?.archived ?? false);
  const [members, setMembers] = useState<PersonRight[]>(space?.members ?? []);
  const [busy, setBusy] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const body = {
      name: name.trim(),
      description: description.trim(),
      icon,
      archived,
      members,
    };
    (space ? updateSpace(space.id, body) : createSpace(body)).then(
      () => {
        notifyTreeChanged();
        notify({ kind: "status", text: "Der Arbeitsbereich wurde gespeichert." });
        onSaved();
      },
      (problem: unknown) => {
        setBusy(false);
        notify({
          kind: "alert",
          text: errorText(problem, "Der Arbeitsbereich konnte nicht gespeichert werden."),
        });
      },
    );
  };
  return (
    <form className="panel doku-space-form" onSubmit={submit} aria-labelledby={`${id}-titel`}>
      <h3 id={`${id}-titel`}>{space ? `„${space.name}“ bearbeiten` : "Neuer Arbeitsbereich"}</h3>
      <label className="doku-field">
        <span>Name</span>
        <input value={name} maxLength={120} required onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="doku-field">
        <span>Emoji (freiwillig)</span>
        <EmojiPicker value={icon} onChange={setIcon} label="Emoji des Arbeitsbereichs wählen" />
      </div>
      <label className="doku-field">
        <span>Beschreibung (freiwillig)</span>
        <input
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      {space && (
        <label className="doku-check">
          <input
            type="checkbox"
            className="check"
            checked={archived}
            onChange={() => setArchived(!archived)}
          />
          <span>Archiviert (nur noch lesbar)</span>
        </label>
      )}
      <h4>Personen</h4>
      <MembersEditor
        people={members}
        roles={SPACE_ROLE_LABELS}
        defaultRole="edit"
        caption="Personen im Arbeitsbereich"
        pickerLabel="Person hinzufügen"
        onChange={setMembers}
      />
      <div className="doku-actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          {space ? "Änderungen speichern" : "Arbeitsbereich anlegen"}
        </button>
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function SpacesTab({ notify }: { notify: Notify }) {
  const [spaces, setSpaces] = useState<AdminSpace[] | null>(null);
  const [editing, setEditing] = useState<AdminSpace | "neu" | null>(null);
  const [ask, dialog] = useConfirm();
  const load = useCallback(() => {
    fetchAdminSpaces().then(setSpaces, (problem: unknown) =>
      notify({ kind: "alert", text: errorText(problem, "Konnte nicht geladen werden.") }),
    );
  }, [notify]);
  useEffect(load, [load]);
  return (
    <>
      <p className="page-sub">
        Hier legst du Arbeitsbereiche an und ordnest Personen zu.{" "}
        <InfoTip term="doku.arbeitsbereich" />
      </p>
      {editing === null && (
        <button type="button" className="button button-primary" onClick={() => setEditing("neu")}>
          Arbeitsbereich anlegen
        </button>
      )}
      {editing !== null && (
        <SpaceForm
          space={editing === "neu" ? null : editing}
          notify={notify}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {spaces === null && <p role="status">Wird geladen …</p>}
      {spaces?.length === 0 && <p>Noch keine Arbeitsbereiche.</p>}
      {spaces && spaces.length > 0 && (
        <div className="table-wrap card-wrap">
          <table className="table-cards">
            <caption className="visually-hidden">Arbeitsbereiche</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Personen</th>
                <th scope="col">Seiten</th>
                <th scope="col">mit Schloss</th>
                <th scope="col">Zuletzt geändert</th>
                <th scope="col">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {spaces.map((space) => (
                <tr key={space.id}>
                  <th scope="row">
                    {space.icon && <span aria-hidden="true">{space.icon} </span>}
                    {space.name}
                    {space.archived && <span className="doku-badge">archiviert</span>}
                    {space.description && (
                      <span className="small doku-cell-sub">{space.description}</span>
                    )}
                  </th>
                  <td data-label="Personen">{space.people}</td>
                  <td data-label="Seiten">{space.pages}</td>
                  <td data-label="mit Schloss">{space.own_rights}</td>
                  <td data-label="Zuletzt geändert">{formatDateTime(space.updated_at)}</td>
                  <td className="doku-row-actions" data-label="Aktionen">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => setEditing(space)}
                    >
                      Bearbeiten<span className="visually-hidden">{`: ${space.name}`}</span>
                    </button>
                    {space.pages === 0 && (
                      <button
                        type="button"
                        className="button button-secondary doku-danger"
                        onClick={() =>
                          ask(
                            {
                              title: `Arbeitsbereich „${space.name}“ löschen?`,
                              text: "Der Arbeitsbereich und seine Zuordnungen verschwinden. Das lässt sich nicht rückgängig machen.",
                              action: "Löschen",
                              danger: true,
                            },
                            () =>
                              deleteSpace(space.id).then(
                                () => {
                                  notifyTreeChanged();
                                  notify({
                                    kind: "status",
                                    text: "Der Arbeitsbereich wurde gelöscht.",
                                  });
                                  load();
                                },
                                (problem: unknown) =>
                                  notify({
                                    kind: "alert",
                                    text: errorText(problem, "Konnte nicht gelöscht werden."),
                                  }),
                              ),
                          )
                        }
                      >
                        Löschen<span className="visually-hidden">{`: ${space.name}`}</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small">
        Archivierte Arbeitsbereiche sind nur noch lesbar und stehen im Seitenbaum mit „Archiv“.
      </p>
      {dialog}
    </>
  );
}

function RightsTab({ notify }: { notify: Notify }) {
  const [pages, setPages] = useState<OwnRightsPage[] | null>(null);
  const [ask, dialog] = useConfirm();
  const load = useCallback(() => {
    fetchOwnRights().then(setPages, (problem: unknown) =>
      notify({ kind: "alert", text: errorText(problem, "Konnte nicht geladen werden.") }),
    );
  }, [notify]);
  useEffect(load, [load]);
  return (
    <>
      <p className="page-sub">
        Alle Seiten, deren Rechte vom Arbeitsbereich abweichen, und was genau anders ist.
      </p>
      {pages === null && <p role="status">Wird geladen …</p>}
      {pages?.length === 0 && <p>Keine Seite hat eigene Rechte.</p>}
      {pages && pages.length > 0 && (
        <div className="table-wrap card-wrap">
          <table className="table-cards">
            <caption className="visually-hidden">Seiten mit eigenen Rechten</caption>
            <thead>
              <tr>
                <th scope="col">Seite</th>
                <th scope="col">Arbeitsbereich</th>
                <th scope="col">Abweichung</th>
                <th scope="col">Geändert von</th>
                <th scope="col">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <tr key={page.id}>
                  <th scope="row">{page.title}</th>
                  <td data-label="Arbeitsbereich">{page.space}</td>
                  <td data-label="Abweichung">{page.summary}</td>
                  <td data-label="Geändert von">
                    {page.changed_by_name}
                    {page.changed_at && (
                      <span className="small doku-cell-sub">{formatDateTime(page.changed_at)}</span>
                    )}
                  </td>
                  <td data-label="Aktionen">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() =>
                        ask(
                          {
                            title: `Rechte von „${page.title}“ zurücksetzen?`,
                            text: "Die eigenen Rechte werden entfernt. Danach gelten wieder die Rechte des Arbeitsbereichs, auch für die Unterseiten.",
                            action: "Zurücksetzen",
                          },
                          () =>
                            resetRights(page.id).then(
                              () => {
                                notifyTreeChanged();
                                notify({
                                  kind: "status",
                                  text: "Die Rechte wurden zurückgesetzt.",
                                });
                                load();
                              },
                              (problem: unknown) =>
                                notify({
                                  kind: "alert",
                                  text: errorText(problem, "Konnte nicht zurückgesetzt werden."),
                                }),
                            ),
                        )
                      }
                    >
                      Auf Arbeitsbereich zurücksetzen
                      <span className="visually-hidden">{`: ${page.title}`}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog}
    </>
  );
}

function VersionsTab({ notify }: { notify: Notify }) {
  const [settings, setSettings] = useState<DokuSettings | null>(null);
  useEffect(() => {
    fetchDokuSettings().then(setSettings, (problem: unknown) =>
      notify({ kind: "alert", text: errorText(problem, "Konnte nicht geladen werden.") }),
    );
  }, [notify]);
  if (!settings) {
    return <p role="status">Wird geladen …</p>;
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    saveDokuSettings(settings).then(
      (saved) => {
        setSettings(saved);
        notify({ kind: "status", text: "Die Einstellungen wurden gespeichert." });
      },
      (problem: unknown) =>
        notify({ kind: "alert", text: errorText(problem, "Konnte nicht gespeichert werden.") }),
    );
  };
  return (
    <form className="panel doku-settings" onSubmit={submit}>
      <Segmented
        label="Automatische Version nach"
        value={String(settings.version_minutes)}
        options={[
          { value: "5", label: "5 Minuten Bearbeitung" },
          { value: "10", label: "10 Minuten Bearbeitung" },
          { value: "30", label: "30 Minuten Bearbeitung" },
        ]}
        onChange={(value) =>
          setSettings({
            ...settings,
            version_minutes: Number(value) as DokuSettings["version_minutes"],
          })
        }
      />
      <Segmented
        label="Automatische Versionen aufbewahren"
        value={settings.keep_auto}
        options={[
          { value: "1y", label: "1 Jahr" },
          { value: "immer", label: "immer" },
        ]}
        onChange={(keep_auto) => setSettings({ ...settings, keep_auto })}
      />
      <p className="small">
        Benannte Versionen bleiben immer erhalten. Ältere automatische Versionen werden nachts
        gelöscht, die jüngste je Tag bleibt.
      </p>
      <button type="submit" className="button button-primary">
        Einstellungen speichern
      </button>
    </form>
  );
}

function TrashTab({ notify }: { notify: Notify }) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [ask, dialog] = useConfirm();
  const load = useCallback(() => {
    fetchTrash().then(setItems, (problem: unknown) =>
      notify({ kind: "alert", text: errorText(problem, "Konnte nicht geladen werden.") }),
    );
  }, [notify]);
  useEffect(load, [load]);
  const done = (text: string) => () => {
    notifyTreeChanged();
    notify({ kind: "status", text });
    load();
  };
  const failed = (text: string) => (problem: unknown) =>
    notify({ kind: "alert", text: errorText(problem, text) });
  return (
    <>
      <p className="page-sub">
        Gelöschte Seiten bleiben 30 Tage hier, danach werden sie endgültig gelöscht.
      </p>
      {items === null && <p role="status">Wird geladen …</p>}
      {items?.length === 0 && <p>Der Papierkorb ist leer.</p>}
      {items && items.length > 0 && (
        <div className="table-wrap card-wrap">
          <table className="table-cards">
            <caption className="visually-hidden">Papierkorb</caption>
            <thead>
              <tr>
                <th scope="col">Seite</th>
                <th scope="col">Arbeitsbereich</th>
                <th scope="col">Gelöscht von</th>
                <th scope="col">Endgültig weg am</th>
                <th scope="col">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <th scope="row">
                    {item.title}
                    {item.pages > 1 && (
                      <span className="small doku-cell-sub">mit {item.pages - 1} Unterseiten</span>
                    )}
                  </th>
                  <td data-label="Arbeitsbereich">{item.space}</td>
                  <td data-label="Gelöscht von">
                    {item.deleted_by_name}
                    <span className="small doku-cell-sub">{formatDateTime(item.deleted_at)}</span>
                  </td>
                  <td data-label="Endgültig weg am">{formatDateTime(item.purge_at)}</td>
                  <td className="doku-row-actions" data-label="Aktionen">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() =>
                        restoreTrash(item.id).then(
                          done("Die Seite wurde wiederhergestellt."),
                          failed("Konnte nicht wiederhergestellt werden."),
                        )
                      }
                    >
                      Wiederherstellen<span className="visually-hidden">{`: ${item.title}`}</span>
                    </button>
                    <button
                      type="button"
                      className="button button-secondary doku-danger"
                      onClick={() =>
                        ask(
                          {
                            title: `„${item.title}“ endgültig löschen?`,
                            text: "Die Seite, ihre Unterseiten und alle Versionen werden sofort gelöscht. Das lässt sich nicht rückgängig machen.",
                            action: "Endgültig löschen",
                            danger: true,
                          },
                          () =>
                            purgeTrash(item.id).then(
                              done("Die Seite wurde endgültig gelöscht."),
                              failed("Konnte nicht gelöscht werden."),
                            ),
                        )
                      }
                    >
                      Endgültig löschen<span className="visually-hidden">{`: ${item.title}`}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog}
    </>
  );
}

/** Verwaltung der Dokumentation (nur Doku-Verwaltung). */
export function DokuAdminPage({ tab }: { tab: AdminTab }) {
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  const notify = useCallback((next: FeedbackMessage) => setMessage(next), []);
  const ids = tabIds("doku-verwaltung", tab);
  return (
    <div className="page page-wide">
      <header className="page-head">
        <p className="module-label">Dokumentation</p>
        <h1>Verwaltung</h1>
        <p className="page-sub">
          Siehst du nur mit der Rolle Doku-Verwaltung. Inhalte von Seiten siehst du hier nicht.
        </p>
      </header>
      <Tabs
        label="Verwaltung der Dokumentation"
        prefix="doku-verwaltung"
        tabs={ADMIN_TABS}
        value={tab}
        onChange={(next) => navigate(adminPath(next))}
      />
      <div id={ids.panel} role="tabpanel" aria-labelledby={ids.tab} className="doku-admin-panel">
        {tab === "arbeitsbereiche" && <SpacesTab notify={notify} />}
        {tab === "rechte" && <RightsTab notify={notify} />}
        {tab === "versionen" && <VersionsTab notify={notify} />}
        {tab === "papierkorb" && <TrashTab notify={notify} />}
      </div>
      <Feedback message={message} onClose={() => setMessage(null)} />
    </div>
  );
}
