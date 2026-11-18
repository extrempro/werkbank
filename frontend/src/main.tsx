import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initBranding } from "./branding";
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
registerServiceWorker();
applyTheme();
watchTheme();
applyMenuSize();
applyMenuSpacing();
watchMenuSize();
initBranding();
