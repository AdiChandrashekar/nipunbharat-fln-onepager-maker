import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { fontsReady } from "./fonts";
import "./app.css";
import { App } from "./App";

// Text is measured during layout, so render only after every bundled face has loaded.
fontsReady().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
