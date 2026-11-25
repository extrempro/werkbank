import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { EditorContent, mergeAttributes, Node, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { CARET_COLORS, type LiveDoc } from "./useLiveDoc";
import { Icon } from "../../components/Icon";
import type { DocJson, LiveAttrs } from "./api";
import { CommentMarks, type CommentMarksOptions } from "./commentMarks";
import { LiveBlock, LiveBlockForm, RefPicker, WerkbankRef } from "./DokuNodes";
import { ActiveCell, TableEdges, TablePicker, TableTools, useTableSpot } from "./DokuTable";

/** Hinweis-Kasten („Hinweis“, „Warnung“, „Erledigt“) mit Absätzen darin. */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "paragraph+",
  defining: true,
  addAttributes() {
    return {
      kind: {
        default: "info",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-callout") ?? "info",
        renderHTML: (attributes: { kind?: string }) => ({ "data-callout": attributes.kind }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    const kind = String(HTMLAttributes["data-callout"] ?? "info");
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: `doku-callout doku-callout-${kind}`, role: "note" }),
      0,
    ];
  },
});

/** Links nur mit https, mailto oder innerhalb der Werkbank (wie der Server prüft). */
export function allowedLink(href: string): boolean {
  const value = href.trim();
  if (!value || value.length > 2000 || [...value].some((ch) => ch.charCodeAt(0) < 32)) {
    return false;
  }
  const lower = value.toLowerCase();
  return (
    lower.startsWith("https://") ||
    lower.startsWith("mailto:") ||
    // Kein Backslash: Browser lesen „/\host“ wie „//host“ (fremde Seite)
    (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"))
  );
}

/** Cursor einer anderen Person: Farbe über CSSOM (die CSP erlaubt keine style-Attribute). */
function renderCaret(user: Record<string, unknown>): HTMLElement {
  const color = typeof user.color === "string" ? user.color : "";
  const caret = document.createElement("span");
  caret.classList.add("collaboration-carets__caret");
  // Nur sichtbar: Screenreader lesen den Namen nicht mitten im Text vor
  caret.setAttribute("aria-hidden", "true");
  caret.style.borderColor = color;
  const label = document.createElement("span");
  label.classList.add("collaboration-carets__label");
  label.style.backgroundColor = color;
  label.textContent = typeof user.name === "string" ? user.name : "";
  caret.append(label);
  return caret;
}

/** Markierung einer anderen Person: feste Klassen je Farbe statt style-Attribut. */
function caretSelection(user: Record<string, unknown>): { class: string } {
  const index = CARET_COLORS.findIndex((color) => color === user.color);
  return { class: `doku-selection doku-selection-${index < 0 ? 0 : index}` };
}

export function extensions(placeholder: string, live?: LiveDoc, comments?: CommentMarksOptions) {
  return [
    StarterKit.configure({
      // Mit Live-Bearbeitung kommt „Rückgängig“ aus dem gemeinsamen Dokument (nur eigene Änderungen)
      ...(live ? { undoRedo: false as const } : {}),
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        protocols: ["https", "mailto"],
        isAllowedUri: (url: string) => allowedLink(url),
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
    }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    ActiveCell,
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: {
        checkboxLabel: (node: { textContent: string }, checked: boolean) =>
          `${checked ? "Erledigt" : "Offen"}: ${node.textContent || "leere Aufgabe"}`,
      },
    }),
    Callout,
    WerkbankRef,
    LiveBlock,
    ...(comments ? [CommentMarks.configure(comments)] : []),
    Placeholder.configure({ placeholder }),
    ...(live
      ? [
          Collaboration.configure({ document: live.doc, field: "default" }),
          CollaborationCaret.configure({
            provider: live.provider,
            user: { name: "", color: live.color },
            render: renderCaret,
            selectionRender: caretSelection,
          }),
        ]
      : []),
  ];
}

type Picker = "verweis" | "live" | "tabelle";

