import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { ComboField, type ComboItem } from "../../components/ComboField";
import { ChoiceCards } from "../../components/Field";
import { mergeAttributes, Node, type Editor } from "@tiptap/react";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { errorText, formatDateTime } from "../../api";
import { Link } from "../../components/Link";
import {
  fetchLiveData,
  fetchLiveOptions,
  LIVE_KIND_LABELS,
  REF_KIND_LABELS,
  resolveRefs,
  searchRefs,
  type LiveAttrs,
  type LiveData,
  type LiveKind,
  type LiveOptions,
  type RefData,
  type RefKind,
} from "./api";

/* Verweise auf Objekte der Werkbank und Live-Bausteine (D3). Im Dokument stehen nur Art und
   Kennung bzw. die Einstellungen; Titel und Stand holt die Seite mit den Rechten der Person,
   die gerade liest. */

// --- Stand der Verweise: gesammelt abfragen, kurz zwischenspeichern ------------------------

const refCache = new Map<string, RefData>();
const refListeners = new Set<() => void>();
let pending = new Map<string, { kind: RefKind; id: string }>();
let timer: number | null = null;

function refKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

function flushRefs(): void {
  timer = null;
  const batch = [...pending.values()];
  pending = new Map();
  for (let start = 0; start < batch.length; start += 200) {
    const part = batch.slice(start, start + 200);
    resolveRefs(part).then(
      (found) => {
        for (const item of found) {
          refCache.set(refKey(item.kind, item.id), item);
        }
        refListeners.forEach((listener) => listener());
      },
      () => {
        for (const item of part) {
          refCache.set(refKey(item.kind, item.id), {
            ...item,
            allowed: false,
            found: false,
            title: "",
            status: "",
            detail: "",
            href: "",
          });
        }
        refListeners.forEach((listener) => listener());
      },
    );
  }
}

/** Vergisst den Stand aller Verweise (z. B. beim Wechsel der Seite). */
export function clearRefCache(): void {
  refCache.clear();
}

function useRefData(kind: RefKind, id: string): RefData | null {
  const key = refKey(kind, id);
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((tick) => tick + 1);
    refListeners.add(listener);
    if (!refCache.has(key) && !pending.has(key)) {
      pending.set(key, { kind, id });
      timer ??= window.setTimeout(flushRefs, 20);
    }
    return () => {
      refListeners.delete(listener);
    };
  }, [key, kind, id]);
  return refCache.get(key) ?? null;
}

const KIND_SHORT: Record<RefKind, string> = {
  ticket: "T",
  hardware: "G",
  stelle: "S",
  arbeitsplatz: "A",
  raum: "R",
  projekt: "P",
  vertrag: "V",
};

/** Verweis als Chip: Art, Titel, Stand. Ohne Rechte nur „Kein Zugriff“. */
export function RefChip({ kind, id }: { kind: RefKind; id: string }) {
  const data = useRefData(kind, id);
  const label = REF_KIND_LABELS[kind] ?? "Verweis";
  if (!data) {
    return (
      <span className="doku-ref doku-ref-loading" aria-busy="true">
        <span className="doku-ref-kind" aria-hidden="true">
          {KIND_SHORT[kind]}
        </span>
        {label} wird geladen …
      </span>
    );
  }
  if (!data.found) {
    return (
      <span className="doku-ref doku-ref-none">
        <span className="doku-ref-kind" aria-hidden="true">
          {KIND_SHORT[kind]}
        </span>
        {data.allowed ? `${label} gibt es nicht mehr` : "Kein Zugriff"}
      </span>
    );
  }
  return (
    <Link to={data.href} className={`doku-ref doku-ref-${kind}`} title={data.detail}>
      <span className="doku-ref-kind" aria-hidden="true">
        {KIND_SHORT[kind]}
      </span>
      <span className="visually-hidden">{label}: </span>
      <span className="doku-ref-title">{data.title}</span>
      {data.status && <span className="doku-ref-status"> · {data.status}</span>}
    </Link>
  );
}

function RefView({ node }: ReactNodeViewProps) {
  const kind = String(node.attrs.kind ?? "") as RefKind;
  const id = String(node.attrs.id ?? "");
  return (
    <NodeViewWrapper as="span" className="doku-ref-wrap">
      <RefChip kind={kind} id={id} />
    </NodeViewWrapper>
  );
}

