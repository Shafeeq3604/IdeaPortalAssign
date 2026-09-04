import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Tailwind + design tokens (theme.css imports tokens.css). SPEC §7.
import "@iep/ui/theme.css";
import "./index.css";

import { AppRouter } from "./AppRouter";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found in index.html");

createRoot(container).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
);