interface BlockChoice {
  id: string;
  label: string;
  hint: string;
  run: (editor: Editor) => void;
  /** Öffnet stattdessen eine Auswahl (Verweis, Live-Baustein, Größe der Tabelle) */
  open?: Picker;
}

const BLOCKS: readonly BlockChoice[] = [
  { id: "text", label: "Text", hint: "Absatz", run: (e) => e.chain().focus().setParagraph().run() },
  {
    id: "h1",
    label: "Überschrift 1",
    hint: "große Überschrift",
    run: (e) => e.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    id: "h2",
    label: "Überschrift 2",
    hint: "mittlere Überschrift",
    run: (e) => e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    id: "h3",
    label: "Überschrift 3",
    hint: "kleine Überschrift",
    run: (e) => e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    id: "liste",
    label: "Liste",
    hint: "Aufzählung mit Punkten",
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: "nummern",
    label: "Nummerierte Liste",
    hint: "1., 2., 3.",
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "aufgaben",
    label: "Aufgaben",
    hint: "Liste zum Abhaken",
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    id: "hinweis",
    label: "Hinweis",
    hint: "Kasten, der auffällt",
    run: (e) => e.chain().focus().wrapIn("callout", { kind: "info" }).run(),
  },
  {
    id: "warnung",
    label: "Warnung",
    hint: "Kasten für Vorsicht",
    run: (e) => e.chain().focus().wrapIn("callout", { kind: "warnung" }).run(),
  },
  {
    id: "tabelle",
    label: "Tabelle",
    hint: "Größe wählen, mit oder ohne Kopfzeile",
    run: () => undefined,
    open: "tabelle",
  },
  {
    id: "code",
    label: "Code",
    hint: "Befehle, Konfiguration",
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "zitat",
    label: "Zitat",
    hint: "eingerückter Text",
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "linie",
    label: "Trennlinie",
    hint: "waagerechte Linie",
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    id: "verweis",
    label: "Verweis",
    hint: "Ticket, Gerät, Stelle, Projekt, Vertrag",
    run: () => undefined,
    open: "verweis",
  },
  {
    id: "live",
    label: "Live-Baustein",
    hint: "Ticketliste, Geräte, Projektstand, Vertragsfristen",
    run: () => undefined,
    open: "live",
  },
];

/** Abstand zwischen Schreibmarke und Menü sowie zum Rand in Pixeln */
const POPOVER_GAP = 6;

/** Höhe, unter der das Menü lieber nach oben klappt bzw. innen scrollt */
const POPOVER_MIN_HEIGHT = 200;

/** Das Baustein-Menü bleibt kompakt und scrollt innen, statt über die halbe Seite zu reichen */
const POPOVER_MAX_HEIGHT = 360;

/** Unterkante des freien Bereichs: über der Leiste unten am Handy, sonst der Bildschirm. */
function viewportBottom(): number {
  const bar = document.querySelector<HTMLElement>('nav[aria-label="Schnellzugriff"]');
  // „fixed“: offsetParent ist immer null, sichtbar heißt hier „hat Fläche“
  const top = bar && bar.getClientRects().length > 0 ? bar.getBoundingClientRect().top : null;
  return top !== null && top > 0 ? Math.min(top, window.innerHeight) : window.innerHeight;
}

/**
 * Schwebt an der Schreibmarke statt über dem Text, und die Seite bleibt dabei stehen: Unter
 * der Zeile, wenn dort Platz ist, sonst darüber (nie unter die feste Kopfzeile). Reicht der
 * Platz nirgends, steht das Menü auf der größeren Seite und scrollt innen.
 */
