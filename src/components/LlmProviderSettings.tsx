import { useState } from "react";
import { usePreferencesStore, setLlmProvider } from "../stores/preferences";
import { PROVIDER_REGISTRY, PROVIDER_ORDER, defaultModelForProvider, providerNeedsApiKey } from "../lib/providerRegistry";
import { setApiKey, deleteApiKey, hasApiKey } from "../lib/ipc";
import { SettingsDropdown } from "./SettingsDropdown";
import { SettingsPasswordInput } from "./SettingsPasswordInput";
import { SettingsTextInput } from "./SettingsTextInput";
import { TestConnectionButton } from "./TestConnectionButton";

interface LlmProviderSettingsProps {
  ensureUnlocked: () => Promise<void>;
}

export function LlmProviderSettings({ ensureUnlocked }: LlmProviderSettingsProps) {
  const llmProvider = usePreferencesStore((s) => s.llmProvider);
  const [customModel, setCustomModel] = useState(false);
  const [baseUrlExpanded, setBaseUrlExpanded] = useState(false);
  const [localBaseUrl, setLocalBaseUrl] = useState(llmProvider.baseUrl ?? "");

  const providerMeta = PROVIDER_REGISTRY[llmProvider.providerId];
  const knownModelIds = providerMeta?.models.map((m) => m.id) ?? [];
  const isCustomModel = customModel || (llmProvider.model !== "" && !knownModelIds.includes(llmProvider.model));

  const providerOptions = PROVIDER_ORDER.map((id) => ({
    value: id,
    label: PROVIDER_REGISTRY[id]!.label,
  }));

  const modelOptions = [
    ...(providerMeta?.models.map((m) => ({ value: m.id, label: m.label })) ?? []),
    { value: "__custom__", label: "Custom..." },
  ];

  function handleProviderChange(newId: string) {
    const model = defaultModelForProvider(newId);
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

  return (
    <div className="space-y-3" data-testid="llm-provider-settings">
      <SettingsDropdown
        label="Provider"
        testId="settings-llmProvider"
        options={providerOptions}
        value={llmProvider.providerId}
        onChange={handleProviderChange}
      />

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

      {providerNeedsApiKey(llmProvider.providerId) && (
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
