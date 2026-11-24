import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { ApiError, errorText, formatDateTime } from "../../api";
import { useConfirm } from "../../components/ConfirmDialog";
import { Feedback, type FeedbackMessage } from "../../components/Feedback";
import { PHONE_QUERY, useMediaQuery } from "../../components/FilterBar";
import { Icon } from "../../components/Icon";
import { InfoTip } from "../../components/InfoTip";
import { Link } from "../../components/Link";
import { useModal } from "../../components/nav/useModal";
import { navigate } from "../../router";
import { DokuEditor } from "./DokuEditor";
import { DokuMenuContent, useDokuTree } from "./DokuMenu";
import { NewPageDialog } from "./NewPageDialog";
import { RightsDialog } from "./RightsDialog";
import { VersionsPanel } from "./VersionsPanel";
import {
  buildTree,
  deletePage,
  DOKU_PATH,
  fetchPage,
  fetchVersion,
  lockPage,
  notifyTreeChanged,
  pagePath,
  restoreVersion,
  savePage,
  type DocJson,
  type DokuPageData,
  type Version,
  type VersionDetail,
} from "./api";

/** Wartezeit nach der letzten Eingabe, bevor gespeichert wird. */
const SAVE_DELAY_MS = 1200;

type SaveState = "gespeichert" | "ungespeichert" | "speichert" | "fehler" | "konflikt";

const SAVE_TEXT: Record<SaveState, string> = {
  gespeichert: "Gespeichert",
  ungespeichert: "Änderungen noch nicht gespeichert",
  speichert: "Wird gespeichert …",
  fehler: "Nicht gespeichert",
  konflikt: "Nicht gespeichert: Seite wurde inzwischen geändert",
};

