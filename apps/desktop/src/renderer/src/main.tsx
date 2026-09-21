import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Imported before the theme so our token overrides win over allotment's
// `:root` defaults (--focus-border, --separator-border, --sash-size).
import "allotment/dist/style.css";

import App from "./App";
import "./styles/globals.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
