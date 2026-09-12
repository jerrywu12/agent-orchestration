/// <reference types="vite/client" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { pwa } from "./pwa";
import "./styles.css";

// Capture install events immediately. Keep Vite development free of persistent
// workers; production builds register the network-only navigation fallback.
void pwa.start({ registerServiceWorker: import.meta.env.PROD });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
