import { useMemo, useRef, type ReactNode } from "react";
import { applyFormat, parseMarkdown, type Format, type Inline } from "./markdown";

function renderInline(parts: Inline[], prefix: string): ReactNode[] {
  return parts.map((part, index) => {
    const key = `${prefix}-${index}`;
    switch (part.kind) {
      case "text":
        return <span key={key}>{part.text}</span>;
      case "code":
        return <code key={key}>{part.text}</code>;
      case "strong":
        return <strong key={key}>{renderInline(part.children, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(part.children, key)}</em>;
      case "link":
        return (
          <a key={key} href={part.href} target="_blank" rel="noopener noreferrer">
            {renderInline(part.children, key)}
            <span className="visually-hidden"> (neues Fenster)</span>
          </a>
        );
    }
  });
}

function lines(rows: Inline[][], prefix: string): ReactNode[] {
  return rows.flatMap((row, index) => [
    ...(index > 0 ? [<br key={`${prefix}-br-${index}`} />] : []),
    ...renderInline(row, `${prefix}-${index}`),
  ]);
}

/**
 * Stellt ein Protokoll in Markdown dar. Alles wird als Text gesetzt, nie als HTML.
 * Überschriften beginnen eine Ebene unter `headingLevel`, damit die Gliederung der Seite stimmt.
 */
export function Markdown({ source, headingLevel = 3 }: { source: string; headingLevel?: 3 | 4 }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  if (blocks.length === 0) {
    return <p className="small">Kein Protokolltext.</p>;
  }
  return (
    <div className="markdown">
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.kind) {
          case "heading": {
            const level = Math.min(headingLevel + block.level - 1, 6);
            const Tag = `h${level}` as "h3" | "h4" | "h5" | "h6";
            return <Tag key={key}>{renderInline(block.content, key)}</Tag>;
          }
          case "paragraph":
            return <p key={key}>{lines(block.lines, key)}</p>;
          case "quote":
            return <blockquote key={key}>{lines(block.lines, key)}</blockquote>;
          case "rule":
            return <hr key={key} />;
          case "list": {
            const items = block.items.map((item, itemIndex) => (
              <li
                key={`${key}-${itemIndex}`}
                className={item.checked === null ? undefined : "markdown-check"}
              >
                {item.checked !== null && (
                  <span
                    className={item.checked ? "markdown-box markdown-box-on" : "markdown-box"}
                    aria-hidden="true"
                  />
                )}
                {item.checked !== null && (
                  <span className="visually-hidden">{item.checked ? "erledigt: " : "offen: "}</span>
                )}
                {renderInline(item.content, `${key}-${itemIndex}`)}
              </li>
            ));
            return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
          }
        }
      })}
    </div>
  );
}

const BUTTONS: { format: Format; label: string; text: ReactNode }[] = [
  { format: "bold", label: "Fett", text: <strong>F</strong> },
  { format: "italic", label: "Kursiv", text: <em>K</em> },
  { format: "heading", label: "Überschrift", text: "Ü" },
  { format: "bullet", label: "Liste", text: "•" },
  { format: "numbered", label: "Nummerierte Liste", text: "1." },
  { format: "check", label: "Checkliste", text: "☐" },
  { format: "link", label: "Link", text: "Link" },
];

interface EditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  /** Id eines Textes, der das Feld beschreibt. */
  describedBy?: string;
}

/** Textfeld für Markdown mit einer Leiste, die Zeichen um die Auswahl setzt. */
export function MarkdownEditor({ id, value, onChange, maxLength, describedBy }: EditorProps) {
  const area = useRef<HTMLTextAreaElement>(null);

  const onFormat = (format: Format) => {
    const element = area.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    const edit = applyFormat(value, start, end, format);
    if (edit.value.length > maxLength) {
      return;
    }
    onChange(edit.value);
    // Nach dem Neuzeichnen die Auswahl setzen, damit man direkt weiterschreiben kann.
    requestAnimationFrame(() => {
      const current = area.current;
      if (current) {
        current.focus();
        current.setSelectionRange(edit.start, edit.end);
      }
    });
  };

  return (
    <div className="markdown-editor">
      <div className="markdown-toolbar" role="toolbar" aria-label="Formatierung" aria-controls={id}>
        {BUTTONS.map((button) => (
          <button
            key={button.format}
            type="button"
            className="button button-secondary markdown-button"
            aria-label={button.label}
            title={button.label}
            onClick={() => onFormat(button.format)}
          >
            {button.text}
          </button>
        ))}
      </div>
      <textarea
        id={id}
        ref={area}
        value={value}
        rows={14}
        maxLength={maxLength}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
