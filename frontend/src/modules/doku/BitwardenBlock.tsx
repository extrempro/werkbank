import { useEffect, useId, useState, type FormEvent } from "react";
import { mergeAttributes, Node } from "@tiptap/react";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { useConfirm } from "../../components/ConfirmDialog";
import { Field } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { fetchDokuMe } from "./api";
import { BlockDialog } from "./BlockDialog";

/* Baustein „Bitwarden-Einträge“: Verweise auf Einträge oder Sammlungen im Passwort-Tresor.
   Im Dokument stehen nur Link, Name und ein kurzer Hinweis, nie Passwörter. Die Werkbank fragt
   den Tresor nicht ab: Namen und Inhalte sind dort verschlüsselt. */

export interface VaultItem {
  url: string;
  name: string;
  hint: string;
}

export const VAULT_ITEMS_MAX = 20;
export const VAULT_NAME_MAX = 120;
export const VAULT_HINT_MAX = 160;

// --- Adresse des Tresors (Einstellung der Doku-Verwaltung) ---------------------------------

let vaultPromise: Promise<string> | null = null;

/** Adresse des Tresors; leer, wenn keine eingestellt ist. Einmal je Seitenaufruf geladen. */
export function loadVaultUrl(): Promise<string> {
  vaultPromise ??= fetchDokuMe().then(
    (me) => me.vault_url ?? "",
    () => {
      vaultPromise = null;
      return "";
    },
  );
  return vaultPromise;
}

/** Nur für Tests: Adresse neu laden. */
export function resetVaultUrl(): void {
  vaultPromise = null;
}

export function useVaultUrl(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadVaultUrl().then((value) => active && setUrl(value));
    return () => {
      active = false;
    };
  }, []);
  return url;
}

/** Führt der Link zum eingestellten Tresor? Nur dann wird er als Link gezeigt. */
export function inVault(url: string, vault: string): boolean {
  if (!vault || !url.toLowerCase().startsWith("https://") || url.includes("\\")) {
    return false;
  }
  return url === vault || ["/", "#", "?"].some((next) => url.startsWith(vault + next));
}

/** Sieht ein Text wie ein Passwort aus? Lange Zeichenfolge ohne Leerzeichen mit Ziffern und
    mindestens drei Zeichenarten, oder „Passwort:“ mit etwas dahinter. */
export function looksLikeSecret(text: string): boolean {
  if (/\b(passwort|password|kennwort|pw|pin)\s*[:=]\s*\S/i.test(text)) {
    return true;
  }
  return text.split(/\s+/).some((word) => {
    // Wörter mit Bindestrich („Firewall-Weboberfläche“) sind keine Passwörter: Ziffer nötig
    if (word.length < 12 || !/\d/.test(word)) {
      return false;
    }
    const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((kind) => kind.test(word)).length;
    return kinds >= 3;
  });
}

export function parseItems(raw: unknown): VaultItem[] {
  if (typeof raw !== "string") {
    return [];
  }
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) {
      return [];
    }
    return list
      .filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as Record<string, unknown>).url === "string" &&
          typeof (entry as Record<string, unknown>).name === "string",
      )
      .map((entry) => ({
        url: String(entry.url),
        name: String(entry.name),
        hint: typeof entry.hint === "string" ? entry.hint : "",
      }));
  } catch {
    return [];
  }
}

export function serializeItems(items: VaultItem[]): string {
  return JSON.stringify(
    items.map((item) => (item.hint ? item : { url: item.url, name: item.name })),
  );
}

// --- Formular für einen Eintrag ------------------------------------------------------------

interface Problems {
  url?: string;
  name?: string;
}

