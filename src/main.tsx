import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppErrorFallback } from "./components/AppErrorFallback";
import "./index.css";

document.fonts.load('1em "Symbols Nerd Font Mono"').then(
  (fonts) => {
    if (fonts.length === 0) {
      document.documentElement.classList.add("nerd-font-failed");
    }
  },
  () => document.documentElement.classList.add("nerd-font-failed"),
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={AppErrorFallback}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
