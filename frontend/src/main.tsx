import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initBranding } from "./branding";
import { watchBrowserErrors } from "./feedback";
import { applyMenuSize, applyMenuSpacing, watchMenuSize } from "./menuSize";
import { registerServiceWorker } from "./sw-register";
import { applyTheme, watchTheme } from "./theme";
import "./styles.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
watchBrowserErrors();
registerServiceWorker();
applyTheme();
watchTheme();
applyMenuSize();
applyMenuSpacing();
watchMenuSize();
initBranding();
