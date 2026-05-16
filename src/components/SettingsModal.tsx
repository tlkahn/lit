import { useEffect, useCallback, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePreferencesStore, type PreferencesState } from "../stores/preferences";
import { setPreference } from "../lib/ipc";
import { useFocusTrap } from "../hooks/useFocusTrap";
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
  const prev = usePreferencesStore.getState()[storeField];
  usePreferencesStore.setState({ [storeField]: value });
  setPreference(jsonKey, value).catch(() => {
    usePreferencesStore.setState({ [storeField]: prev });
  });
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const prefs = usePreferencesStore(useShallow((s) => ({
    darkMode: s.darkMode,
    colorTheme: s.colorTheme,
    sidebarVisible: s.sidebarVisible,
    sidebarLocation: s.sidebarLocation,
    foldingEnabled: s.foldingEnabled,
    foldingShowControls: s.foldingShowControls,
    mediaThumbnails: s.mediaThumbnails,
    crossrefEnabled: s.crossrefEnabled,
    crossrefLiveRendering: s.crossrefLiveRendering,
    crossrefEnableCiteproc: s.crossrefEnableCiteproc,
    annotationEnabled: s.annotationEnabled,
    annotationScopeHighlight: s.annotationScopeHighlight,
    annotationDefaultLang: s.annotationDefaultLang,
    annotationDisplayMode: s.annotationDisplayMode,
    experimentalUnlinkedReferences: s.experimentalUnlinkedReferences,
  })));

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  const [localColorTheme, setLocalColorTheme] = useState(prefs.colorTheme ?? "");
  const [localAnnotationLang, setLocalAnnotationLang] = useState(prefs.annotationDefaultLang);

  useEffect(() => {
    setLocalColorTheme(prefs.colorTheme ?? "");
  }, [prefs.colorTheme]);

  useEffect(() => {
    setLocalAnnotationLang(prefs.annotationDefaultLang);
  }, [prefs.annotationDefaultLang]);

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
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="rounded-lg bg-bg-primary w-[32rem] max-h-[80vh] flex flex-col"
        data-testid="settings-modal-dialog"
        onClick={(e) => e.stopPropagation()}
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
                value={prefs.darkMode}
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
                checked={prefs.sidebarVisible}
                onChange={(v) => setPref("sidebarVisible", "workbench.sideBar.visible", v)}
              />
              <SegmentedControl
                label="Sidebar Location"
                testId="settings-sidebarLocation"
                value={prefs.sidebarLocation}
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
                checked={prefs.foldingEnabled}
                onChange={(v) => setPref("foldingEnabled", "editor.folding.enabled", v)}
              />
              <SegmentedControl
                label="Folding Controls"
                testId="settings-foldingShowControls"
                value={prefs.foldingShowControls}
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
                checked={prefs.mediaThumbnails}
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
                checked={prefs.crossrefEnabled}
                onChange={(v) => setPref("crossrefEnabled", "crossref.enabled", v)}
              />
              <ToggleSwitch
                label="Live Rendering"
                testId="settings-crossrefLiveRendering"
                checked={prefs.crossrefLiveRendering}
                onChange={(v) => setPref("crossrefLiveRendering", "crossref.liveRendering", v)}
              />
              <ToggleSwitch
                label="Enable Citeproc"
                testId="settings-crossrefEnableCiteproc"
                checked={prefs.crossrefEnableCiteproc}
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
                checked={prefs.annotationEnabled}
                onChange={(v) => setPref("annotationEnabled", "annotations.enabled", v)}
              />
              <ToggleSwitch
                label="Scope Highlight"
                testId="settings-annotationScopeHighlight"
                checked={prefs.annotationScopeHighlight}
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
                value={prefs.annotationDisplayMode}
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
                checked={prefs.experimentalUnlinkedReferences}
                onChange={(v) => setPref("experimentalUnlinkedReferences", "experimental.unlinkedReferences", v)}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
