import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppErrorFallback } from "./components/AppErrorFallback";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={AppErrorFallback}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
