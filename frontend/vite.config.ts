import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// Schreibt eine eindeutige Build-Kennung in den Service Worker, damit Browser jede neue
// Version erkennen und den Update-Hinweis anzeigen.
function serviceWorkerVersion(): Plugin {
  return {
    name: "werkbank-sw-version",
    apply: "build",
    closeBundle() {
      const file = resolve("dist/sw.js");
      const build = new Date().toISOString().replace(/[^0-9]/g, "");
      writeFileSync(file, readFileSync(file, "utf-8").replace("__WERKBANK_BUILD__", build));
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerVersion()],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/auth": "http://localhost:8000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
