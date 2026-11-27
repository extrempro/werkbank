import { useId, useRef, useState, type FormEvent } from "react";
import { EmojiPicker } from "../../components/EmojiPicker";
import { Field } from "../../components/Field";
import { ListChoice } from "../../components/ListChoice";
import { createPortal } from "react-dom";
import { errorText } from "../../api";
import { useModal } from "../../components/nav/useModal";
import { navigate } from "../../router";
import { createPage, notifyTreeChanged, pagePath, type TreeSpace } from "./api";

/** Neue Seite: Titel, Arbeitsbereich und ob sie unter der geöffneten Seite steht. */
export function NewPageDialog({
  spaces,
  parentId,
  onClose,
}: {
  spaces: TreeSpace[];
  /** Geöffnete Seite: kann als Platz darüber gewählt werden */
  parentId: string | null;
  onClose: () => void;
}) {
  const box = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const parent = parentId
    ? spaces
        .flatMap((space) => space.pages.map((page) => ({ page, space })))
        .find((entry) => entry.page.id === parentId && entry.page.can_edit && !entry.space.archived)
    : undefined;
  const writable = spaces.filter(
    (space) => !space.archived && (space.role === "edit" || space.role === "manage"),
  );
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [below, setBelow] = useState(parent !== undefined);
  const [spaceId, setSpaceId] = useState<number>(parent?.space.id ?? writable[0]?.id ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useModal(box, true, onClose);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError("Gib der Seite einen Titel.");
      return;
    }
    setBusy(true);
    setError(null);
    createPage({
      space_id: below && parent ? parent.space.id : spaceId,
      parent_id: below && parent ? parent.page.id : null,
      title: title.trim(),
      icon,
    }).then(
      (page) => {
        notifyTreeChanged();
        onClose();
        navigate(pagePath(page.id));
      },
      (problem: unknown) => {
        setBusy(false);
        setError(errorText(problem, "Die Seite konnte nicht angelegt werden."));
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
        <h2 id={titleId}>Neue Seite</h2>
        <Field label="Titel" required>
          {(control) => (
            <div className="doku-tree-new-row">
              <EmojiPicker value={icon} onChange={setIcon} label="Emoji wählen" disabled={busy} />
              <input
                {...control}
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
          )}
        </Field>
        {parent && (
          <label className="doku-check">
            <input
              type="checkbox"
              className="check"
              checked={below}
              onChange={() => setBelow(!below)}
            />
            <span>Unter „{parent.page.title}“</span>
          </label>
        )}
        {!(below && parent) && (
          <ListChoice
            label="Arbeitsbereich"
            required
            unit="Arbeitsbereiche"
            placeholder="Name des Arbeitsbereichs …"
            options={writable.map((space) => ({ id: space.id, label: space.name }))}
            value={String(spaceId)}
            onChange={(value) => value && setSpaceId(Number(value))}
          />
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
          <button type="submit" className="button button-primary" disabled={busy}>
            Seite anlegen
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
