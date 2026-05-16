import { useEffect, useCallback, useState } from "react";
import { usePreferencesStore, type PreferencesState } from "../stores/preferences";
import { setPreference } from "../lib/ipc";
import { SegmentedControl } from "./SegmentedControl";
import { ToggleSwitch } from "./ToggleSwitch";
import { SettingsTextInput } from "./SettingsTextInput";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

function setPref<K extends keyof PreferencesState>(
  storeField: K,
  jsonKey: string,
  value: PreferencesState[K],
) {
  usePreferencesStore.setState({ [storeField]: value });
  setPreference(jsonKey, value).catch(console.error);
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const darkMode = usePreferencesStore((s) => s.darkMode);
  const colorTheme = usePreferencesStore((s) => s.colorTheme);
  const sidebarVisible = usePreferencesStore((s) => s.sidebarVisible);
  const sidebarLocation = usePreferencesStore((s) => s.sidebarLocation);
  const foldingEnabled = usePreferencesStore((s) => s.foldingEnabled);
  const foldingShowControls = usePreferencesStore((s) => s.foldingShowControls);
  const mediaThumbnails = usePreferencesStore((s) => s.mediaThumbnails);
  const crossrefEnabled = usePreferencesStore((s) => s.crossrefEnabled);
  const crossrefLiveRendering = usePreferencesStore((s) => s.crossrefLiveRendering);
  const crossrefEnableCiteproc = usePreferencesStore((s) => s.crossrefEnableCiteproc);
  const annotationEnabled = usePreferencesStore((s) => s.annotationEnabled);
  const annotationScopeHighlight = usePreferencesStore((s) => s.annotationScopeHighlight);
  const annotationDefaultLang = usePreferencesStore((s) => s.annotationDefaultLang);
  const annotationDisplayMode = usePreferencesStore((s) => s.annotationDisplayMode);
  const experimentalUnlinkedReferences = usePreferencesStore((s) => s.experimentalUnlinkedReferences);

  const [localColorTheme, setLocalColorTheme] = useState(colorTheme ?? "");
  const [localAnnotationLang, setLocalAnnotationLang] = useState(annotationDefaultLang);

  useEffect(() => {
    setLocalColorTheme(colorTheme ?? "");
  }, [colorTheme]);

  useEffect(() => {
    setLocalAnnotationLang(annotationDefaultLang);
  }, [annotationDefaultLang]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="settings-modal-backdrop"
    >
      <div
        className="rounded-lg bg-bg-primary w-[32rem] max-h-[80vh] flex flex-col"
        data-testid="settings-modal-dialog"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-base font-semibold text-text-normal">Settings</h2>
          <button
            className="rounded p-1 text-text-muted hover:bg-bg-secondary"
            onClick={onClose}
            data-testid="settings-modal-close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div data-testid="settings-modal-content" className="flex-1 overflow-y-auto px-5 pb-5">
          <section>
            <h3 className="text-sm font-medium text-text-muted mb-3">Appearance</h3>
            <div className="space-y-3">
              <SegmentedControl
                label="Dark Mode"
                testId="settings-darkMode"
                value={darkMode}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                ]}
                onChange={(v) => setPref("darkMode", "workbench.darkMode", v as PreferencesState["darkMode"])}
              />
              <SettingsTextInput
                label="Color Theme"
                testId="settings-colorTheme"
                value={localColorTheme}
                onChange={setLocalColorTheme}
                onCommit={() => {
                  const val = localColorTheme.trim() === "" ? null : localColorTheme.trim();
                  setPref("colorTheme", "workbench.colorTheme", val);
                }}
              />
              <ToggleSwitch
                label="Sidebar Visible"
                testId="settings-sidebarVisible"
                checked={sidebarVisible}
                onChange={(v) => setPref("sidebarVisible", "workbench.sideBar.visible", v)}
              />
              <SegmentedControl
                label="Sidebar Location"
                testId="settings-sidebarLocation"
                value={sidebarLocation}
                options={[
                  { value: "left", label: "Left" },
                  { value: "right", label: "Right" },
                ]}
                onChange={(v) => setPref("sidebarLocation", "workbench.sideBar.location", v as PreferencesState["sidebarLocation"])}
              />
            </div>
          </section>

          <section className="mt-5">
            <h3 className="text-sm font-medium text-text-muted mb-3">Editor</h3>
            <div className="space-y-3">
              <ToggleSwitch
                label="Folding"
                testId="settings-foldingEnabled"
                checked={foldingEnabled}
                onChange={(v) => setPref("foldingEnabled", "editor.folding.enabled", v)}
              />
              <SegmentedControl
                label="Folding Controls"
                testId="settings-foldingShowControls"
                value={foldingShowControls}
                options={[
                  { value: "mouseover", label: "Mouseover" },
                  { value: "always", label: "Always" },
                  { value: "never", label: "Never" },
                ]}
                onChange={(v) => setPref("foldingShowControls", "editor.folding.showFoldingControls", v as PreferencesState["foldingShowControls"])}
              />
              <ToggleSwitch
                label="Media Thumbnails"
                testId="settings-mediaThumbnails"
                checked={mediaThumbnails}
                onChange={(v) => setPref("mediaThumbnails", "editor.mediaThumbnails", v)}
              />
            </div>
          </section>

          <section className="mt-5">
            <h3 className="text-sm font-medium text-text-muted mb-3">Cross-references</h3>
            <div className="space-y-3">
              <ToggleSwitch
                label="Enabled"
                testId="settings-crossrefEnabled"
                checked={crossrefEnabled}
                onChange={(v) => setPref("crossrefEnabled", "crossref.enabled", v)}
              />
              <ToggleSwitch
                label="Live Rendering"
                testId="settings-crossrefLiveRendering"
                checked={crossrefLiveRendering}
                onChange={(v) => setPref("crossrefLiveRendering", "crossref.liveRendering", v)}
              />
              <ToggleSwitch
                label="Enable Citeproc"
                testId="settings-crossrefEnableCiteproc"
                checked={crossrefEnableCiteproc}
                onChange={(v) => setPref("crossrefEnableCiteproc", "crossref.enableCiteproc", v)}
              />
            </div>
          </section>

          <section className="mt-5">
            <h3 className="text-sm font-medium text-text-muted mb-3">Annotations</h3>
            <div className="space-y-3">
              <ToggleSwitch
                label="Enabled"
                testId="settings-annotationEnabled"
                checked={annotationEnabled}
                onChange={(v) => setPref("annotationEnabled", "annotations.enabled", v)}
              />
              <ToggleSwitch
                label="Scope Highlight"
                testId="settings-annotationScopeHighlight"
                checked={annotationScopeHighlight}
                onChange={(v) => setPref("annotationScopeHighlight", "annotations.scopeHighlight", v)}
              />
              <SettingsTextInput
                label="Default Language"
                testId="settings-annotationDefaultLang"
                value={localAnnotationLang}
                onChange={setLocalAnnotationLang}
                onCommit={() => {
                  setPref("annotationDefaultLang", "annotations.defaultLang", localAnnotationLang);
                }}
              />
              <SegmentedControl
                label="Display Mode"
                testId="settings-annotationDisplayMode"
                value={annotationDisplayMode}
                options={[
                  { value: "pill", label: "Pill" },
                  { value: "footnote", label: "Footnote" },
                ]}
                onChange={(v) => setPref("annotationDisplayMode", "annotations.displayMode", v as PreferencesState["annotationDisplayMode"])}
              />
            </div>
          </section>

          <section className="mt-5">
            <h3 className="text-sm font-medium text-text-muted mb-3">Experimental</h3>
            <div className="space-y-3">
              <ToggleSwitch
                label="Unlinked References"
                testId="settings-experimentalUnlinkedReferences"
                checked={experimentalUnlinkedReferences}
                onChange={(v) => setPref("experimentalUnlinkedReferences", "experimental.unlinkedReferences", v)}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