export const WerkbankRef = Node.create({
  name: "werkbankRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      kind: { default: null },
      id: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-ref-kind]",
        getAttrs: (element: HTMLElement) => ({
          kind: element.getAttribute("data-ref-kind"),
          id: element.getAttribute("data-ref-id"),
        }),
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-ref-kind": node.attrs.kind,
        "data-ref-id": node.attrs.id,
      }),
    ];
  },
  renderText({ node }) {
    return `[${REF_KIND_LABELS[node.attrs.kind as RefKind] ?? "Verweis"} ${node.attrs.id}]`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(RefView);
  },
});

// --- Verweis einfügen ----------------------------------------------------------------------

const REF_ORDER: readonly RefKind[] = [
  "ticket",
  "hardware",
  "stelle",
  "arbeitsplatz",
  "raum",
  "projekt",
  "vertrag",
];

/** Suche nach einem Objekt und Einfügen als Verweis (nur Bereiche mit Rechten liefern etwas). */
export function RefPicker({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [kind, setKind] = useState<RefKind>("ticket");
  const id = useId();
  const search = useCallback(
    (query: string) =>
      searchRefs(kind, query.trim()).then((found) => ({
        items: found.map((hit) => ({
          id: hit.id,
          label: hit.title,
          detail: [hit.status, hit.detail].filter(Boolean).join(" · "),
          hit,
        })),
        total: found.length,
      })),
    [kind],
  );

  const insert = (hit: RefData) => {
    refCache.set(refKey(hit.kind, hit.id), hit);
    editor
      .chain()
      .focus()
      .insertContent([
        { type: "werkbankRef", attrs: { kind: hit.kind, id: hit.id } },
        { type: "text", text: " " },
      ])
      .run();
    onClose();
  };
  const close = () => {
    onClose();
    editor.commands.focus();
  };

  return (
    <div className="doku-picker" role="dialog" aria-labelledby={`${id}-titel`}>
      <h2 id={`${id}-titel`} className="doku-picker-title">
        Verweis einfügen
      </h2>
      <ChoiceCards
        legend="Art"
        value={kind}
        options={REF_ORDER.map((entry) => ({ value: entry, label: REF_KIND_LABELS[entry] }))}
        onChange={setKind}
      />
      <ComboField<ComboItem & { hit: RefData }>
        key={kind}
        label="Suchen"
        minLength={1}
        autoFocus
        placeholder="Nummer, Name oder Titel"
        search={search}
        nothingFound={() =>
          "Nichts gefunden. Du findest nur, was du in dem Bereich auch sehen darfst."
        }
        onEscape={close}
        value={null}
        onChange={(item) => item && insert(item.hit)}
      />
      <div className="doku-picker-actions">
        <button type="button" className="button button-secondary" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}

// --- Live-Bausteine ------------------------------------------------------------------------

const LIVE_REFRESH_MS = 60_000;
const LIVE_ORDER: readonly LiveKind[] = ["tickets", "geraete", "projekt", "vertraege"];

function cleanAttrs(attrs: LiveAttrs): LiveAttrs {
  const result: LiveAttrs = { kind: attrs.kind };
  for (const key of [
    "area",
    "status",
    "q",
    "floor",
    "room",
    "hwkind",
    "project",
    "months",
  ] as const) {
    const value = attrs[key];
    if (value !== null && value !== undefined && value !== "") {
      (result as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

/** Einstellungen eines Live-Bausteins (neu oder ändern). */
export function LiveBlockForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: LiveAttrs | null;
  onSubmit: (attrs: LiveAttrs) => void;
  onCancel: () => void;
}) {
  const [attrs, setAttrs] = useState<LiveAttrs>(initial ?? { kind: "tickets", status: "offen" });
  const [options, setOptions] = useState<LiveOptions | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  useEffect(() => {
    fetchLiveOptions().then(setOptions, (failure: unknown) =>
      setProblem(errorText(failure, "Die Auswahl konnte nicht geladen werden.")),
    );
  }, []);
  const set = (patch: Partial<LiveAttrs>) => setAttrs({ ...attrs, ...patch });
  const number = (value: string) => (value ? Number(value) : null);
  const floor = options?.floors.find((entry) => entry.id === attrs.floor);
  // Vorschau in Echtzeit: kurz nach der letzten Änderung neu laden (nicht bei jedem Tastendruck)
  const [preview, setPreview] = useState<LiveAttrs | null>(null);
  useEffect(() => {
    const ready = attrs.kind !== "projekt" || Boolean(attrs.project);
    const timer = window.setTimeout(() => setPreview(ready ? cleanAttrs(attrs) : null), 300);
    return () => window.clearTimeout(timer);
  }, [attrs]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (attrs.kind === "projekt" && !attrs.project) {
      setProblem("Wähle ein Projekt.");
      return;
    }
    onSubmit(cleanAttrs(attrs));
  };
  return (
    <form className="doku-picker" onSubmit={submit} aria-labelledby={`${id}-titel`}>
      <h2 id={`${id}-titel`} className="doku-picker-title">
        {initial ? "Live-Baustein einstellen" : "Live-Baustein einfügen"}
      </h2>
      {!initial && (
        <fieldset className="doku-picker-kinds">
          <legend>Art</legend>
          {LIVE_ORDER.map((kind) => (
            <label key={kind} className="segmented-radio">
              <input
                type="radio"
                name={`${id}-art`}
                checked={attrs.kind === kind}
                onChange={() =>
                  setAttrs({
                    kind,
                    ...(kind === "tickets" ? { status: "offen" } : {}),
                    ...(kind === "vertraege" ? { months: 6 } : {}),
                  })
                }
              />
              <span>{LIVE_KIND_LABELS[kind].label}</span>
            </label>
          ))}
        </fieldset>
      )}
      {attrs.kind === "tickets" && (
        <div className="doku-picker-row">
          <label>
            Bereich
            <select
              value={attrs.area ?? ""}
              onChange={(e) => set({ area: number(e.target.value) })}
            >
              <option value="">alle deine Bereiche</option>
              {options?.areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={attrs.status ?? "offen"}
              onChange={(e) => set({ status: e.target.value as "offen" | "alle" })}
            >
              <option value="offen">offen</option>
              <option value="alle">alle</option>
            </select>
          </label>
          <label className="doku-picker-grow">
            Stichwort im Betreff
            <input
              type="text"
              maxLength={60}
              value={attrs.q ?? ""}
              onChange={(e) => set({ q: e.target.value })}
            />
          </label>
        </div>
      )}
      {attrs.kind === "geraete" && (
        <div className="doku-picker-row">
          <label className="doku-picker-grow">
            Etage
            <select
              value={attrs.floor ?? ""}
              onChange={(e) => set({ floor: number(e.target.value), room: null })}
            >
              <option value="">alle Standorte</option>
              {options?.floors.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Raum
            <select
              value={attrs.room ?? ""}
              disabled={!floor}
              onChange={(e) => set({ room: number(e.target.value) })}
            >
              <option value="">alle Räume</option>
              {floor?.rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Art
            <select
              value={attrs.hwkind ?? ""}
              onChange={(e) => set({ hwkind: number(e.target.value) })}
            >
              <option value="">alle Arten</option>
              {options?.kinds.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {attrs.kind === "projekt" && (
        <label>
          Projekt
          <select
            value={attrs.project ?? ""}
            onChange={(e) => set({ project: number(e.target.value) })}
          >
            <option value="">bitte wählen</option>
            {options?.projects.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {attrs.kind === "vertraege" && (
        <label>
          Zeitraum
          <select
            value={attrs.months ?? 6}
            onChange={(e) => set({ months: Number(e.target.value) as 3 | 6 | 12 })}
          >
            <option value={3}>nächste 3 Monate</option>
            <option value={6}>nächste 6 Monate</option>
            <option value={12}>nächste 12 Monate</option>
          </select>
        </label>
      )}
      <p className="small">
        Jede Person sieht im Baustein nur, was sie im jeweiligen Bereich sehen darf.
      </p>
      <div className="doku-live-preview">
        <span className="small">Vorschau</span>
        {preview ? (
          <LiveBlockContent attrs={preview} />
        ) : (
          <p className="small doku-live-empty">Wähle ein Projekt, dann erscheint die Vorschau.</p>
        )}
      </div>
      {problem && (
        <p className="hint-box hint-bad" role="alert">
          {problem}
        </p>
      )}
      <div className="doku-picker-actions">
        <button type="submit" className="button button-primary">
          {initial ? "Übernehmen" : "Einfügen"}
        </button>
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function LiveTable({ data }: { data: LiveData }) {
  const rows = data.rows ?? [];
  if (rows.length === 0) {
    return <p className="small doku-live-empty">Gerade nichts dabei.</p>;
  }
  const heads: Record<LiveKind, [string, string, string, string]> = {
    tickets: ["Nr.", "Betreff", "Status", "Zuständig"],
    geraete: ["Inventar", "Gerät", "Art", "Raum"],
    projekt: ["", "", "", ""],
    vertraege: ["Kündigung bis", "Vertrag", "Frist", "Partner"],
  };
  const [a, b, c, d] = heads[data.kind];
  return (
    <div
      className="table-wrap"
      tabIndex={0}
      role="region"
      aria-label={LIVE_KIND_LABELS[data.kind].label}
    >
      <table>
        <thead>
          <tr>
            <th scope="col">{a}</th>
            <th scope="col">{b}</th>
            <th scope="col">{c}</th>
            <th scope="col">{d}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.href}-${row.number}`}>
              <td>
                <Link to={row.href}>{row.number}</Link>
              </td>
              <td>{row.title}</td>
              <td>{row.status}</td>
              <td>{row.who || "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LiveProject({ data }: { data: LiveData }) {
  const project = data.project;
  if (!project) {
    return <p className="small doku-live-empty">{data.note}</p>;
  }
  const share = project.total ? Math.round((project.done / project.total) * 100) : 0;
  return (
    <div className="doku-live-project">
      <p>
        <Link to={project.href}>{data.title}</Link> · {project.status}
      </p>
      <progress max={100} value={share} aria-label={`${share} Prozent der Aufgaben erledigt`} />
      <p className="small">
        {project.done} von {project.total} Aufgaben erledigt
        {project.meeting
          ? ` · nächster Jour Fixe ${formatDateTime(project.meeting).split(",")[0]}`
          : ""}
      </p>
      {project.tasks.length > 0 && (
        <ul>
          {project.tasks.map((task) => (
            <li key={task.text}>
              {task.text}
              {task.due ? ` (bis ${formatDateTime(task.due).split(",")[0]})` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Inhalt eines Live-Bausteins; lädt jede Minute neu. */
export function LiveBlockContent({ attrs }: { attrs: LiveAttrs }) {
  const [data, setData] = useState<LiveData | null>(null);
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify(cleanAttrs(attrs));
  useEffect(() => {
    let active = true;
    const load = () =>
      fetchLiveData(JSON.parse(key) as LiveAttrs).then(
        (result) => {
          if (active) {
            setData(result);
            setFailed(false);
          }
        },
        () => active && setFailed(true),
      );
    void load();
    const every = window.setInterval(() => void load(), LIVE_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(every);
    };
  }, [key]);
  const label = LIVE_KIND_LABELS[attrs.kind]?.label ?? "Live-Baustein";
  return (
    <section className="doku-live" aria-label={`Live-Baustein: ${label}`}>
      <div className="doku-live-head">
        <strong>{label}</strong>
        {data?.allowed && data.title && <span className="small">{data.title}</span>}
        <span className="doku-live-badge small">Live</span>
      </div>
      {!data && !failed && (
        <p className="small doku-live-empty" role="status">
          Wird geladen …
        </p>
      )}
      {failed && (
        <p className="small doku-live-empty">Der Baustein lässt sich gerade nicht laden.</p>
      )}
      {data && !data.allowed && (
        <p className="small doku-live-empty">
          Du hast keine Rechte für diesen Bereich. Andere sehen hier die Daten.
        </p>
      )}
      {data?.allowed &&
        (data.kind === "projekt" ? <LiveProject data={data} /> : <LiveTable data={data} />)}
    </section>
  );
}

function LiveView({ node, editor, updateAttributes, deleteNode }: ReactNodeViewProps) {
  const [editing, setEditing] = useState(false);
  const attrs = node.attrs as LiveAttrs;
  return (
    <NodeViewWrapper className="doku-live-wrap" data-drag-handle="">
      <LiveBlockContent attrs={attrs} />
      {editor.isEditable && !editing && (
        <div className="doku-live-tools" contentEditable={false}>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setEditing(true)}
          >
            Einstellungen
          </button>
          <button type="button" className="button button-secondary" onClick={() => deleteNode()}>
            Baustein entfernen
          </button>
        </div>
      )}
      {editing && (
        <div contentEditable={false}>
          <LiveBlockForm
            initial={attrs}
            onSubmit={(next) => {
              updateAttributes({
                area: null,
                status: null,
                q: null,
                floor: null,
                room: null,
                hwkind: null,
                project: null,
                months: null,
                ...next,
              });
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const LiveBlock = Node.create({
  name: "liveBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    const plain = { default: null };
    return {
      kind: plain,
      area: plain,
      status: plain,
      q: plain,
      floor: plain,
      room: plain,
      hwkind: plain,
      project: plain,
      months: plain,
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-live-kind]",
        getAttrs: (el: HTMLElement) => ({ kind: el.getAttribute("data-live-kind") }),
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-live-kind": node.attrs.kind })];
  },
  renderText({ node }) {
    return `[${LIVE_KIND_LABELS[node.attrs.kind as LiveKind]?.label ?? "Live-Baustein"}]`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(LiveView);
  },
});