export function VaultItemForm({
  initial,
  vault,
  onSubmit,
  onCancel,
}: {
  initial: VaultItem | null;
  vault: string;
  onSubmit: (item: VaultItem) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState(initial?.url ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [hint, setHint] = useState(initial?.hint ?? "");
  const [problems, setProblems] = useState<Problems>({});
  const [ask, confirmDialog] = useConfirm();
  const id = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const item = { url: url.trim(), name: name.trim(), hint: hint.trim() };
    const found: Problems = {};
    if (!item.url) {
      found.url = "Füg den Link aus Bitwarden ein.";
    } else if (!inVault(item.url, vault)) {
      found.url = `Der Link führt nicht zu eurem Tresor (${vault}). Nur dorthin sind Verweise erlaubt.`;
    }
    if (!item.name) {
      found.name = "Gib dem Eintrag einen Namen.";
    }
    setProblems(found);
    if (found.url || found.name) {
      return;
    }
    if (looksLikeSecret(item.hint) || looksLikeSecret(item.name)) {
      ask(
        {
          title: "Steht da ein Passwort?",
          text: "Name oder Hinweis sehen wie ein Passwort aus. Alle, die die Seite lesen, sehen diesen Text. Passwörter gehören nur in den Tresor.",
          action: "Trotzdem übernehmen",
        },
        () => onSubmit(item),
      );
      return;
    }
    onSubmit(item);
  };

  return (
    <form className="doku-picker" onSubmit={submit} noValidate aria-labelledby={`${id}-titel`}>
      <h2 id={`${id}-titel`} className="doku-picker-title">
        {initial ? "Bitwarden-Eintrag bearbeiten" : "Bitwarden-Eintrag hinzufügen"}
      </h2>
      <Field
        label="Link zum Eintrag"
        required
        hint="Öffne den Eintrag in Bitwarden im Web und kopier die Adresse aus dem Browser. Auch der Link auf eine Sammlung geht."
        error={problems.url}
      >
        {(control) => (
          <input
            {...control}
            type="url"
            inputMode="url"
            autoComplete="off"
            maxLength={2000}
            value={url}
            placeholder={`${vault}/#/vault?itemId=…`}
            onChange={(event) => setUrl(event.target.value)}
          />
        )}
      </Field>
      <Field label="Anzeigename" required error={problems.name}>
        {(control) => (
          <input
            {...control}
            type="text"
            autoComplete="off"
            maxLength={VAULT_NAME_MAX}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <Field label="Hinweis" hint="Wofür ist der Zugang? Kein Passwort, kein Benutzername.">
        {(control) => (
          <input
            {...control}
            type="text"
            autoComplete="off"
            maxLength={VAULT_HINT_MAX}
            value={hint}
            onChange={(event) => setHint(event.target.value)}
          />
        )}
      </Field>
      <div className="doku-picker-actions">
        <button type="submit" className="button button-primary">
          {initial ? "Übernehmen" : "Hinzufügen"}
        </button>
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
      {confirmDialog}
    </form>
  );
}

// --- Anzeige auf der Seite -----------------------------------------------------------------

export function VaultList({
  items,
  vault,
  tools,
}: {
  items: VaultItem[];
  vault: string | null;
  /** Knöpfe je Eintrag beim Bearbeiten */
  tools?: (item: VaultItem, index: number) => React.ReactNode;
}) {
  return (
    <section className="doku-vault" aria-label="Zugänge in Bitwarden">
      <div className="doku-vault-head">
        <Icon name="schluessel" />
        <strong>Zugänge in Bitwarden</strong>
        <span className="small doku-vault-count">
          {items.length === 1 ? "1 Eintrag" : `${items.length} Einträge`}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="small doku-vault-empty">Noch keine Einträge.</p>
      ) : (
        <ul className="doku-vault-list">
          {items.map((item, index) => {
            const ok = vault !== null && inVault(item.url, vault);
            return (
              <li key={`${index}-${item.url}`} className="doku-vault-item">
                <span className="doku-vault-text">
                  <span className="doku-vault-name">{item.name}</span>
                  {item.hint && <span className="small doku-vault-hint">{item.hint}</span>}
                  {vault !== null && !ok && (
                    <span className="small doku-vault-bad">
                      {vault
                        ? "Der Link führt nicht zum eingestellten Tresor und wird nicht geöffnet."
                        : "Es ist kein Tresor eingestellt; der Link wird nicht geöffnet."}
                    </span>
                  )}
                </span>
                {ok && (
                  <a
                    className="button button-secondary doku-vault-open"
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${item.name} in Bitwarden öffnen (neues Fenster)`}
                  >
                    Öffnen
                    <Icon name="extern" />
                  </a>
                )}
                {tools?.(item, index)}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function VaultView({ node, editor, updateAttributes, deleteNode }: ReactNodeViewProps) {
  const vault = useVaultUrl();
  const items = parseItems(node.attrs.items);
  const [editing, setEditing] = useState<number | "neu" | null>(null);
  const save = (next: VaultItem[]) => updateAttributes({ items: serializeItems(next) });
  const move = (index: number, by: number) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    if (item) {
      next.splice(index + by, 0, item);
      save(next);
    }
  };
  const editable = editor.isEditable;
  return (
    <NodeViewWrapper className="doku-vault-wrap" data-drag-handle="">
      <VaultList
        items={items}
        vault={vault}
        tools={
          editable
            ? (item, index) => (
                <span className="doku-vault-tools" contentEditable={false}>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setEditing(index)}
                    aria-label={`${item.name} bearbeiten`}
                  >
                    Bearbeiten
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={`${item.name} nach oben`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={index === items.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={`${item.name} nach unten`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => save(items.filter((_, at) => at !== index))}
                    aria-label={`${item.name} entfernen`}
                  >
                    Entfernen
                  </button>
                </span>
              )
            : undefined
        }
      />
      {editable && (
        <div className="doku-live-tools" contentEditable={false}>
          <button
            type="button"
            className="button button-secondary"
            disabled={!vault || items.length >= VAULT_ITEMS_MAX}
            onClick={() => setEditing("neu")}
          >
            Eintrag hinzufügen
          </button>
          <button type="button" className="button button-secondary" onClick={() => deleteNode()}>
            Baustein entfernen
          </button>
        </div>
      )}
      {editing !== null && vault && (
        <BlockDialog label="Bitwarden-Eintrag" onClose={() => setEditing(null)}>
          <VaultItemForm
            initial={editing === "neu" ? null : (items[editing] ?? null)}
            vault={vault}
            onSubmit={(item) => {
              save(
                editing === "neu"
                  ? [...items, item]
                  : items.map((entry, at) => (at === editing ? item : entry)),
              );
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        </BlockDialog>
      )}
    </NodeViewWrapper>
  );
}

export const BitwardenBlock = Node.create({
  name: "bitwarden",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { items: { default: "[]" } };
  },
  parseHTML() {
    return [{ tag: "div[data-bitwarden]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-bitwarden": "" })];
  },
  renderText({ node }) {
    return parseItems(node.attrs.items)
      .map((item) => `[Bitwarden: ${item.name}]`)
      .join("\n");
  },
  addNodeView() {
    return ReactNodeViewRenderer(VaultView);
  },
});
