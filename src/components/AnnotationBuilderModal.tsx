import { useState, useMemo, useEffect, useCallback } from "react";
import { generateDsl, type AnnotationFields } from "../lib/annotationDsl";
import type { AnnotationType, Certainty, Scope } from "../lib/ipc";

interface AnnotationBuilderModalProps {
  onClose: () => void;
  onInsert: (dsl: string) => void;
  initialFields?: Partial<AnnotationFields>;
}

type ScopeKind = "none" | "words" | "sentence" | "paragraph" | "page" | "anchor";

export function AnnotationBuilderModal({
  onClose,
  onInsert,
  initialFields,
}: AnnotationBuilderModalProps) {
  const [type, setType] = useState<AnnotationType | null>(initialFields?.type ?? null);
  const [certainty, setCertainty] = useState<Certainty>(initialFields?.certainty ?? "neutral");
  const [scopeKind, setScopeKind] = useState<ScopeKind>(() => {
    if (!initialFields?.scope) return "none";
    return initialFields.scope.kind;
  });
  const [scopeCount, setScopeCount] = useState<number>(() => {
    if (!initialFields?.scope) return 1;
    if (initialFields.scope.kind === "anchor") return 1;
    return initialFields.scope.value as number;
  });
  const [anchorText, setAnchorText] = useState<string>(() => {
    if (initialFields?.scope?.kind === "anchor") return initialFields.scope.value;
    return "";
  });
  const [body, setBody] = useState(initialFields?.body ?? "");
  const [date, setDate] = useState(initialFields?.date ?? "");

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const scope: Scope | null = useMemo(() => {
    if (scopeKind === "none") return null;
    if (scopeKind === "anchor") return { kind: "anchor", value: anchorText || "" };
    return { kind: scopeKind, value: scopeCount };
  }, [scopeKind, scopeCount, anchorText]);

  const fields: AnnotationFields = useMemo(
    () => ({
      type: type === "bare" ? null : type,
      certainty,
      scope,
      body,
      date: date || null,
    }),
    [type, certainty, scope, body, date],
  );

  const preview = useMemo(() => generateDsl(fields), [fields]);

  const handleInsert = () => {
    onInsert(preview);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="annotation-builder-backdrop"
    >
      <div
        className="w-[28rem] rounded-lg bg-bg-primary p-5 shadow-lg"
        data-testid="annotation-builder-panel"
      >
        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Type</span>
            <select
              className="rounded border border-border-primary bg-bg-secondary px-2 py-1 text-sm text-text-normal"
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
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Certainty</span>
            <select
              className="rounded border border-border-primary bg-bg-secondary px-2 py-1 text-sm text-text-normal"
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
            <span className="text-xs text-text-muted">Scope</span>
            <select
              className="rounded border border-border-primary bg-bg-secondary px-2 py-1 text-sm text-text-normal"
              data-testid="annotation-scope-select"
              value={scopeKind}
              onChange={(e) => setScopeKind(e.target.value as ScopeKind)}
            >
              <option value="none">Default (sentence)</option>
              <option value="words">Words</option>
              <option value="sentence">Sentence</option>
              <option value="paragraph">Paragraph</option>
              <option value="page">Page</option>
              <option value="anchor">Anchor</option>
            </select>
          </label>

          {scopeKind !== "none" && scopeKind !== "anchor" && (
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

          <label className="col-span-2 flex flex-col gap-1">
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
        </div>

        <label className="mb-3 flex flex-col gap-1">
          <span className="text-xs text-text-muted">Body</span>
          <textarea
            className="h-24 resize-y rounded border border-border-primary bg-bg-secondary px-2 py-1 text-sm text-text-normal"
            data-testid="annotation-body-input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Annotation body…"
          />
        </label>

        <div className="mb-4 rounded border border-border-primary bg-bg-secondary p-2">
          <span className="mb-1 block text-xs text-text-muted">Preview</span>
          <pre
            className="whitespace-pre-wrap text-xs text-text-normal"
            data-testid="annotation-preview"
          >
            {preview}
          </pre>
        </div>

        <div className="flex justify-end gap-2">
          <button
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
            data-testid="annotation-cancel-btn"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded bg-interactive-accent px-3 py-1.5 text-sm text-white hover:opacity-90"
            data-testid="annotation-insert-btn"
            onClick={handleInsert}
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
