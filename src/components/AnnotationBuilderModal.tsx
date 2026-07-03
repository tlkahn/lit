import { useState, useMemo, useEffect, useCallback } from "react";
import { generateDsl, type AnnotationFields, type AnnotationForm, type EditRawInfo } from "../lib/annotationDsl";
import { SegmentedControl } from "./SegmentedControl";
import { renderMarkdown } from "../lib/renderMarkdown";
import type { AnnotationType, Certainty, Scope, ScopeKind as IpcScopeKind } from "../lib/ipc";
import { setPreference } from "../lib/ipc";
import { usePreferencesStore } from "../stores/preferences";
import type { AnnotationBuilderDefaults, BuilderScopeKind } from "../lib/annotationBuilderDefaults";

interface AnnotationBuilderModalProps {
  onClose: () => void;
  onInsert: (dsl: string) => void;
  initialFields?: Partial<AnnotationFields>;
  mode?: "create" | "edit";
  originalRange?: { from: number; to: number };
  onEditRaw?: (info: EditRawInfo) => void;
  selectedText?: string;
  /** Create mode: whether the insertion point sits at the end of its line (block form only parses there). */
  atLineEnd?: boolean;
  /** Edit mode: the form of the existing annotation — re-serializing must not reformat. */
  initialForm?: AnnotationForm;
}

const UNIT_SCOPE_KINDS: BuilderScopeKind[] = ["words", "sentence", "paragraph", "page"];

/** Map ipc ScopeKind ("word") to UI ScopeKind ("words") */
function ipcUnitToScopeKind(unit: IpcScopeKind): BuilderScopeKind {
  return unit === "word" ? "words" : unit;
}

/** Map UI ScopeKind ("words") to ipc ScopeKind ("word") */
function scopeKindToIpcUnit(kind: BuilderScopeKind): IpcScopeKind {
  return kind === "words" ? "word" : kind as IpcScopeKind;
}

