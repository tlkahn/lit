import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppErrorFallback } from "./components/AppErrorFallback";
import "./index.css";

document.fonts.ready.then(() => {
  if (!document.fonts.check('1em "Symbols Nerd Font Mono"')) {
    document.documentElement.classList.add("nerd-font-failed");
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={AppErrorFallback}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
