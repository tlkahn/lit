import { useState, useEffect } from "react";
import { usePreferencesStore } from "../stores/preferences";
import { setPreference, testZoteroConnection } from "../lib/ipc";
import { SettingsTextInput } from "./SettingsTextInput";

export function ZoteroSettings() {
  const zoteroDatabasePath = usePreferencesStore((s) => s.zoteroDatabasePath);
  const [localDbPath, setLocalDbPath] = useState(zoteroDatabasePath);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testResult, setTestResult] = useState("");

  useEffect(() => {
    setLocalDbPath(zoteroDatabasePath);
  }, [zoteroDatabasePath]);

  useEffect(() => {
    if (testStatus !== "success") return;
    const timer = setTimeout(() => setTestStatus("idle"), 5000);
    return () => clearTimeout(timer);
  }, [testStatus]);

  function commitDbPath() {
    const trimmed = localDbPath.trim();
    const val = trimmed === "" ? null : trimmed;
    const prev = zoteroDatabasePath;
    usePreferencesStore.setState({ zoteroDatabasePath: trimmed });
    setPreference("zotero.databasePath", val).catch(() => {
      usePreferencesStore.setState({ zoteroDatabasePath: prev });
    });
  }

  async function handleBrowse() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      filters: [{ name: "SQLite Database", extensions: ["sqlite"] }],
    });
    if (!selected || typeof selected !== "string") return;
    setLocalDbPath(selected);
    const prev = zoteroDatabasePath;
    usePreferencesStore.setState({ zoteroDatabasePath: selected });
    setPreference("zotero.databasePath", selected).catch(() => {
      usePreferencesStore.setState({ zoteroDatabasePath: prev });
    });
  }

  async function handleTestConnection() {
    setTestStatus("testing");
    setTestResult("");
    try {
      const result = await testZoteroConnection(localDbPath || undefined);
      setTestStatus("success");
      setTestResult(
        `Found ${result.pdfCount} PDF${result.pdfCount !== 1 ? "s" : ""} with ${result.annotationCount} annotation${result.annotationCount !== 1 ? "s" : ""}`,
      );
    } catch (e) {
      setTestStatus("error");
      setTestResult(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-3" data-testid="zotero-settings">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <SettingsTextInput
            label="Database Path"
            testId="settings-zoteroDatabasePath"
            value={localDbPath}
            onChange={setLocalDbPath}
            onCommit={commitDbPath}
            placeholder="~/Zotero/zotero.sqlite"
          />
        </div>
        <button
          data-testid="zotero-browse-btn"
          onClick={handleBrowse}
          className="rounded border border-border px-3 py-1 text-sm text-text-normal hover:bg-bg-secondary"
        >
          Browse
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          data-testid="zotero-test-connection-btn"
          disabled={testStatus === "testing"}
          onClick={handleTestConnection}
          className="rounded border border-border px-3 py-1 text-sm text-text-normal hover:bg-bg-secondary disabled:opacity-50"
        >
          {testStatus === "testing" ? "Testing..." : "Test Connection"}
        </button>
        {testStatus === "success" && (
          <span data-testid="zotero-test-status" className="text-sm text-text-success">
            {testResult}
          </span>
        )}
        {testStatus === "error" && (
          <span data-testid="zotero-test-status" className="text-sm text-text-error">
            {testResult}
          </span>
        )}
      </div>
    </div>
  );
}
