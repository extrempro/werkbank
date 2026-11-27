import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackDialog } from "./components/FeedbackDialog";
import {
  base64Bytes,
  browserLabel,
  feedbackDraft,
  keepFeedbackDraft,
  parseFeedbackAdminPath,
  recentBrowserErrors,
  rememberBrowserError,
  type Feedback,
} from "./feedback";
import { FeedbackAdminPage } from "./pages/FeedbackAdminPage";
import { MyFeedbackPage } from "./pages/MyFeedbackPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(routes: Record<string, unknown>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(routes)
        .filter(
          (route) => `${method} ${url}` === route || `${method} ${url}`.startsWith(`${route}?`),
        )
        .sort((left, right) => right.length - left.length)[0];
      return key
        ? new Response(JSON.stringify(routes[key]), { status: 200 })
        : new Response(JSON.stringify({ detail: "Nicht gefunden" }), { status: 404 });
    }),
  );
  return calls;
}

const entry: Feedback = {
  id: 12,
  number: "RM-0012",
  kind: "fehler",
  status: "in_arbeit",
  title: "Diagramm bleibt leer",
  page: "/bestand/statistik",
  user_name: "Ina Beispiel",
  has_screenshot: true,
  replies: 1,
  created_at: "2026-11-27T10:42:00Z",
  text: "Diagramm bleibt leer",
  technical: {
    version: "0.151.0",
    window: "1280 × 800",
    browser: "Mozilla/5.0",
    browser_errors: ["TypeError: x"],
  },
  reply_list: [{ id: 1, author: "Max Muster", text: "Danke!", created_at: "2026-11-27T11:00:00Z" }],
  status_changed_at: null,
  closed_at: null,
};

describe("Hilfsfunktionen Rückmeldungen", () => {
  it("merkt sich höchstens fünf Fehler des Browsers, einzeilig", () => {
    for (let index = 0; index < 7; index += 1) {
      rememberBrowserError(`Fehler ${index}\nzweite Zeile`);
    }
    expect(recentBrowserErrors()).toHaveLength(5);
    expect(recentBrowserErrors()[4]).toBe("Fehler 6 zweite Zeile");
  });

  it("erkennt Browser, Pfade, Größen und Entwürfe", () => {
    expect(
      browserLabel(
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/142.0 Safari/537.36 Edg/142.0",
      ),
    ).toBe("Edge 142 unter Windows");
    expect(browserLabel("Mozilla/5.0 (iPhone) Version/18.1 Mobile Safari/604.1")).toBe(
      "Safari 18 unter iOS",
    );
    expect(parseFeedbackAdminPath("/verwaltung/rueckmeldungen")).toEqual({ id: null });
    expect(parseFeedbackAdminPath("/verwaltung/rueckmeldungen/7")).toEqual({ id: 7 });
    expect(parseFeedbackAdminPath("/verwaltung/rueckmeldungen/x")).toBeNull();
    expect(base64Bytes("QUJD")).toBe(3);
    expect(base64Bytes("QUI=")).toBe(2);
    keepFeedbackDraft("/a", "idee", "Text");
    expect(feedbackDraft("/a")).toEqual({ kind: "idee", text: "Text" });
    keepFeedbackDraft("/a", null, " ");
    expect(feedbackDraft("/a")).toEqual({ kind: null, text: "" });
  });
});

describe("Rückmeldung geben", () => {
  it("prüft, zeigt technische Angaben und sendet einen Fehler", async () => {
    const calls = stubFetch({ "POST /api/feedback": { ...entry, status: "neu" } });
    render(
      <FeedbackDialog
        page="/bestand/statistik"
        pageTitle="IT-Bestand › Statistik"
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Rückmeldung geben" });
    expect(within(dialog).getByText("IT-Bestand › Statistik")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Senden" }));
    expect(await within(dialog).findByText(/Fehler oder eine Idee/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("radio", { name: /Fehler/ }));
    fireEvent.change(within(dialog).getByLabelText(/Was ist passiert/), {
      target: { value: "kaputt" },
    });
    expect(within(dialog).getByText("Was zusätzlich mitgeht")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Bild auswählen/ })).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Was ist passiert/), {
      target: { value: "ok" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Senden" }));
    expect(await within(dialog).findByText(/etwas genauer/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Was ist passiert/), {
      target: { value: "Das Diagramm bleibt leer." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Senden" }));
    expect(await within(dialog).findByText(/RM-0012 ist angekommen/)).toBeTruthy();
    const body = calls.find((call) => call.method === "POST")?.body as Record<string, unknown>;
    expect(body.kind).toBe("fehler");
    expect(body.text).toBe("Das Diagramm bleibt leer.");
    expect(body.page).toBe("/bestand/statistik");
    expect(body.technical).toBeTruthy();
    expect(body.screenshot).toBeUndefined();
  });

  it("schickt bei einer Idee keine technischen Angaben", async () => {
    const calls = stubFetch({ "POST /api/feedback": { ...entry, kind: "idee" } });
    render(<FeedbackDialog page="/" pageTitle="Start" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Idee/ }));
    expect(screen.queryByText("Was zusätzlich mitgeht")).toBeNull();
    fireEvent.change(screen.getByLabelText(/Deine Idee/), {
      target: { value: "Dunkles Logo für Mails" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    await screen.findByText(/ist angekommen/);
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      kind: "idee",
      text: "Dunkles Logo für Mails",
      page: "/",
    });
  });
});

describe("Seiten Rückmeldungen", () => {
  it("zeigt eigene Rückmeldungen mit Antwort", async () => {
    stubFetch({ "GET /api/feedback/mine": [entry] });
    render(<MyFeedbackPage onNew={() => {}} />);
    expect(await screen.findByText("Danke!")).toBeTruthy();
    expect(screen.getByText("In Arbeit")).toBeTruthy();
  });

  it("lässt Admins Stand setzen und antworten", async () => {
    const calls = stubFetch({
      "GET /api/feedback": { entries: [entry], open: 1 },
      "GET /api/feedback/12": entry,
      "PUT /api/feedback/12/status": { ...entry, status: "erledigt" },
      "POST /api/feedback/12/replies": entry,
    });
    render(<FeedbackAdminPage id={12} />);
    expect(await screen.findByRole("heading", { name: "Diagramm bleibt leer" })).toBeTruthy();
    expect(screen.getByRole("img", { name: /Bildschirmfoto zu RM-0012/ })).toBeTruthy();
    expect(screen.getByText("TypeError: x")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Erledigt" }));
    await screen.findByText(/Der Stand ist jetzt „Erledigt“/);
    fireEvent.change(screen.getByLabelText(/Antwort an Ina Beispiel/), {
      target: { value: "Ist behoben." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Antwort senden" }));
    await vi.waitFor(() =>
      expect(calls.find((call) => call.url.endsWith("/replies"))?.body).toEqual({
        text: "Ist behoben.",
      }),
    );
  });
});
