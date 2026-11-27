import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from "react";
import { errorText } from "../../api";
import { EmojiPicker } from "../../components/EmojiPicker";
import { Field } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { navigate } from "../../router";
import { NewPageDialog } from "./NewPageDialog";
import {
  buildTree,
  createPage,
  notifyTreeChanged,
  DOKU_ADMIN_PATH,
  DOKU_PATH,
  fetchDokuMe,
  fetchTree,
  pagePath,
  searchPages,
  TREE_CHANGED,
  type PageNode,
  type SearchHit,
  type TreeSpace,
} from "./api";

/** Seitenbaum und Rechte laden; lädt neu, wenn sich etwas geändert hat. */
export function useDokuTree(): {
  spaces: TreeSpace[] | null;
  isAdmin: boolean;
  failed: string | null;
} {
  const [spaces, setSpaces] = useState<TreeSpace[] | null>(null);
  const [isAdmin, setAdmin] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => {
      Promise.all([fetchTree(), fetchDokuMe()]).then(
        ([tree, me]) => {
          if (active) {
            setSpaces(tree);
            setAdmin(me.is_admin);
            setFailed(null);
          }
        },
        (error: unknown) =>
          active && setFailed(errorText(error, "Die Seiten konnten nicht geladen werden.")),
      );
    };
    load();
    window.addEventListener(TREE_CHANGED, load);
    return () => {
      active = false;
      window.removeEventListener(TREE_CHANGED, load);
    };
  }, []);
  return { spaces, isAdmin, failed };
}

/** Wege zu einer Seite: alle Seiten darüber (zum Aufklappen). */
function ancestors(spaces: TreeSpace[], id: string | null): Set<string> {
  const result = new Set<string>();
  if (!id) {
    return result;
  }
  for (const space of spaces) {
    const byId = new Map(space.pages.map((page) => [page.id, page]));
    let current = byId.get(id);
    if (!current) {
      continue;
    }
    result.add(`s${space.id}`);
    while (current?.parent_id) {
      result.add(current.parent_id);
      current = byId.get(current.parent_id);
    }
  }
  return result;
}

/** Wo gerade eine Seite direkt im Baum angelegt wird: oben im Arbeitsbereich oder unter einer Seite. */
interface Adding {
  spaceId: number;
  parentId: string | null;
}

/** Titel (und wahlweise Emoji) einer neuen Seite direkt im Baum; Enter legt an, Esc bricht ab. */
function InlineNewPage({
  spaceId,
  parentId,
  where,
  onDone,
  onCreated,
}: {
  spaceId: number;
  parentId: string | null;
  /** Beschriftung, z. B. „Unterseite zu „Netzwerk““ */
  where: string;
  onDone: () => void;
  onCreated?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const submit = () => {
    const text = title.trim();
    if (!text) {
      onDone();
      return;
    }
    setBusy(true);
    setError(null);
    createPage({ space_id: spaceId, parent_id: parentId, title: text, icon }).then(
      (page) => {
        notifyTreeChanged();
        onDone();
        onCreated?.();
        navigate(pagePath(page.id));
      },
      (problem: unknown) => {
        setBusy(false);
        setError(errorText(problem, "Die Seite konnte nicht angelegt werden."));
        input.current?.focus();
      },
    );
  };

  return (
    <form
      className="doku-tree-new"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field label={where} hint="Enter legt an und öffnet die Seite, Esc bricht ab." error={error}>
        {(control) => (
          <div className="doku-tree-new-row">
            <EmojiPicker value={icon} onChange={setIcon} label="Emoji wählen" disabled={busy} />
            <input
              {...control}
              ref={input}
              value={title}
              maxLength={200}
              autoComplete="off"
              placeholder="Titel"
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  onDone();
                }
              }}
            />
          </div>
        )}
      </Field>
    </form>
  );
}

interface MenuProps {
  /** Geöffnete Seite (für Hervorhebung und offenen Weg). */
  pageId: string | null;
  adminOpen: boolean;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void;
  /** Nach dem Anlegen im Baum (die Seite wird dann geöffnet), z. B. um das Blatt am Handy zu schließen */
  onCreated?: () => void;
}

/**
 * Inhalt des Doku-Menüs: Suche, „Neue Seite“, die Arbeitsbereiche mit ihren Seiten als Baum
 * und für die Doku-Verwaltung der Weg zur Verwaltung. Steht im Seitenmenü und am Handy im Blatt.
 */
