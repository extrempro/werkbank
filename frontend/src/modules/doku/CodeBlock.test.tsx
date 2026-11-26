import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import { DokuEditor } from "./DokuEditor";
import { CODE_LANGUAGES, codeLanguage } from "./CodeBlock";
import type { DocJson } from "./api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const code = (language: string | null, text: string): DocJson => ({
  type: "doc",
  content: [{ type: "codeBlock", attrs: { language }, content: [{ type: "text", text }] }],
});

function setup(content: DocJson, editable = true) {
  let editor: Editor | null = null;
  const { container } = render(
    <DokuEditor
      editable={editable}
      label="Inhalt"
      content={content}
      onReady={(current) => {
        editor = current;
      }}
    />,
  );
  if (!editor) {
    throw new Error("Editor fehlt");
  }
  return { editor: editor as Editor, container };
}

describe("Doku: Codeblöcke", () => {
  it("kennt nur die Sprachen der Auswahl", () => {
    expect(CODE_LANGUAGES.map((item) => item.id)).toContain("powershell");
    expect(codeLanguage("yaml")).toBe("yaml");
    expect(codeLanguage("cobol")).toBe("");
    expect(codeLanguage(null)).toBe("");
  });

  it("färbt nach gewählter Sprache und speichert die Wahl am Block", async () => {
    const { editor, container } = setup(code(null, 'echo "hallo" # Gruß'));
    const select = await screen.findByRole("combobox", { name: "Sprache" });
    expect(select).toHaveValue("");
    // Text: einfarbig, nichts wird geraten
    expect(container.querySelector(".doku-code [class^='hljs-']")).toBeNull();

    act(() => {
      fireEvent.change(select, { target: { value: "bash" } });
    });
    expect(editor.getJSON().content?.[0]?.attrs?.language).toBe("bash");
    await waitFor(() => expect(container.querySelector(".doku-code .hljs-string")).not.toBeNull());
    expect(container.querySelector(".doku-code .hljs-comment")).toHaveTextContent("# Gruß");

    act(() => {
      fireEvent.change(select, { target: { value: "" } });
    });
    expect(editor.getJSON().content?.[0]?.attrs?.language).toBeNull();
  });

  it("zeigt beim Lesen die Sprache und kopiert den Code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup(code("powershell", "Get-Service W3SVC"), false);
    expect(await screen.findByText("PowerShell")).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Sprache" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Code kopieren (PowerShell)" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Get-Service W3SVC"));
    expect(await screen.findByText("Code kopiert.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Code kopieren (PowerShell)" })).toHaveTextContent(
      "Kopiert",
    );
  });

  it("meldet, wenn Kopieren nicht geht", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    setup(code("json", "{}"), false);
    fireEvent.click(await screen.findByRole("button", { name: "Code kopieren (JSON)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Kopieren ist hier nicht möglich");
  });
});
