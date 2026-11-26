import { useId, useState, type KeyboardEvent } from "react";
import { Field } from "./Field";
import { Icon } from "./Icon";

export interface MailContact {
  name: string;
  mail: string;
}

// Wie die Prüfung im Server: etwas@etwas.tld, ohne Leerzeichen
const ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** Adressen aus getipptem oder eingefügtem Text, in Kleinschreibung; ungültige getrennt. */
export function parseAddresses(text: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    // „Name <a@b.de>“ aus dem Mailprogramm: nur die Adresse
    const part = raw.replace(/^<|>$/g, "").trim().toLowerCase();
    if (!part) {
      continue;
    }
    (ADDRESS.test(part) ? valid : invalid).push(part);
  }
  return { valid, invalid };
}

/**
 * Empfängerfeld wie im Mailprogramm (An, Cc): Adressen als Chips mit „entfernen“, darunter
 * Vorschläge aus den bekannten Kontakten. Neue Adressen tippen und mit Enter, Komma oder
 * Verlassen des Felds übernehmen; Rücktaste im leeren Feld entfernt die letzte Adresse.
 */
export function MailRecipients({
  label,
  value,
  onChange,
  contacts,
  required = false,
  error,
  placeholder = "Name oder Adresse",
}: {
  label: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** bekannte Personen (Name zur Anzeige, Vorschläge) */
  contacts: readonly MailContact[];
  required?: boolean;
  error?: string | null;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const nameOf = (mail: string) => contacts.find((c) => c.mail.toLowerCase() === mail)?.name ?? "";
  const query = text.trim().toLowerCase();
  const offers = contacts.filter(
    (c) =>
      !value.includes(c.mail.toLowerCase()) &&
      (!query || c.mail.toLowerCase().includes(query) || c.name.toLowerCase().includes(query)),
  );

  const pick = (contact: MailContact) => {
    add([contact.mail.toLowerCase()]);
    setText("");
    setWrong(null);
    setActive(-1);
  };
  const add = (mails: string[]) => {
    const next = [...value];
    for (const mail of mails) {
      if (!next.includes(mail)) {
        next.push(mail);
      }
    }
    onChange(next);
  };
  const commit = () => {
    if (!text.trim()) {
      setWrong(null);
      return;
    }
    const { valid, invalid } = parseAddresses(text);
    add(valid);
    setText(invalid.join(" "));
    setWrong(invalid.length ? `${invalid.join(", ")} ist keine gültige Mailadresse.` : null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const shown = open && offers.length > 0;
    if (shown && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + offers.length) % offers.length);
      return;
    }
    const chosen = shown && active >= 0 ? offers[active] : undefined;
    if (event.key === "Enter" && chosen) {
      event.preventDefault();
      pick(chosen);
      return;
    }
    if ((event.key === "Enter" || event.key === "," || event.key === ";") && text.trim()) {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && !text && value.length > 0) {
      onChange(value.slice(0, -1));
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <Field label={label} required={required} error={wrong ?? error ?? null}>
      {(control) => (
        <div className="mail-recipients">
          {value.length > 0 && (
            <ul className="mail-recipients-chips" aria-label={`${label}: gewählte Empfänger`}>
              {value.map((mail) => {
                const name = nameOf(mail);
                return (
                  <li key={mail} className="mail-chip">
                    {name && <span className="mail-chip-name">{name}</span>}
                    <span className="mail-chip-mail">{name ? `<${mail}>` : mail}</span>
                    <button
                      type="button"
                      className="mail-chip-remove"
                      aria-label={`${name || mail} aus „${label}“ entfernen`}
                      onClick={() => onChange(value.filter((m) => m !== mail))}
                    >
                      <Icon name="schliessen" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <input
            {...control}
            type="text"
            inputMode="email"
            autoComplete="off"
            placeholder={placeholder}
            value={text}
            role="combobox"
            aria-expanded={open && offers.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              open && active >= 0 && offers[active] ? `${listId}-${active}` : undefined
            }
            onChange={(event) => {
              setText(event.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            onBlur={() => {
              setOpen(false);
              setActive(-1);
              commit();
            }}
          />
          {open && offers.length > 0 && (
            <ul id={listId} role="listbox" aria-label="Vorschläge" className="mail-recipients-list">
              {offers.map((c, index) => (
                <li
                  key={c.mail}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => {
                    // vor dem Verlassen des Felds übernehmen
                    event.preventDefault();
                    pick(c);
                  }}
                >
                  <span>{c.name || c.mail}</span>
                  {c.name && <span className="small">{c.mail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}
