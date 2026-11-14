import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:8080";

// Geräteprofile nach docs/spec.md, Kapitel 13. Tablet und Handy laufen vorerst mit
// Chromium-Emulation (Bildschirm, Touch, User-Agent); echte WebKit-Tests folgen mit HTTPS.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "tablet", use: { ...devices["iPad (gen 7)"], browserName: "chromium" } },
    { name: "handy", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
});
