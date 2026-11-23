import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test.describe("PWA und Service Worker", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "nur Desktop");
  });

  test("Manifest ist erreichbar", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBeTruthy();
    const manifest = await response.json();
    expect(manifest.name).toBe("Werkbank");
  });

  test("ohne Netz erscheint die Offline-Seite, API-Daten liegen nie im Cache", async ({
    page,
    context,
  }) => {
    await loginAs(page, ["Config.Reader"], "Otto Offline");
    await page.goto("/");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: /^Guten (Morgen|Tag|Abend), Otto Offline$/,
      }),
    ).toBeVisible();

    const cachedUrls = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          urls.push(new URL(request.url).pathname);
        }
      }
      return urls;
    });
    expect(cachedUrls).toContain("/offline.html");
    expect(
      cachedUrls.filter(
        (url) => url.startsWith("/api/") || url.startsWith("/auth/"),
      ),
    ).toEqual([]);

    await context.setOffline(true);
    await page.goto("/evergreen").catch(() => undefined);
    await expect(
      page.getByRole("heading", { name: "Keine Verbindung" }),
    ).toBeVisible();
    await context.setOffline(false);
  });
});