export function DokuMenuContent({ pageId, adminOpen, onNavigate, onCreated }: MenuProps) {
  const { spaces, isAdmin, failed } = useDokuTree();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState<Adding | null>(null);
  const baseId = useId();
  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) {
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      searchPages(term).then(
        (result) => active && setHits(result),
        () => active && setHits([]),
      );
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [term]);

  const onPath = useMemo(() => ancestors(spaces ?? [], pageId), [spaces, pageId]);
  const isOpen = (key: string, fallback: boolean) => open[key] ?? (onPath.has(key) || fallback);
  const toggle = (key: string, fallback: boolean) =>
    setOpen({ ...open, [key]: !isOpen(key, fallback) });
  const canCreate = (spaces ?? []).some(
    (space) => space.role === "edit" || space.role === "manage",
  );

  const link = (path: string, children: React.ReactNode, current: boolean, className?: string) => (
    <a
      href={path}
      className={className}
      aria-current={current ? "page" : undefined}
      onClick={(event) => onNavigate(event, path)}
    >
      {children}
    </a>
  );

  const startAdding = (spaceId: number, parentId: string | null) => {
    const same = adding?.spaceId === spaceId && adding.parentId === parentId;
    setAdding(same ? null : { spaceId, parentId });
    if (!same && parentId) {
      setOpen((current) => ({ ...current, [parentId]: true }));
    }
  };

  const renderPages = (nodes: PageNode[], depth: number, space: TreeSpace) => (
    <ul className="doku-tree-list" role={depth === 0 ? undefined : "group"}>
      {nodes.map((node) => {
        const expanded = isOpen(node.id, false);
        const canAdd = node.can_edit && !node.locked && !space.archived;
        const addingHere = adding?.spaceId === space.id && adding.parentId === node.id;
        return (
          <li key={node.id} className="doku-tree-item">
            <div className="doku-tree-row">
              {node.children.length > 0 ? (
                <button
                  type="button"
                  className="doku-tree-toggle"
                  aria-expanded={expanded}
                  aria-label={`${node.title} ${expanded ? "zuklappen" : "aufklappen"}`}
                  onClick={() => toggle(node.id, false)}
                >
                  <Icon name={expanded ? "pfeil-unten" : "pfeil-rechts"} />
                </button>
              ) : (
                <span className="doku-tree-toggle" aria-hidden="true" />
              )}
              {link(
                pagePath(node.id),
                <>
                  {node.icon && (
                    <span className="doku-emoji" aria-hidden="true">
                      {node.icon}
                    </span>
                  )}
                  <span className="doku-tree-title">{node.title}</span>
                  {node.own_rights && (
                    <span className="doku-tree-mark" title="eigene Rechte">
                      <Icon name="schloss" />
                      <span className="visually-hidden"> (eigene Rechte)</span>
                    </span>
                  )}
                  {node.locked && <span className="visually-hidden"> (gesperrt)</span>}
                </>,
                node.id === pageId,
                "doku-tree-link",
              )}
              {canAdd && (
                <button
                  type="button"
                  className="doku-tree-add"
                  aria-label={`Unterseite zu ${node.title} anlegen`}
                  title="Unterseite anlegen"
                  aria-expanded={addingHere}
                  onClick={() => startAdding(space.id, node.id)}
                >
                  <Icon name="plus" />
                </button>
              )}
            </div>
            {addingHere && (
              <InlineNewPage
                spaceId={space.id}
                parentId={node.id}
                where={`Unterseite zu „${node.title}“`}
                onDone={() => setAdding(null)}
                onCreated={onCreated}
              />
            )}
            {expanded && node.children.length > 0 && renderPages(node.children, depth + 1, space)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <div className="handbook-menu-search">
        <label htmlFor={`${baseId}-suche`}>Seiten durchsuchen</label>
        <input
          id={`${baseId}-suche`}
          type="search"
          value={query}
          maxLength={100}
          autoComplete="off"
          placeholder="Titel oder Text"
          onChange={(event) => {
            setQuery(event.target.value);
            if (event.target.value.trim().length < 2) {
              setHits(null);
            }
          }}
        />
      </div>
      {canCreate && (
        <button
          type="button"
          className="button button-secondary doku-new"
          onClick={() => setCreating(true)}
        >
          <Icon name="plus" />
          Neue Seite
        </button>
      )}
      <div className="side-groups">
        {failed && (
          <p className="small" role="alert">
            {failed}
          </p>
        )}
        {term.length >= 2 ? (
          <div className="side-group">
            <p className="side-subhead" role="status">
              {hits === null
                ? "Wird gesucht …"
                : hits.length === 0
                  ? "Keine Treffer"
                  : `${hits.length} Treffer`}
            </p>
            <ul>
              {(hits ?? []).map((hit) => (
                <li className="side-item" key={hit.id}>
                  {link(
                    pagePath(hit.id),
                    <span className="nav-label">
                      {hit.icon && <span aria-hidden="true">{hit.icon} </span>}
                      {hit.title}
                      <span className="small doku-hit-space"> · {hit.space}</span>
                    </span>,
                    hit.id === pageId,
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <ul className="handbook-menu-home">
              <li className="side-item">
                {link(
                  DOKU_PATH,
                  <span className="nav-label">Übersicht</span>,
                  pageId === null && !adminOpen,
                )}
              </li>
            </ul>
            {spaces === null && !failed && <p className="small">Wird geladen …</p>}
            {spaces?.map((space) => {
              const key = `s${space.id}`;
              const expanded = isOpen(key, spaces.length <= 3 && !space.archived);
              const listId = `${baseId}-${space.id}`;
              const canAdd = !space.archived && (space.role === "edit" || space.role === "manage");
              const addingHere = adding?.spaceId === space.id && adding.parentId === null;
              return (
                <div className="side-group doku-space" key={space.id}>
                  <div className="doku-space-head">
                    <button
                      type="button"
                      className="side-group-toggle handbook-area-toggle"
                      aria-expanded={expanded}
                      aria-controls={listId}
                      onClick={() => toggle(key, spaces.length <= 3 && !space.archived)}
                    >
                      <Icon name="pfeil-unten" />
                      <span className="handbook-area-title">
                        {space.icon && (
                          <span className="doku-emoji" aria-hidden="true">
                            {space.icon}{" "}
                          </span>
                        )}
                        {space.name}
                        {space.archived && <span className="small"> · Archiv</span>}
                      </span>
                      <span className="handbook-area-count" aria-hidden="true">
                        {space.pages.length}
                      </span>
                    </button>
                    {canAdd && (
                      <button
                        type="button"
                        className="doku-tree-add"
                        aria-label={`Neue Seite in ${space.name} anlegen`}
                        title="Neue Seite anlegen"
                        aria-expanded={addingHere}
                        onClick={() => {
                          startAdding(space.id, null);
                          if (!expanded) {
                            toggle(key, spaces.length <= 3 && !space.archived);
                          }
                        }}
                      >
                        <Icon name="plus" />
                      </button>
                    )}
                  </div>
                  {addingHere && (
                    <InlineNewPage
                      spaceId={space.id}
                      parentId={null}
                      where={`Neue Seite in ${space.name}`}
                      onDone={() => setAdding(null)}
                      onCreated={onCreated}
                    />
                  )}
                  <div id={listId} hidden={!expanded}>
                    {space.pages.length === 0 ? (
                      <p className="small doku-tree-empty">Noch keine Seiten.</p>
                    ) : (
                      renderPages(buildTree(space.pages), 0, space)
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
        {isAdmin && (
          <div className="side-group">
            <p className="side-subhead">Verwaltung</p>
            <ul>
              <li className="side-item">
                {link(
                  DOKU_ADMIN_PATH,
                  <>
                    <Icon name="einstellungen" />
                    <span className="nav-label">Arbeitsbereiche</span>
                  </>,
                  adminOpen,
                )}
              </li>
            </ul>
          </div>
        )}
      </div>
      {creating && spaces && (
        <NewPageDialog spaces={spaces} parentId={pageId} onClose={() => setCreating(false)} />
      )}
    </>
  );
}

/** Seitenmenü der Dokumentation (statt der Liste aus der Navigation). */
export function DokuMenu({
  id,
  hidden,
  onCollapse,
  ...props
}: MenuProps & { id: string; hidden: boolean; onCollapse: () => void }) {
  return (
    <nav
      id={id}
      className="side-menu handbook-menu doku-menu"
      aria-label="Seiten: Dokumentation"
      hidden={hidden}
    >
      <p className="side-title">Dokumentation</p>
      <DokuMenuContent {...props} />
      <button
        type="button"
        className="side-collapse"
        aria-expanded={!hidden}
        aria-controls={id}
        onClick={onCollapse}
      >
        <Icon name="einklappen" />
        <span>Menü einklappen</span>
      </button>
    </nav>
  );
}
