import { useState } from "react";
import { usePreferencesStore, setLlmProvider, removeCustomProvider } from "../stores/preferences";
import { PROVIDER_ORDER, getMergedRegistry, getMergedProviderOrder } from "../lib/providerRegistry";
import { setApiKey, deleteApiKey, hasApiKey } from "../lib/ipc";
import { SettingsDropdown } from "./SettingsDropdown";
import { SettingsPasswordInput } from "./SettingsPasswordInput";
import { SettingsTextInput } from "./SettingsTextInput";
import { TestConnectionButton } from "./TestConnectionButton";
import { CustomProviderForm } from "./CustomProviderForm";

interface LlmProviderSettingsProps {
  ensureUnlocked: () => Promise<void>;
}

export function LlmProviderSettings({ ensureUnlocked }: LlmProviderSettingsProps) {
  const llmProvider = usePreferencesStore((s) => s.llmProvider);
  const customProviders = usePreferencesStore((s) => s.llmCustomProviders);
  const [customModel, setCustomModel] = useState(false);
  const [baseUrlExpanded, setBaseUrlExpanded] = useState(false);
  const [localBaseUrl, setLocalBaseUrl] = useState(llmProvider.baseUrl ?? "");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const registry = getMergedRegistry(customProviders);
  const order = getMergedProviderOrder(customProviders);

  const providerMeta = registry[llmProvider.providerId];
  const knownModelIds = providerMeta?.models.map((m) => m.id) ?? [];
  const isCustomModel = customModel || (llmProvider.model !== "" && !knownModelIds.includes(llmProvider.model));
  const isCustomProvider = llmProvider.providerId.startsWith("custom-");

  const providerOptions = order.map((id) => ({
    value: id,
    label: registry[id]!.label,
  }));

  const modelOptions = [
    ...(providerMeta?.models.map((m) => ({ value: m.id, label: m.label })) ?? []),
    { value: "__custom__", label: "Custom..." },
  ];

  function handleProviderChange(newId: string) {
    const model = registry[newId]?.models[0]?.id ?? "";
    setCustomModel(false);
    setLocalBaseUrl("");
    setBaseUrlExpanded(false);
    hasApiKey(newId).then((has) => {
      setLlmProvider({ providerId: newId, model, baseUrl: undefined, apiKeySet: has });
    }).catch(() => {
      setLlmProvider({ providerId: newId, model, baseUrl: undefined, apiKeySet: false });
    });
  }

  function handleModelChange(value: string) {
    if (value === "__custom__") {
      setCustomModel(true);
      setLlmProvider({ model: "" });
    } else {
      setCustomModel(false);
      setLlmProvider({ model: value });
    }
  }

  function handleCustomModelCommit() {
    // already persisted via setLlmProvider on change; no extra action needed
  }

  function handleDelete() {
    const label = registry[llmProvider.providerId]?.label ?? llmProvider.providerId;
    if (!window.confirm(`Delete custom provider "${label}"?`)) return;
    removeCustomProvider(llmProvider.providerId);
    handleProviderChange(PROVIDER_ORDER[0]!);
  }

  const needsApiKey = registry[llmProvider.providerId]?.needsApiKey ?? true;

  return (
    <div className="space-y-3" data-testid="llm-provider-settings">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <SettingsDropdown
            label="Provider"
            testId="settings-llmProvider"
            options={providerOptions}
            value={llmProvider.providerId}
            onChange={handleProviderChange}
          />
        </div>
        {isCustomProvider && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="custom-provider-edit"
              onClick={() => {
                setEditing(true);
                setFormOpen(true);
              }}
              className="rounded border border-border-primary px-2 py-1 text-sm text-text-normal hover:bg-bg-tertiary"
            >
              Edit
            </button>
            <button
              type="button"
              data-testid="custom-provider-delete"
              onClick={handleDelete}
              className="rounded border border-border-primary px-2 py-1 text-sm text-text-normal hover:bg-bg-tertiary"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      <div>
        <button
          type="button"
          data-testid="custom-provider-add"
          onClick={() => {
            setEditing(false);
            setFormOpen(true);
          }}
          className="text-sm font-medium text-text-muted hover:text-text-normal"
        >
          + Add Custom Provider
        </button>
      </div>

      {formOpen && (
        <CustomProviderForm
          initial={editing ? customProviders.find((p) => p.id === llmProvider.providerId) : undefined}
          onCancel={() => setFormOpen(false)}
          onSaved={(id) => {
            setFormOpen(false);
            handleProviderChange(id);
          }}
        />
      )}

      {isCustomModel ? (
        <SettingsTextInput
          label="Model"
          testId="settings-llmModel"
          value={llmProvider.model}
          onChange={(v) => setLlmProvider({ model: v })}
          onCommit={handleCustomModelCommit}
        />
      ) : (
        <SettingsDropdown
          label="Model"
          testId="settings-llmModel"
          options={modelOptions}
          value={llmProvider.model}
          onChange={handleModelChange}
        />
      )}

      {needsApiKey && (
        <SettingsPasswordInput
          label={`${providerMeta?.label ?? llmProvider.providerId} API Key`}
          testId="settings-llmApiKey"
          hasKey={llmProvider.apiKeySet}
          onSave={(key) => {
            ensureUnlocked().then(() => {
              setLlmProvider({ apiKeySet: true });
              setApiKey(llmProvider.providerId, key).catch(() => {
                setLlmProvider({ apiKeySet: false });
              });
            }).catch(() => {});
          }}
          onDelete={() => {
            ensureUnlocked().then(() => {
              setLlmProvider({ apiKeySet: false });
              deleteApiKey(llmProvider.providerId).catch(() => {
                setLlmProvider({ apiKeySet: true });
              });
            }).catch(() => {});
          }}
        />
      )}

      <div>
        <button
          onClick={() => setBaseUrlExpanded((prev) => !prev)}
          className="flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text-normal"
          data-testid="settings-baseUrl-toggle"
        >
          <span className="text-xs">{baseUrlExpanded ? "▼" : "▶"}</span> Base URL Override
        </button>
        {baseUrlExpanded && (
          <div className="mt-2">
            <SettingsTextInput
              testId="settings-llmBaseUrl"
              value={localBaseUrl}
              onChange={setLocalBaseUrl}
              onCommit={() => {
                const trimmed = localBaseUrl.trim();
                const baseUrl = trimmed === "" ? undefined : trimmed;
                setLocalBaseUrl(trimmed);
                setLlmProvider({ baseUrl });
              }}
              placeholder={providerMeta?.defaultBaseUrl}
            />
          </div>
        )}
      </div>

      <TestConnectionButton
        model={llmProvider.model}
        baseUrl={llmProvider.baseUrl}
        provider={llmProvider.providerId}
      />
    </div>
  );
}
