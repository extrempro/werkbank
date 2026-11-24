import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { errorText } from "../../api";
import { useModal } from "../../components/nav/useModal";
import {
  buildTree,
  fetchTree,
  movePage,
  type DokuPageData,
  type PageNode,
  type TreeSpace,
} from "./api";

/** Wert der Auswahl „Oben im Arbeitsbereich“ (statt einer Seite). */
const TOP = "";
const END = "";

interface Place {
  id: string;
  label: string;
}

/** Seiten als Liste mit Einrückung; die Seite selbst und ihre Unterseiten fehlen. */
function places(nodes: PageNode[], skip: string, depth = 0): Place[] {
  return nodes.flatMap((node) =>
    node.id === skip
      ? []
      : node.can_edit
        ? [
            { id: node.id, label: `${" ".repeat(depth)}${node.title}` },
            ...places(node.children, skip, depth + 1),
          ]
        : places(node.children, skip, depth + 1),
  );
}

/**
 * Seite verschieben: neuer Platz im selben Arbeitsbereich (oben oder unter einer Seite) und
 * Reihenfolge. Unterseiten wandern mit. Lässt sich jederzeit zurückschieben, daher ohne
 * zusätzliche Bestätigung.
 */
export function MovePageDialog({
  page,
  onClose,
  onMoved,
}: {
  page: DokuPageData;
  onClose: () => void;
  onMoved: (data: DokuPageData) => void;
}) {
  const box = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const [space, setSpace] = useState<TreeSpace | null>(null);
  const [parent, setParent] = useState<string>(page.parent_id ?? TOP);
  const [before, setBefore] = useState<string>(END);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useModal(box, true, onClose);

  useEffect(() => {
    let alive = true;
    fetchTree().then(
      (spaces) => alive && setSpace(spaces.find((entry) => entry.id === page.space_id) ?? null),
      (problem: unknown) =>
        alive && setError(errorText(problem, "Die Seiten konnten nicht geladen werden.")),
    );
    return () => {
      alive = false;
    };
  }, [page.space_id]);

  const tree = space ? buildTree(space.pages) : [];
  const targets = places(tree, page.id);
  const canTop = space?.role === "edit" || space?.role === "manage";
  const ordered = (parentId: string) =>
    (space?.pages ?? [])
      .filter((p) => (p.parent_id ?? TOP) === parentId)
      .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, "de"));
  const siblings = ordered(parent).filter((p) => p.id !== page.id);
  // Bisheriger Platz: dieselbe Seite darüber und derselbe Nachfolger
  const current = ordered(page.parent_id ?? TOP);
  const next = current[current.findIndex((p) => p.id === page.id) + 1]?.id ?? END;
  const unchanged = parent === (page.parent_id ?? TOP) && before === next;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (unchanged) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    movePage(page.id, { parent_id: parent || null, before_id: before || null }).then(
      (data) => {
        onMoved(data);
        onClose();
      },
      (problem: unknown) => {
        setBusy(false);
        setError(errorText(problem, "Die Seite konnte nicht verschoben werden."));
      },
    );
  };

  return createPortal(
    <div className="confirm-backdrop" onClick={onClose}>
      <form
        ref={box}
        className="confirm-dialog doku-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id={titleId}>„{page.title}“ verschieben</h2>
        <p className="small">
          Unterseiten wandern mit. Eigene Rechte der Seite bleiben; sonst gelten die Rechte am neuen
          Platz.
        </p>
        {!space && !error && <p role="status">Wird geladen …</p>}
        {space && (
          <>
            <label className="doku-field">
              <span>Neuer Platz in „{space.name}“</span>
              <select
                value={parent}
                onChange={(event) => {
                  setParent(event.target.value);
                  setBefore(END);
                }}
              >
                {(canTop || parent === TOP) && (
                  <option value={TOP} disabled={!canTop}>
                    Oben im Arbeitsbereich
                  </option>
                )}
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    Unter: {target.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="doku-field">
              <span>Reihenfolge</span>
              <select value={before} onChange={(event) => setBefore(event.target.value)}>
                <option value={END}>Am Ende</option>
                {siblings.map((sibling) => (
                  <option key={sibling.id} value={sibling.id}>
                    Vor „{sibling.title}“
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {error && (
          <p className="hint-box hint-bad" role="alert">
            {error}
          </p>
        )}
        <div className="confirm-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="button button-primary" disabled={busy || !space}>
            Verschieben
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