export function CaretPopover({
  editor,
  wide = false,
  children,
}: {
  editor: Editor;
  /** Breiter für Formulare (Verweis, Live-Baustein) */
  wide?: boolean;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Bis die Lage berechnet ist unsichtbar, aber nicht „hidden“: Das Suchfeld darin muss
  // sofort den Fokus bekommen können
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0 });
  useLayoutEffect(() => {
    const element = box.current;
    // Gerechnet wird vom nächsten positionierten Vorfahren aus (dort hängt „absolute“),
    // begrenzt auf die Breite des Editors
    const host = element?.offsetParent;
    const area = element?.parentElement;
    if (!element || !area || !(host instanceof HTMLElement)) {
      return;
    }
    const place = () => {
      const hostRect = host.getBoundingClientRect();
      const areaRect = area.getBoundingClientRect();
      let caret = { top: areaRect.top, bottom: areaRect.top, left: areaRect.left };
      try {
        caret = editor.view.coordsAtPos(editor.state.selection.from);
      } catch {
        // Ohne Position (z. B. Editor gerade nicht sichtbar): oben links im Editor
      }
      // Die feste Kopfzeile verdeckt den oberen Rand; darunter darf das Menü nicht rutschen
      const header = document.querySelector(".app-header")?.getBoundingClientRect().bottom ?? 0;
      const spaceBelow = viewportBottom() - caret.bottom - 2 * POPOVER_GAP;
      const spaceAbove = caret.top - Math.max(header, 0) - 2 * POPOVER_GAP;
      // Natürliche Höhe (auch wenn schon eine Höchsthöhe gesetzt ist), beim Menü begrenzt
      const height = wide
        ? element.scrollHeight
        : Math.min(element.scrollHeight, POPOVER_MAX_HEIGHT);
      // Lieber unter der Zeile; nach oben nur, wenn unten wirklich kein Platz ist
      const below =
        height <= spaceBelow || spaceBelow >= POPOVER_MIN_HEIGHT || spaceBelow >= spaceAbove;
      const room = Math.max(below ? spaceBelow : spaceAbove, POPOVER_MIN_HEIGHT);
      const shown = Math.min(height, room);
      const minLeft = areaRect.left + POPOVER_GAP;
      const maxLeft = Math.max(minLeft, areaRect.right - element.offsetWidth - POPOVER_GAP);
      setStyle({
        top: below
          ? caret.bottom - hostRect.top + POPOVER_GAP
          : caret.top - hostRect.top - POPOVER_GAP - shown,
        left: Math.min(Math.max(caret.left, minLeft), maxLeft) - hostRect.left,
        maxHeight: height > room ? room : wide ? undefined : POPOVER_MAX_HEIGHT,
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [editor, wide]);
  return (
    <div
      ref={box}
      className={wide ? "doku-popover doku-popover-wide" : "doku-popover"}
      style={style}
    >
      {children}
    </div>
  );
}

/** Auswahl der Bausteine: mit „+ Baustein“ oder „/“ in einer leeren Zeile. */
function BlockMenu({
  editor,
  onClose,
  onOpen,
}: {
  editor: Editor;
  onClose: () => void;
  onOpen: (what: Picker) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const choices = BLOCKS.filter((block) =>
    `${block.label} ${block.hint}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  useEffect(() => {
    // Ohne Scrollen: Das Menü steht schon an der Schreibmarke
    input.current?.focus({ preventScroll: true });
  }, []);
  const pick = (choice: BlockChoice | undefined) => {
    onClose();
    if (choice?.open) {
      onOpen(choice.open);
    } else if (choice) {
      choice.run(editor);
    }
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((active + 1) % Math.max(choices.length, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((active - 1 + choices.length) % Math.max(choices.length, 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(choices[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      editor.commands.focus();
    }
  };
  return (
    <div className="doku-blockmenu">
      <label className="visually-hidden" htmlFor={`${listId}-suche`}>
        Baustein suchen
      </label>
      <input
        ref={input}
        id={`${listId}-suche`}
        type="search"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={choices[active] ? `${listId}-${choices[active].id}` : undefined}
        placeholder="Baustein suchen"
        value={query}
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKey}
        onBlur={(event) => {
          const menu = event.currentTarget.parentElement;
          // Erst nachsehen, wo der Fokus gelandet ist: Wechselt man nur das Fenster oder die
          // App, bleibt das Menü offen; ein Klick daneben oder Tab aus dem Menü schließt es.
          window.setTimeout(() => {
            if (document.hasFocus() && !menu?.contains(document.activeElement)) {
              onClose();
            }
          }, 0);
        }}
      />
      <ul id={listId} role="listbox" aria-label="Bausteine">
        {choices.length === 0 && <li className="small">Kein Baustein gefunden.</li>}
        {choices.map((choice, index) => (
          <li
            key={choice.id}
            id={`${listId}-${choice.id}`}
            role="option"
            aria-selected={index === active}
            className={index === active ? "doku-blockmenu-active" : undefined}
            onMouseDown={(event) => {
              event.preventDefault();
              pick(choice);
            }}
          >
            <strong>{choice.label}</strong>
            <span className="small">{choice.hint}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LinkForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const current = String(editor.getAttributes("link").href ?? "");
  const [href, setHref] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = href.trim();
    if (!value) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      onClose();
      return;
    }
    if (!allowedLink(value)) {
      setError("Erlaubt sind Adressen mit https://, mailto: oder Seiten der Werkbank (/…).");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: value }).run();
    onClose();
  };
  return (
    <form className="doku-linkform" onSubmit={submit}>
      <label htmlFor={id}>Link-Adresse</label>
      <input
        id={id}
        type="url"
        value={href}
        placeholder="https://"
        autoFocus
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-fehler` : undefined}
        onChange={(event) => setHref(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            editor.commands.focus();
          }
        }}
      />
      <button type="submit" className="button button-primary">
        {href.trim() ? "Übernehmen" : "Link entfernen"}
      </button>
      <button type="button" className="button button-secondary" onClick={onClose}>
        Abbrechen
      </button>
      {error && (
        <p id={`${id}-fehler`} className="hint-box hint-bad" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function ToolButton({
  label,
  icon,
  text,
  active,
  disabled,
  onClick,
}: {
  label: string;
  icon?: Parameters<typeof Icon>[0]["name"];
  text?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="doku-tool"
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} /> : <span aria-hidden="true">{text}</span>}
    </button>
  );
}

function Toolbar({
  editor,
  onBlocks,
  onRef,
}: {
  editor: Editor;
  onBlocks: () => void;
  onRef: () => void;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  // Neu zeichnen, wenn sich Auswahl oder Inhalt ändern (für „gedrückt“)
  const [, setTick] = useState(0);
  useEffect(() => {
    const update = () => setTick((tick) => tick + 1);
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);
  const spot = useTableSpot(editor);
  return (
    <div className="doku-toolbar-wrap">
      <div className="doku-toolbar" role="toolbar" aria-label="Formatieren">
        <button
          type="button"
          className="button button-secondary doku-add"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onBlocks}
        >
          <Icon name="plus" />
          Baustein
        </button>
        <span className="doku-tool-sep" aria-hidden="true" />
        <ToolButton
          label="Fett"
          text="F"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolButton
          label="Kursiv"
          text="K"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolButton
          label="Unterstrichen"
          text="U"
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <ToolButton
          label="Durchgestrichen"
          text="S"
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
        <ToolButton
          label="Code im Text"
          text="</>"
          active={editor.isActive("code")}
          onClick={() => editor.chain().focus().toggleCode().run()}
        />
        <ToolButton
          label="Link"
          icon="link"
          active={editor.isActive("link")}
          onClick={() => setLinkOpen(!linkOpen)}
        />
        <ToolButton label="Verweis auf Ticket, Gerät, Projekt …" text="#" onClick={onRef} />
        <span className="doku-tool-sep" aria-hidden="true" />
        <ToolButton
          label="Überschrift 2"
          text="Ü"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolButton
          label="Liste"
          text="•"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolButton
          label="Aufgaben"
          icon="haken"
          active={editor.isActive("taskList")}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        />
        <span className="doku-tool-sep" aria-hidden="true" />
        <ToolButton
          label="Rückgängig"
          icon="rueckgaengig"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        />
        <ToolButton
          label="Wiederholen"
          icon="wiederholen"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        />
      </div>
      {spot && <TableTools editor={editor} spot={spot} />}
      {linkOpen && <LinkForm editor={editor} onClose={() => setLinkOpen(false)} />}
    </div>
  );
}

/**
 * Editor einer Seite (Tiptap). Bausteine über „+ Baustein“ oder „/“ in einer leeren Zeile;
 * Löschen lässt sich mit „Rückgängig“ (Strg+Z) zurücknehmen. Ohne Schreibrecht nur Anzeige.
 */
export function DokuEditor({
  content,
  live,
  editable,
  label,
  onChange,
  comments,
  onReady,
}: {
  /** Fester Inhalt (z. B. eine Version); mit `live` kommt der Inhalt aus dem gemeinsamen Dokument */
  content?: DocJson;
  live?: LiveDoc;
  editable: boolean;
  label: string;
  onChange?: (doc: DocJson) => void;
  /** Hervorhebung kommentierter Stellen (nur mit Live-Dokument) */
  comments?: CommentMarksOptions;
  /** Meldet den Editor, z. B. für Kommentare an der Auswahl */
  onReady?: (editor: Editor | null) => void;
}) {
  const [blocks, setBlocks] = useState(false);
  const [picker, setPicker] = useState<Picker | null>(null);
  const change = useRef(onChange);
  useEffect(() => {
    change.current = onChange;
  }, [onChange]);
  const editor = useEditor({
    extensions: extensions("Schreib los oder tippe „/“ für Bausteine", live, comments),
    ...(live ? {} : { content }),
    editable,
    immediatelyRender: true,
    // Kein <style> zur Laufzeit (CSP ohne 'unsafe-inline'); die Grundregeln stehen in styles.css
    injectCSS: false,
    editorProps: {
      attributes: {
        class: "doku-content",
        "aria-label": label,
        // Ohne Schreibrecht kein Eingabefeld für Screenreader (Tiptap setzt sonst „textbox“)
        ...(editable ? { "aria-multiline": "true" } : { role: "document" }),
      },
      handleKeyDown: (view, event) => {
        if (event.key !== "/" || !view.editable) {
          return false;
        }
        const { $from, empty } = view.state.selection;
        if (empty && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0) {
          setBlocks(true);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => change.current?.(current.getJSON() as DocJson),
  });
  const ready = useRef(onReady);
  useEffect(() => {
    ready.current = onReady;
  }, [onReady]);
  useEffect(() => {
    ready.current?.(editor);
    return () => ready.current?.(null);
  }, [editor]);
  const insertLive = (attrs: LiveAttrs) => {
    editor.chain().focus().insertContent({ type: "liveBlock", attrs }).run();
    setPicker(null);
  };
  return (
    <div className={editable ? "doku-editor doku-editing" : "doku-editor"}>
      {editable && (
        <Toolbar
          editor={editor}
          onBlocks={() => setBlocks(true)}
          onRef={() => setPicker("verweis")}
        />
      )}
      {editable && blocks && (
        <CaretPopover editor={editor}>
          <BlockMenu editor={editor} onClose={() => setBlocks(false)} onOpen={setPicker} />
        </CaretPopover>
      )}
      {editable && picker === "verweis" && (
        <CaretPopover editor={editor} wide>
          <RefPicker editor={editor} onClose={() => setPicker(null)} />
        </CaretPopover>
      )}
      {editable && picker === "tabelle" && (
        <CaretPopover editor={editor}>
          <TablePicker editor={editor} onClose={() => setPicker(null)} />
        </CaretPopover>
      )}
      {editable && <EdgesForTable editor={editor} />}
      {editable && picker === "live" && (
        <CaretPopover editor={editor} wide>
          <LiveBlockForm initial={null} onSubmit={insertLive} onCancel={() => setPicker(null)} />
        </CaretPopover>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

/** „+ Zeile“ und „+ Spalte“ an der Tabelle mit der Schreibmarke */
function EdgesForTable({ editor }: { editor: Editor }) {
  const spot = useTableSpot(editor);
  return spot ? <TableEdges editor={editor} spot={spot} /> : null;
}
