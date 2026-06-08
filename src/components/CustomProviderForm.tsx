import { useState } from "react";
import {
  usePreferencesStore,
  addCustomProvider,
  updateCustomProvider,
} from "../stores/preferences";
import { slugify, getMergedRegistry } from "../lib/providerRegistry";
import type { CustomProviderDef } from "../lib/providerRegistry";
import { SettingsTextInput } from "./SettingsTextInput";

interface CustomProviderFormProps {
  initial?: CustomProviderDef;
  onCancel: () => void;
  onSaved: (id: string) => void;
}

const numberInputClass =
  "rounded border border-border-primary bg-bg-secondary px-2 py-1 text-sm text-text-normal";

export function CustomProviderForm({ initial, onCancel, onSaved }: CustomProviderFormProps) {
  const editing = initial != null;
  const customProviders = usePreferencesStore((s) => s.llmCustomProviders);

  const [name, setName] = useState(initial?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [needsApiKey, setNeedsApiKey] = useState(initial?.needsApiKey ?? true);
  const [modelId, setModelId] = useState(initial?.modelId ?? "");
  const [contextWindow, setContextWindow] = useState(
    initial != null ? String(initial.contextWindow) : "128000",
  );
  const [error, setError] = useState<string | null>(null);

  const id = editing ? initial!.id : slugify(name);

  function handleSave() {
    const trimmedName = name.trim();
    const trimmedBaseUrl = baseUrl.trim();
    const trimmedModelId = modelId.trim();

    if (trimmedName === "" || trimmedBaseUrl === "" || trimmedModelId === "") {
      setError("Name, Base URL, and Default Model ID are required.");
      return;
    }

    const existingIds = new Set(Object.keys(getMergedRegistry(customProviders)));
    if (editing) existingIds.delete(initial!.id);
    if (existingIds.has(id)) {
      setError(`Provider id "${id}" already exists.`);
      return;
    }

    const parsed = parseInt(contextWindow, 10);
    const def: CustomProviderDef = {
      id,
      name: trimmedName,
      baseUrl: trimmedBaseUrl,
      needsApiKey,
      modelId: trimmedModelId,
      contextWindow: Number.isFinite(parsed) && parsed > 0 ? parsed : 128000,
    };

    if (editing) {
      const { id: _id, ...patch } = def;
      void _id;
      updateCustomProvider(initial!.id, patch);
    } else {
      addCustomProvider(def);
    }
    onSaved(id);
  }

  return (
    <div
      className="space-y-3 rounded border border-border-primary bg-bg-secondary p-3"
      data-testid="custom-provider-form"
    >
      <SettingsTextInput
        label="Name"
        testId="custom-provider-name"
        value={name}
        onChange={setName}
      />
      <SettingsTextInput
        label="Base URL"
        testId="custom-provider-baseUrl"
        value={baseUrl}
        onChange={setBaseUrl}
      />
      <label className="flex items-center justify-between gap-2">
        <span className="text-sm text-text-normal">Requires API Key</span>
        <input
          type="checkbox"
          data-testid="custom-provider-needsApiKey"
          checked={needsApiKey}
          onChange={(e) => setNeedsApiKey(e.target.checked)}
        />
      </label>
      <SettingsTextInput
        label="Default Model ID"
        testId="custom-provider-modelId"
        value={modelId}
        onChange={setModelId}
      />
      <label className="flex items-center justify-between gap-2">
        <span className="text-sm text-text-normal">Context Window</span>
        <input
          type="number"
          data-testid="custom-provider-contextWindow"
          value={contextWindow}
          onChange={(e) => setContextWindow(e.target.value)}
          className={numberInputClass}
        />
      </label>

      {error && (
        <p className="text-sm text-red-500" data-testid="custom-provider-error">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          data-testid="custom-provider-cancel"
          onClick={onCancel}
          className="rounded border border-border-primary px-3 py-1 text-sm text-text-normal hover:bg-bg-tertiary"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="custom-provider-save"
          onClick={handleSave}
          className="rounded bg-accent px-3 py-1 text-sm text-white hover:opacity-90"
        >
          Save
        </button>
      </div>
    </div>
  );
}
