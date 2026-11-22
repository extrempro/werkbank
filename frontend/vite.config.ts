import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
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

// Daten für pdf.js (Bild-Konverter): Schriften, CMaps und WebAssembly-Dekoder unter /pdfjs/.
// Sie werden nur geladen, wenn eine PDF sie braucht.
const PDFJS_DIRS = ["cmaps", "standard_fonts", "wasm"];
const PDFJS_TYPES: Record<string, string> = {
  ".wasm": "application/wasm",
  ".js": "text/javascript",
};

function pdfjsFiles(): { name: string; path: string }[] {
  const root = resolve("node_modules/pdfjs-dist");
  return PDFJS_DIRS.flatMap((dir) =>
    readdirSync(resolve(root, dir))
      // QuickJS gehört zum Skript-Teil von pdf.js, den die Werkbank nicht nutzt
      .filter((file) => !file.toLowerCase().includes("quickjs"))
      .map((file) => ({
        name: `pdfjs/${dir}/${file}`,
        path: resolve(root, dir, file),
      })),
  );
}

function pdfjsAssets(): Plugin {
  return {
    name: "werkbank-pdfjs-assets",
    configureServer(server) {
      const files = new Map(pdfjsFiles().map((file) => [`/${file.name}`, file.path]));
      server.middlewares.use((request, response, next) => {
        const path = files.get((request.url ?? "").split("?")[0] ?? "");
        if (!path) return next();
        response.setHeader(
          "Content-Type",
          PDFJS_TYPES[extname(path)] ?? "application/octet-stream",
        );
        response.end(readFileSync(path));
      });
    },
    generateBundle() {
      for (const file of pdfjsFiles()) {
        this.emitFile({ type: "asset", fileName: file.name, source: readFileSync(file.path) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerVersion(), pdfjsAssets()],
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
