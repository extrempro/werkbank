import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inVault,
  looksLikeSecret,
  parseItems,
  serializeItems,
  VaultItemForm,
  VaultList,
} from "./BitwardenBlock";

afterEach(cleanup);

const VAULT = "https://vault.example.com";

describe("Bitwarden-Einträge", () => {
  it("lässt nur Links auf den eingestellten Tresor zu", () => {
    expect(inVault(`${VAULT}/#/vault?itemId=1`, VAULT)).toBe(true);
    expect(inVault(VAULT, VAULT)).toBe(true);
    expect(inVault("https://vault.example.com.evil.example/x", VAULT)).toBe(false);
    expect(inVault("http://vault.example.com/x", "http://vault.example.com")).toBe(false);
    expect(inVault(`${VAULT}/x`, "")).toBe(false);
    expect(inVault("javascript:alert(1)", VAULT)).toBe(false);
  });

  it("erkennt Text, der wie ein Passwort aussieht", () => {
    expect(looksLikeSecret("Admin-Konto, nur im Notfall")).toBe(false);
    expect(looksLikeSecret("Passwort: Sommer")).toBe(true);
    expect(looksLikeSecret("Zugang Xk9!pQ2#mLr7vB")).toBe(true);
    expect(looksLikeSecret("Firewall-Weboberflaeche")).toBe(false);
  });

  it("liest und schreibt die Einträge als Text", () => {
    const items = [
      { url: `${VAULT}/a`, name: "A", hint: "" },
      { url: `${VAULT}/b`, name: "B", hint: "Notfall" },
    ];
    expect(parseItems(serializeItems(items))).toEqual(items);
    expect(serializeItems(items)).not.toContain('"hint":""');
    expect(parseItems("{kaputt")).toEqual([]);
    expect(parseItems(JSON.stringify([{ url: 1 }]))).toEqual([]);
  });

  it("zeigt „Öffnen“ nur für Links auf den Tresor", () => {
    render(
      <VaultList
        vault={VAULT}
        items={[
          { url: `${VAULT}/#/vault?itemId=1`, name: "Firewall", hint: "Admin" },
          { url: "https://fremd.example.com/", name: "Fremd", hint: "" },
        ]}
      />,
    );
    const open = screen.getByRole("link", { name: "Firewall in Bitwarden öffnen (neues Fenster)" });
    expect(open).toHaveAttribute("rel", "noopener noreferrer");
    expect(open).toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("link", { name: /Fremd/ })).not.toBeInTheDocument();
    expect(screen.getByText(/führt nicht zum eingestellten Tresor/)).toBeInTheDocument();
    expect(screen.getByText("2 Einträge")).toBeInTheDocument();
  });

  it("prüft Link und Namen und warnt vor Passwörtern", () => {
    const onSubmit = vi.fn();
    render(<VaultItemForm initial={null} vault={VAULT} onSubmit={onSubmit} onCancel={() => {}} />);
    const link = screen.getByRole("textbox", { name: /Link zum Eintrag/ });
    fireEvent.change(link, { target: { value: "https://fremd.example.com/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));
    expect(screen.getByText(/führt nicht zu eurem Tresor/)).toBeInTheDocument();
    expect(screen.getByText("Gib dem Eintrag einen Namen.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(link, { target: { value: `${VAULT}/#/vault?itemId=1` } });
    fireEvent.change(screen.getByRole("textbox", { name: /Anzeigename/ }), {
      target: { value: "Firewall" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Hinweis/ }), {
      target: { value: "PW: Xk9!pQ2#mLr7vB" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));
    const warning = screen.getByRole("alertdialog", { name: "Steht da ein Passwort?" });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(within(warning).getByRole("button", { name: "Trotzdem übernehmen" }));
    expect(onSubmit).toHaveBeenCalledWith({
      url: `${VAULT}/#/vault?itemId=1`,
      name: "Firewall",
      hint: "PW: Xk9!pQ2#mLr7vB",
    });
  });
});
