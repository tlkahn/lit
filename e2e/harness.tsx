import { createRoot } from "react-dom/client";
import { useState, useCallback, useRef, Suspense, lazy } from "react";
import "../src/index.css";

const GraphView = lazy(() => import("../src/components/GraphView"));

declare global {
  interface Window {
    __HARNESS_CYCLE__: (count: number, type: "mount" | "mode") => Promise<void>;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function Harness() {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState("idle");
  const mountedRef = useRef(false);

  const toggle = useCallback(() => {
    setMounted((prev) => {
      mountedRef.current = !prev;
      return !prev;
    });
  }, []);

  window.__HARNESS_CYCLE__ = async (count: number, type: "mount" | "mode") => {
    setStatus("cycling");
    if (type === "mount") {
      for (let i = 0; i < count; i++) {
        setMounted(true);
        mountedRef.current = true;
        await sleep(600);
        setMounted(false);
        mountedRef.current = false;
        await sleep(300);
      }
    } else {
      const fullBtn = () =>
        document.querySelector<HTMLButtonElement>(
          '.graph-toolbar button[aria-pressed="false"]',
        );
      for (let i = 0; i < count; i++) {
        const btn = fullBtn();
        btn?.click();
        await sleep(600);
      }
    }
    setStatus("done");
  };

  return (
    <>
      <div style={{ position: "fixed", top: 0, left: 0, zIndex: 9999, padding: 8 }}>
        <button data-testid="toggle-mount" onClick={toggle}>
          {mounted ? "Unmount" : "Mount"}
        </button>
        <span data-testid="status" style={{ marginLeft: 8 }}>
          {status}
        </span>
      </div>
      {mounted && (
        <div style={{ position: "absolute", inset: 0, top: 40 }}>
          <Suspense fallback={<div>Loading…</div>}>
            <GraphView activePageId="node-0.md" visible={true} />
          </Suspense>
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById("harness-root")!).render(<Harness />);
