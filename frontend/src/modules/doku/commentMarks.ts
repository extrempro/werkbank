import { Extension, type Editor } from "@tiptap/react";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import * as Y from "yjs";

/* Kommentare an Textstellen (D3): Die Stelle steht als relative Position im gemeinsamen
   Dokument (Yjs). So wandert sie mit, wenn davor Text dazukommt oder wegfällt, und das
   Dokument selbst bleibt unverändert (auch Personen mit „Lesen“ dürfen kommentieren). */

export interface Anchor {
  from: string;
  to: string;
}

export interface MarkedThread {
  id: string;
  anchor: Anchor;
  active: boolean;
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  bytes.forEach((byte) => (text += String.fromCharCode(byte)));
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

/** Markierte Stelle im Editor als Anker und Zitat; null ohne Auswahl oder ohne Live-Dokument. */
export function anchorFromSelection(editor: Editor): { anchor: Anchor; quote: string } | null {
  const { from, to, empty } = editor.state.selection;
  const sync = ySyncPluginKey.getState(editor.state);
  if (empty || !sync) {
    return null;
  }
  const quote = editor.state.doc.textBetween(from, to, " ", " ").trim();
  if (!quote) {
    return null;
  }
  const mapping = sync.binding.mapping;
  return {
    anchor: {
      from: toBase64(
        Y.encodeRelativePosition(absolutePositionToRelativePosition(from, sync.type, mapping)),
      ),
      to: toBase64(
        Y.encodeRelativePosition(absolutePositionToRelativePosition(to, sync.type, mapping)),
      ),
    },
    quote,
  };
}

/** Aktuelle Position einer Stelle; null, wenn der Text dazu nicht mehr da ist. */
export function anchorRange(
  state: EditorState,
  anchor: Anchor,
): { from: number; to: number } | null {
  const sync = ySyncPluginKey.getState(state);
  if (!sync) {
    return null;
  }
  try {
    const mapping = sync.binding.mapping;
    const from = relativePositionToAbsolutePosition(
      sync.doc,
      sync.type,
      Y.decodeRelativePosition(fromBase64(anchor.from)),
      mapping,
    );
    const to = relativePositionToAbsolutePosition(
      sync.doc,
      sync.type,
      Y.decodeRelativePosition(fromBase64(anchor.to)),
      mapping,
    );
    if (from === null || to === null || to <= from || to > state.doc.content.size) {
      return null;
    }
    return { from, to };
  } catch {
    return null;
  }
}

export const commentMarksKey = new PluginKey<number>("dokuCommentMarks");

export interface CommentMarksOptions {
  /** Offene Kommentare mit Stelle; wird bei jeder Zeichnung gelesen */
  threads: () => MarkedThread[];
  onSelect: (id: string) => void;
}

/** Hebt kommentierte Stellen hervor; ein Klick darauf wählt den Kommentar. */
export const CommentMarks = Extension.create<CommentMarksOptions>({
  name: "dokuCommentMarks",
  addOptions() {
    return { threads: () => [], onSelect: () => undefined };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<number>({
        key: commentMarksKey,
        // Zähler: jede Änderung der Kommentare zeichnet neu (setMeta)
        state: {
          init: () => 0,
          apply: (tr, value) => (tr.getMeta(commentMarksKey) ? value + 1 : value),
        },
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            for (const thread of options.threads()) {
              const range = anchorRange(state, thread.anchor);
              if (range) {
                decorations.push(
                  Decoration.inline(range.from, range.to, {
                    class: thread.active
                      ? "doku-comment-mark doku-comment-mark-active"
                      : "doku-comment-mark",
                    "data-thread": thread.id,
                  }),
                );
              }
            }
            return DecorationSet.create(state.doc, decorations);
          },
          handleClick(_view, _pos, event) {
            const target = (event.target as HTMLElement | null)?.closest("[data-thread]");
            const id = target?.getAttribute("data-thread");
            if (id) {
              options.onSelect(id);
            }
            return false;
          },
        },
      }),
    ];
  },
});

/** Kommentare haben sich geändert: Hervorhebungen neu zeichnen. */
export function refreshCommentMarks(editor: Editor | null): void {
  if (editor && !editor.isDestroyed) {
    editor.view.dispatch(
      editor.state.tr.setMeta(commentMarksKey, true).setMeta("addToHistory", false),
    );
  }
}