/** Am Handy: Knopf „Seiten“, der das Doku-Menü als Blatt öffnet. */
function PhonePages({ pageId }: { pageId: string | null }) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useModal(sheet, open, close);
  if (!phone) {
    return null;
  }
  const go = (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    event.preventDefault();
    setOpen(false);
    navigate(path);
  };
  return (
    <>
      <button
        type="button"
        className="button button-secondary doku-phone-pages"
        onClick={() => setOpen(true)}
      >
        <Icon name="menue" />
        Seiten
      </button>
      {open && (
        <div
          className="sheet-backdrop"
          onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
        >
          <div
            ref={sheet}
            className="sheet handbook-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="doku-seiten"
          >
            <div className="sheet-head">
              <h2 id="doku-seiten" className="sheet-title">
                Seiten
              </h2>
              <button type="button" className="sheet-close" aria-label="Schließen" onClick={close}>
                <Icon name="schliessen" />
              </button>
            </div>
            <div className="sheet-body handbook-menu">
              <DokuMenuContent pageId={pageId} adminOpen={false} onNavigate={go} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Startseite der Dokumentation: Arbeitsbereiche mit ihren obersten Seiten. */
export function DokuStartPage() {
  const { spaces, failed } = useDokuTree();
  const [creating, setCreating] = useState(false);
  const canCreate = (spaces ?? []).some(
    (space) => !space.archived && (space.role === "edit" || space.role === "manage"),
  );
  return (
    <div className="page page-wide">
      <header className="page-head">
        <p className="module-label">Dokumentation</p>
        <h1>Übersicht</h1>
        <p className="page-sub">
          Seiten deiner Arbeitsbereiche. Jede Änderung wird automatisch gespeichert.
        </p>
      </header>
      <PhonePages pageId={null} />
      {failed && (
        <p className="hint-box hint-bad" role="alert">
          {failed}
        </p>
      )}
      {!spaces && !failed && <p role="status">Wird geladen …</p>}
      {spaces?.length === 0 && (
        <p className="hint-box">
          Du bist noch in keinem Arbeitsbereich. Die Doku-Verwaltung ordnet dich einem zu.
        </p>
      )}
      {canCreate && (
        <button type="button" className="button button-primary" onClick={() => setCreating(true)}>
          <Icon name="plus" />
          Neue Seite
        </button>
      )}
      <div className="doku-spaces">
        {spaces?.map((space) => {
          const top = buildTree(space.pages);
          return (
            <section
              key={space.id}
              className="panel doku-space-card"
              aria-labelledby={`bereich-${space.id}`}
            >
              <h2 id={`bereich-${space.id}`}>
                {space.name}
                {space.archived && <span className="doku-badge">Archiv</span>}
              </h2>
              {space.description && <p className="small">{space.description}</p>}
              {top.length === 0 ? (
                <p className="small">Noch keine Seiten.</p>
              ) : (
                <ul className="doku-space-pages">
                  {top.slice(0, 12).map((page) => (
                    <li key={page.id}>
                      <Link to={pagePath(page.id)}>{page.title}</Link>
                      {page.children.length > 0 && (
                        <span className="small"> · {page.children.length} Unterseiten</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {creating && spaces && (
        <NewPageDialog spaces={spaces} parentId={null} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}

/** Grund für das Wiederherstellen (freiwillig), im Bestätigungsdialog. */
function ReasonField({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <label className="doku-field">
      <span>Grund (freiwillig)</span>
      <input
        value={value}
        maxLength={200}
        onChange={(event) => {
          setValue(event.target.value);
          onChange(event.target.value);
        }}
      />
    </label>
  );
}

/**
 * Eine Seite: Titel und Inhalt bearbeiten (automatisch gespeichert), Rechte und Teilen,
 * Sperren, Versionen ansehen und wiederherstellen, in den Papierkorb legen.
 */
export function DokuPageView({ pageId }: { pageId: string }) {
  const [page, setPage] = useState<DokuPageData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [state, setState] = useState<SaveState>("gespeichert");
  const [editorKey, setEditorKey] = useState(0);
  const [viewing, setViewing] = useState<VersionDetail | null>(null);
  const [rightsOpen, setRightsOpen] = useState(false);
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  const [ask, confirmDialog] = useConfirm();
  const draft = useRef<{ title: string; content: DocJson } | null>(null);
  const revision = useRef(0);
  const timer = useRef<number | null>(null);
  const saving = useRef(false);
  const reason = useRef("");
  const pageTitle = useRef("");

  const apply = useCallback((data: DokuPageData, remount: boolean) => {
    setPage(data);
    revision.current = data.revision;
    pageTitle.current = data.title;
    if (remount) {
      setTitle(data.title);
      draft.current = null;
      setEditorKey((key) => key + 1);
    }
  }, []);

  const load = useCallback(() => {
    fetchPage(pageId).then(
      (data) => {
        apply(data, true);
        setState("gespeichert");
        setFailed(null);
      },
      (problem: unknown) =>
        setFailed(
          problem instanceof ApiError && problem.status === 404
            ? "Diese Seite gibt es nicht oder du darfst sie nicht sehen."
            : errorText(problem, "Die Seite konnte nicht geladen werden."),
        ),
    );
  }, [pageId, apply]);

  useEffect(() => {
    load();
  }, [load]);

  const flushRef = useRef<() => void>(() => undefined);
  const flushLater = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => flushRef.current(), SAVE_DELAY_MS);
  }, []);
  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const next = draft.current;
    if (!next || saving.current) {
      return;
    }
    saving.current = true;
    setState("speichert");
    savePage(pageId, { ...next, revision: revision.current }).then(
      (data) => {
        saving.current = false;
        const renamed = next.title !== pageTitle.current;
        apply(data, false);
        if (draft.current === next) {
          draft.current = null;
          setState("gespeichert");
        } else {
          // Während des Speicherns weitergeschrieben: gleich noch einmal
          flushLater();
        }
        if (renamed) {
          notifyTreeChanged();
        }
      },
      (problem: unknown) => {
        saving.current = false;
        setState(problem instanceof ApiError && problem.status === 409 ? "konflikt" : "fehler");
        setMessage({
          kind: "alert",
          text: errorText(problem, "Die Änderung konnte nicht gespeichert werden."),
        });
      },
    );
  }, [pageId, apply, flushLater]);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Beim Verlassen der Seite: offene Änderung noch speichern bzw. im Browser warnen
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (draft.current) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      flushRef.current();
    };
  }, []);

  const change = useCallback(
    (content: DocJson) => {
      draft.current = { title: draft.current?.title ?? title, content };
      setState("ungespeichert");
      flushLater();
    },
    [title, flushLater],
  );
  const changeTitle = (value: string) => {
    setTitle(value);
    if (!value.trim()) {
      return;
    }
    draft.current = { title: value, content: draft.current?.content ?? page?.content ?? {} };
    setState("ungespeichert");
    flushLater();
  };

  const run = (action: Promise<DokuPageData>, ok: string, fail: string, remount = true) =>
    action.then(
      (data) => {
        apply(data, remount);
        notifyTreeChanged();
        setMessage({ kind: "status", text: ok });
      },
      (problem: unknown) => setMessage({ kind: "alert", text: errorText(problem, fail) }),
    );

  if (failed) {
    return (
      <div className="page page-wide">
        <PhonePages pageId={pageId} />
        <p className="hint-box hint-bad" role="alert">
          {failed}
        </p>
        <Link to={DOKU_PATH}>Zur Übersicht der Dokumentation</Link>
      </div>
    );
  }
  if (!page) {
    return (
      <p className="page-message" role="status">
        Wird geladen …
      </p>
    );
  }

  const editable = page.role === "edit" && !page.locked && !page.archived && viewing === null;
  const canChange = page.role === "edit" && !page.archived;
  const viewVersion = (version: Version) => {
    flush();
    fetchVersion(page.id, version.id).then(setViewing, (problem: unknown) =>
      setMessage({
        kind: "alert",
        text: errorText(problem, "Die Version konnte nicht geladen werden."),
      }),
    );
  };

  return (
    <div className="page page-wide doku-page">
      <PhonePages pageId={pageId} />
      <header className="doku-head">
        <div className="doku-head-text">
          <p className="module-label">Dokumentation · {page.space}</p>
          {page.path.length > 0 && (
            <nav aria-label="Pfad" className="loc-crumbs small">
              {page.path.map((crumb, index) => (
                <span key={crumb.id}>
                  {index > 0 && " › "}
                  <Link to={pagePath(crumb.id)}>{crumb.title}</Link>
                </span>
              ))}
            </nav>
          )}
          <h1 className="doku-title">
            {editable ? (
              <input
                aria-label="Titel der Seite"
                value={title}
                maxLength={200}
                onChange={(event) => changeTitle(event.target.value)}
              />
            ) : (
              (viewing?.title ?? page.title)
            )}
            {page.own_rights && (
              <span className="doku-title-mark" title="eigene Rechte">
                <Icon name="schloss" />
                <span className="visually-hidden">eigene Rechte</span>
              </span>
            )}
          </h1>
        </div>
        <div className="doku-head-actions">
          {page.role === "edit" && (
            <span className={`doku-save doku-save-${state}`} role="status">
              {SAVE_TEXT[state]}
            </span>
          )}
          {state === "konflikt" && (
            <button type="button" className="button button-secondary" onClick={load}>
              Neu laden
            </button>
          )}
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              flush();
              setRightsOpen(true);
            }}
          >
            Rechte und Teilen
          </button>
          {canChange && (
            <button
              type="button"
              className="button button-secondary"
              disabled={viewing !== null}
              onClick={() => {
                flush();
                ask(
                  page.locked
                    ? {
                        title: "Seite entsperren?",
                        text: "Danach können alle mit Bearbeiten die Seite wieder ändern.",
                        action: "Entsperren",
                      }
                    : {
                        title: "Seite sperren?",
                        text: "Niemand kann den Inhalt ändern, bis jemand mit Bearbeiten die Seite entsperrt.",
                        action: "Sperren",
                      },
                  () =>
                    run(
                      lockPage(page.id, !page.locked),
                      page.locked ? "Die Seite ist entsperrt." : "Die Seite ist gesperrt.",
                      "Das hat nicht geklappt.",
                    ),
                );
              }}
            >
              <Icon name="schloss" />
              {page.locked ? "Entsperren" : "Sperren"}
            </button>
          )}
        </div>
      </header>

      {page.locked && (
        <div className="hint-box doku-banner" role="note">
          <Icon name="schloss" />
          <span>
            <strong>Gesperrt</strong> von {page.locked_by_name} am {formatDateTime(page.locked_at)}.
            Niemand kann den Inhalt ändern. <InfoTip term="doku.sperren" />
          </span>
        </div>
      )}
      {page.archived && (
        <p className="hint-box doku-banner">
          Der Arbeitsbereich ist archiviert. Seiten lassen sich nur noch lesen.
        </p>
      )}
      {viewing && (
        <div className="hint-box doku-banner doku-version-banner" role="note">
          <span>
            <strong>Du siehst eine ältere Version:</strong> {formatDateTime(viewing.created_at)}
            {viewing.name ? ` · ${viewing.name}` : ""} · nur lesen
          </span>
          <span className="doku-actions">
            {canChange && !page.locked && (
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  reason.current = "";
                  ask(
                    {
                      title: "Version wiederherstellen?",
                      text: (
                        <>
                          <span>
                            Die Seite bekommt den Stand vom {formatDateTime(viewing.created_at)}.
                            Der jetzige Stand bleibt als Version erhalten.
                          </span>
                          <ReasonField onChange={(value) => (reason.current = value)} />
                        </>
                      ),
                      action: "Wiederherstellen",
                    },
                    () =>
                      run(
                        restoreVersion(page.id, viewing.id, reason.current.trim()),
                        "Die Version wurde wiederhergestellt.",
                        "Die Version konnte nicht wiederhergestellt werden.",
                      ).then(() => setViewing(null)),
                  );
                }}
              >
                Wiederherstellen
              </button>
            )}
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setViewing(null)}
            >
              Zur aktuellen Fassung
            </button>
          </span>
        </div>
      )}

      <div className="doku-layout">
        <article className="panel doku-article" aria-label="Seiteninhalt">
          {viewing ? (
            <DokuEditor
              key={`v${viewing.id}`}
              content={viewing.content}
              editable={false}
              label={`Version vom ${formatDateTime(viewing.created_at)}`}
            />
          ) : (
            <DokuEditor
              key={`${editorKey}-${editable ? "schreiben" : "lesen"}`}
              content={page.content}
              editable={editable}
              label="Inhalt der Seite"
              onChange={change}
            />
          )}
        </article>
        <aside className="doku-aside" aria-label="Zur Seite">
          <VersionsPanel
            pageId={page.id}
            revision={page.versions}
            canEdit={canChange}
            viewing={viewing?.id ?? null}
            onView={viewVersion}
            onFeedback={setMessage}
          />
          <section className="panel doku-side-panel" aria-labelledby="doku-seite-info">
            <h2 id="doku-seite-info">Seite</h2>
            <p className="small">
              Angelegt am {formatDateTime(page.created_at)}
              {page.created_by_name && ` von ${page.created_by_name}`}. Zuletzt geändert am{" "}
              {formatDateTime(page.updated_at)}
              {page.updated_by_name && ` von ${page.updated_by_name}`}. {page.versions} Versionen.
            </p>
            {page.rights_from && page.rights_from.id !== page.id && (
              <p className="small">
                Eigene Rechte von „
                <Link to={pagePath(page.rights_from.id)}>{page.rights_from.title}</Link>“.
              </p>
            )}
            {canChange && !page.locked && (
              <button
                type="button"
                className="button button-secondary doku-danger"
                onClick={() =>
                  ask(
                    {
                      title: "Seite in den Papierkorb legen?",
                      text: "Die Seite und alle Unterseiten verschwinden. Die Doku-Verwaltung kann sie 30 Tage lang wiederherstellen.",
                      action: "In den Papierkorb",
                      danger: true,
                    },
                    () =>
                      deletePage(page.id).then(
                        () => {
                          draft.current = null;
                          notifyTreeChanged();
                          navigate(DOKU_PATH);
                        },
                        (problem: unknown) =>
                          setMessage({
                            kind: "alert",
                            text: errorText(problem, "Die Seite konnte nicht gelöscht werden."),
                          }),
                      ),
                  )
                }
              >
                <Icon name="loeschen" />
                In den Papierkorb
              </button>
            )}
          </section>
        </aside>
      </div>
      {rightsOpen && (
        <RightsDialog
          pageId={page.id}
          spaceId={page.space_id}
          space={page.space}
          onClose={() => setRightsOpen(false)}
          onFeedback={setMessage}
          onSaved={() => fetchPage(page.id).then((data) => apply(data, false), load)}
        />
      )}
      {confirmDialog}
      <Feedback message={message} onClose={() => setMessage(null)} />
    </div>
  );
}