export function AnnotationBuilderModal({
  onClose,
  onInsert,
  initialFields,
  mode,
  originalRange,
  onEditRaw,
  selectedText,
  atLineEnd,
  initialForm,
}: AnnotationBuilderModalProps) {
  const prefillEnabled = usePreferencesStore(s => s.annotationPrefillLastUsed);
  const savedDefaults = usePreferencesStore(s => s.annotationBuilderDefaults);
  const defaults = (mode !== "edit" && prefillEnabled && savedDefaults) ? savedDefaults : null;

  const [id, setId] = useState(() => {
    if (initialFields?.id) return initialFields.id;
    if (mode !== "edit") return crypto.randomUUID();
    return "";
  });
  const [type, setType] = useState<AnnotationType | null>(() => {
    if (initialFields?.type !== undefined) return initialFields.type;
    if (defaults?.type !== undefined) return defaults.type;
    return "note";
  });
  const [certainty, setCertainty] = useState<Certainty>(initialFields?.certainty ?? defaults?.certainty ?? "neutral");
  const [scopeKind, setScopeKind] = useState<BuilderScopeKind>(() => {
    if (initialFields?.scope) {
      if (initialFields.scope.kind === "asymmetric") {
        return ipcUnitToScopeKind(initialFields.scope.value.unit);
      }
      return initialFields.scope.kind;
    }
    if (selectedText) return "anchor";
    if (defaults) return defaults.scopeKind;
    return "none";
  });
  const [scopeCount, setScopeCount] = useState<number>(() => {
    if (initialFields?.scope) {
      if (initialFields.scope.kind === "asymmetric") return initialFields.scope.value.before;
      if (initialFields.scope.kind === "anchor") return 1;
      if (initialFields.scope.kind === "document" || initialFields.scope.kind === "section") return 1;
      return initialFields.scope.value as number;
    }
    if (defaults) return defaults.scopeCount;
    return 1;
  });
  const [anchorText, setAnchorText] = useState<string>(() => {
    if (initialFields?.scope?.kind === "anchor") return initialFields.scope.value;
    if (!initialFields?.scope && selectedText) return selectedText;
    return "";
  });
  const [asymmetric, setAsymmetric] = useState(() => {
    if (initialFields?.scope?.kind === "asymmetric") return true;
    if (defaults) return defaults.asymmetric;
    return false;
  });
  const [scopeAfter, setScopeAfter] = useState(() => {
    if (initialFields?.scope?.kind === "asymmetric") return initialFields.scope.value.after;
    if (defaults) return defaults.scopeAfter;
    return 1;
  });
  const [body, setBody] = useState(initialFields?.body ?? "");
  const [date, setDate] = useState(() => {
    if (initialFields?.date) return initialFields.date;
    if (mode !== "edit") return new Date().toISOString().slice(0, 10);
    return "";
  });
  const [mark] = useState<string | undefined>(initialFields?.mark);
  const [formChoice, setFormChoice] = useState<AnnotationForm>("inline");

  // Edit keeps the annotation's existing form; create only offers block when the
  // insertion point is at end of line (block form only parses at line start).
  const effectiveForm: AnnotationForm =
    mode === "edit"
      ? (initialForm ?? "inline")
      : !atLineEnd
        ? "inline"
        : body.includes("\n")
          ? "block"
          : formChoice;

  const mustStayInline = mode === "edit" ? initialForm !== "block" : !atLineEnd;
  const showFormToggle = mode !== "edit" && !!atLineEnd;

  const [defaultDate] = useState(date);
  const [defaultId] = useState(id);

  const hasNonDefaultAdvanced =
    certainty !== "neutral" ||
    date !== defaultDate ||
    id !== defaultId ||
    (showFormToggle && effectiveForm !== "inline");

  const [showAdvanced, setShowAdvanced] = useState(() => {
    if (initialFields?.certainty && initialFields.certainty !== "neutral") return true;
    if (initialFields?.date) return true;
    if (initialFields?.id) return true;
    if (defaults?.certainty && defaults.certainty !== "neutral") return true;
    return false;
  });

  const scope: Scope | null = useMemo(() => {
    if (scopeKind === "none") return null;
    if (scopeKind === "anchor") return { kind: "anchor" as const, value: anchorText || "" };
    if (scopeKind === "document") return { kind: "document" as const, value: 0 as const };
    if (scopeKind === "section") return { kind: "section" as const, value: 0 as const };
    if (asymmetric) {
      return { kind: "asymmetric" as const, value: { unit: scopeKindToIpcUnit(scopeKind), before: scopeCount, after: scopeAfter } };
    }
    return { kind: scopeKind, value: scopeCount };
  }, [scopeKind, scopeCount, anchorText, asymmetric, scopeAfter]);

  const fields: AnnotationFields = useMemo(
    () => ({
      id: id || null,
      type: mark ? null : type === "bare" ? null : type,
      mark,
      certainty,
      scope,
      body,
      date: date || null,
    }),
    [id, type, mark, certainty, scope, body, date],
  );

  const preview = useMemo(() => generateDsl(fields, { form: effectiveForm }), [fields, effectiveForm]);
  const renderedBody = useMemo(() => renderMarkdown(body), [body]);

  const handleInsert = useCallback(() => {
    if (mode !== "edit" && prefillEnabled) {
      const snapshot: AnnotationBuilderDefaults = {
        type, certainty,
        scopeKind: scopeKind === "anchor" ? "none" : scopeKind,
        scopeCount, asymmetric, scopeAfter,
      };
      const prev = usePreferencesStore.getState().annotationBuilderDefaults;
      usePreferencesStore.setState({ annotationBuilderDefaults: snapshot });
      setPreference("annotations.builderDefaults", snapshot).catch(() => {
        usePreferencesStore.setState({ annotationBuilderDefaults: prev });
      });
    }
    onInsert(preview);
  }, [mode, prefillEnabled, type, certainty, scopeKind, scopeCount, asymmetric, scopeAfter, onInsert, preview]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        handleInsert();
      }
    },
    [onClose, handleInsert],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="annotation-builder-backdrop"
    >
      <div
        className="w-[28rem] max-h-[90vh] flex flex-col rounded-lg bg-bg-primary p-5 shadow-lg"
        data-testid="annotation-builder-panel"
      >
        <div className="mb-3 flex items-end gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-text-muted">Type</span>
            {mark ? (
              <span
                className="rounded bg-bg-secondary px-2 py-1 text-sm text-text-normal"
                data-testid="annotation-mark-badge"
              >
                {mark}
              </span>
            ) : (
              <select
                data-testid="annotation-type-select"
                value={type ?? ""}
                onChange={(e) => setType((e.target.value || null) as AnnotationType | null)}
              >
                <option value="">Bare</option>
                <option value="note">Note (n)</option>
                <option value="question">Question (q)</option>
                <option value="todo">Todo</option>
                <option value="crossref">CrossRef (cf)</option>
                <option value="apparatus">Apparatus (app)</option>
                <option value="translation">Translation (tr)</option>
                <option value="llm">LLM (⚡)</option>
              </select>
            )}
          </label>

          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-text-muted">Scope</span>
            <select
              data-testid="annotation-scope-select"
              value={scopeKind}
              onChange={(e) => setScopeKind(e.target.value as BuilderScopeKind)}
            >
              <option value="none">Default (sentence)</option>
              <option value="words">Words</option>
              <option value="sentence">Sentence</option>
              <option value="paragraph">Paragraph</option>
              <option value="page">Page</option>
              <option value="anchor">Anchor</option>
              <option value="document">Document</option>
              <option value="section">Section</option>
            </select>
          </label>

          <button
            type="button"
            data-testid="annotation-overflow-toggle"
            className="relative rounded px-2 py-1 text-sm text-text-muted hover:bg-bg-secondary"
            onClick={() => setShowAdvanced(v => !v)}
            aria-expanded={showAdvanced}
            aria-label={hasNonDefaultAdvanced ? "Toggle advanced fields (modified)" : "Toggle advanced fields"}
          >
            <span className="nerd-font" aria-hidden="true">{showAdvanced ? "" : ""}</span>
            {hasNonDefaultAdvanced && !showAdvanced && (
              <span
                data-testid="annotation-overflow-dot"
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-interactive-accent"
                aria-hidden="true"
              />
            )}
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          {showAdvanced && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-text-muted">Certainty</span>
                <select
                  data-testid="annotation-certainty-select"
                  value={certainty}
                  onChange={(e) => setCertainty(e.target.value as Certainty)}
                >
                  <option value="neutral">Neutral</option>
                  <option value="tentative">Tentative (?)</option>
                  <option value="firm">Firm (!)</option>
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-text-muted">Date</span>
                <input
                  type="text"
                  className="rounded border border-border-primary bg-bg-secondary px-2 py-1 text-sm text-text-normal"
                  data-testid="annotation-date-input"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  placeholder="YYYY-MM or YYYY-MM-DD"
                />
              </label>

              <label className="col-span-2 flex flex-col gap-1">
                <span className="text-xs text-text-muted">ID (optional)</span>
                <input
                  type="text"
                  className="rounded border border-border-primary bg-bg-secondary px-2 py-1 text-sm text-text-normal"
                  data-testid="annotation-id-input"
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  placeholder="e.g. my-note-1"
                />
              </label>

              {showFormToggle && (
                <div className="col-span-2 flex flex-col gap-1">
                  <span className="text-xs text-text-muted">Form</span>
                  <div className="self-start">
                    <SegmentedControl
                      testId="annotation-form-toggle"
                      options={[
                        {
                          value: "inline",
                          label: "Inline",
                          disabled: body.includes("\n"),
                          title: body.includes("\n") ? "Multi-line body requires block form" : undefined,
                        },
                        { value: "block", label: "Block" },
                      ]}
                      value={effectiveForm}
                      onChange={(v) => setFormChoice(v as AnnotationForm)}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {UNIT_SCOPE_KINDS.includes(scopeKind) && !asymmetric && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-text-muted">Count</span>
              <input
                type="number"
                min={1}
                max={9}
                className="rounded border border-border-primary bg-bg-secondary px-2 py-1 text-sm text-text-normal"
                data-testid="annotation-scope-count"
                value={scopeCount}
                onChange={(e) => setScopeCount(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </label>
          )}

          {UNIT_SCOPE_KINDS.includes(scopeKind) && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                data-testid="annotation-asymmetric-toggle"
                checked={asymmetric}
                onChange={() => {
                  if (asymmetric) {
                    setScopeCount(Math.max(scopeCount, scopeAfter));
                    setAsymmetric(false);
                  } else {
                    setAsymmetric(true);
                  }
                }}
              />
              <span className="text-xs text-text-muted">Asymmetric</span>
            </label>
          )}

          {asymmetric && UNIT_SCOPE_KINDS.includes(scopeKind) && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-text-muted">Before</span>
                <input
                  type="number"
                  min={1}
                  max={9}
                  className="rounded border border-border-primary bg-bg-secondary px-2 py-1 text-sm text-text-normal"
                  data-testid="annotation-scope-before"
                  value={scopeCount}
                  onChange={(e) => setScopeCount(Math.max(1, parseInt(e.target.value) || 1))}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-text-muted">After</span>
                <input
                  type="number"
                  min={1}
                  max={9}
                  className="rounded border border-border-primary bg-bg-secondary px-2 py-1 text-sm text-text-normal"
                  data-testid="annotation-scope-after"
                  value={scopeAfter}
                  onChange={(e) => setScopeAfter(Math.max(1, parseInt(e.target.value) || 1))}
                />
              </label>
            </>
          )}

          {scopeKind === "anchor" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-text-muted">Anchor text</span>
              <input
                type="text"
                className="rounded border border-border-primary bg-bg-secondary px-2 py-1 text-sm text-text-normal"
                data-testid="annotation-anchor-input"
                value={anchorText}
                onChange={(e) => setAnchorText(e.target.value)}
                placeholder="anchored phrase…"
              />
            </label>
          )}
        </div>

        <label className="mb-3 flex flex-col gap-1">
          <span className="text-xs text-text-muted">Body</span>
          <textarea
            className="h-24 resize-y rounded border border-border-primary bg-bg-secondary px-2 py-1 text-sm text-text-normal"
            data-testid="annotation-body-input"
            value={body}
            onChange={(e) => setBody(mustStayInline ? e.target.value.replace(/\r?\n/g, " ") : e.target.value)}
            onKeyDown={(e) => {
              if (mustStayInline && e.key === "Enter" && !(e.metaKey || e.ctrlKey)) e.preventDefault();
            }}
            placeholder="Annotation body…"
          />
          {mustStayInline && (
            <span className="text-xs text-text-muted" data-testid="annotation-inline-hint">
              {mode === "edit"
                ? "This annotation is inline — the body stays on one line."
                : "Single line only — for a multi-line note, place the cursor at the end of a line."}
            </span>
          )}
        </label>

        <div className="mb-4 overflow-y-auto min-h-0 rounded border border-border-primary bg-bg-secondary p-2">
          <span className="mb-1 block text-xs text-text-muted">Preview</span>
          <code
            className="whitespace-pre-wrap text-xs text-text-normal block max-h-32 overflow-y-auto"
            data-testid="annotation-preview"
          >
            {preview}
          </code>
          {renderedBody && (
            <>
              <div className="my-2 border-t border-dashed border-border-primary" />
              <span className="mb-1 block text-xs text-text-muted">Rendered</span>
              <div
                className="prose prose-sm"
                data-testid="annotation-preview-rendered"
                dangerouslySetInnerHTML={{ __html: renderedBody }}
              />
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
            data-testid="annotation-cancel-btn"
            onClick={onClose}
          >
            Cancel
          </button>
          {onEditRaw && (
            <button
              className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
              data-testid="annotation-edit-raw-btn"
              onClick={() => onEditRaw({ mode: mode ?? "create", draftDsl: preview, originalRange })}
            >
              Edit Raw
            </button>
          )}
          <button
            className="rounded bg-interactive-accent px-3 py-1.5 text-sm text-white hover:opacity-90"
            data-testid="annotation-insert-btn"
            onClick={handleInsert}
          >
            {mode === "edit" ? "Update" : "Insert"}
          </button>
        </div>
      </div>
    </div>
  );
}
