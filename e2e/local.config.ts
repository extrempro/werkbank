import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

const projects = (base.projects ?? []).map((p) => ({
  ...p,
  use: { ...p.use, launchOptions: { executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" } },
}));
export default defineConfig({ ...base, webServer: undefined, projects });
