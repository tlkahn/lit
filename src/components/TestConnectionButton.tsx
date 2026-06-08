import { useState, useEffect } from "react";
import { testLlmConnection } from "../lib/ipc";

interface TestConnectionButtonProps {
  model: string;
  baseUrl?: string;
  provider?: string;
}

export function TestConnectionButton({ model, baseUrl, provider }: TestConnectionButtonProps) {
  const [status, setStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (status !== "success") return;
    const timer = setTimeout(() => setStatus("idle"), 3000);
    return () => clearTimeout(timer);
  }, [status]);

  async function handleClick() {
    setStatus("testing");
    setErrorMsg("");
    try {
      await testLlmConnection(model, baseUrl, provider);
      setStatus("success");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        data-testid="test-connection-btn"
        disabled={status === "testing"}
        onClick={handleClick}
        className="rounded border border-border px-3 py-1 text-sm text-text-normal hover:bg-bg-secondary disabled:opacity-50"
      >
        {status === "testing" ? "Testing..." : "Test Connection"}
      </button>
      {status === "success" && (
        <span data-testid="test-connection-status" className="text-sm text-text-success">
          Connected
        </span>
      )}
      {status === "error" && (
        <span data-testid="test-connection-status" className="text-sm text-text-error">
          {errorMsg}
        </span>
      )}
    </div>
  );
}
