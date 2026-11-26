import { useEffect, useId, useState } from "react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react";
import { createLowlight } from "lowlight";
// Version von highlight.js (package.json): lowlight 3.3.0 lässt nur ~11.11.0 zu, deshalb 11.11.x
// statt der neueren 11.12. Anheben, sobald eine neue lowlight-Version höhere Versionen erlaubt.
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import nginx from "highlight.js/lib/languages/nginx";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/** Sprachen zur Auswahl am Codeblock; leer heißt „Text“ ohne Hervorhebung. */
export const CODE_LANGUAGES: readonly { id: string; label: string }[] = [
  { id: "", label: "Text" },
  { id: "bash", label: "Bash / Shell" },
  { id: "powershell", label: "PowerShell" },
  { id: "python", label: "Python" },
  { id: "json", label: "JSON" },
  { id: "yaml", label: "YAML" },
  { id: "xml", label: "XML / HTML" },
  { id: "sql", label: "SQL" },
  { id: "ini", label: "INI / Config" },
  { id: "dockerfile", label: "Dockerfile" },
  { id: "nginx", label: "Nginx" },
  { id: "javascript", label: "JavaScript" },
  { id: "css", label: "CSS" },
  { id: "markdown", label: "Markdown" },
  { id: "diff", label: "Diff" },
];

const registered = createLowlight({
  bash,
  css,
  diff,
  dockerfile,
  ini,
  javascript,
  json,
  markdown,
  nginx,
  powershell,
  python,
  sql,
  xml,
  yaml,
});

/** Ohne gewählte Sprache bleibt der Code einfarbig: kein automatisches Raten. */
const lowlight: typeof registered = {
  ...registered,
  highlightAuto: (value: string) => ({
    type: "root",
    children: [{ type: "text", value }],
    data: { language: undefined, relevance: 0 },
  }),
};

/** Bekannte Sprache des Blocks, sonst "" (Text). */
export function codeLanguage(value: unknown): string {
  return typeof value === "string" && CODE_LANGUAGES.some((item) => item.id === value) ? value : "";
}

function CodeView({ node, editor, updateAttributes }: ReactNodeViewProps) {
  const language = codeLanguage(node.attrs.language);
  const label = CODE_LANGUAGES.find((item) => item.id === language)?.label ?? "Text";
  const [copied, setCopied] = useState<"ja" | "fehler" | null>(null);
  const selectId = useId();

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(null), 3000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    const text = node.textContent;
    if (!navigator.clipboard) {
      setCopied("fehler");
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => setCopied("ja"),
      () => setCopied("fehler"),
    );
  };

  return (
    <NodeViewWrapper as="figure" className="doku-code">
      <figcaption className="doku-code-bar" contentEditable={false}>
        {editor.isEditable ? (
          <>
            <label className="doku-code-label" htmlFor={selectId}>
              Sprache
            </label>
            <select
              id={selectId}
              className="doku-code-select"
              value={language}
              onChange={(event) => updateAttributes({ language: event.target.value || null })}
            >
              {CODE_LANGUAGES.map((item) => (
                <option key={item.id || "text"} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </>
        ) : (
          <span className="doku-code-label">{label}</span>
        )}
        <button
          type="button"
          className="doku-code-copy"
          aria-label={`Code kopieren (${label})`}
          onClick={copy}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
          {copied === "ja" ? "Kopiert" : "Kopieren"}
        </button>
        <span role="status" className="visually-hidden">
          {copied === "ja" ? "Code kopiert." : ""}
        </span>
        {copied === "fehler" && (
          <span role="alert" className="doku-code-error">
            Kopieren ist hier nicht möglich. Markiere den Code und kopiere ihn selbst.
          </span>
        )}
      </figcaption>
      <pre>
        <NodeViewContent<"code"> as="code" className={language ? `language-${language}` : ""} />
      </pre>
    </NodeViewWrapper>
  );
}

/** Codeblock mit Sprache, Hervorhebung und „Kopieren“ (ersetzt den Codeblock des StarterKit). */
export const DokuCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeView);
  },
}).configure({ lowlight, defaultLanguage: null, languageClassPrefix: "language-" });
