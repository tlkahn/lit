import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PageContent, MergePlan } from "../lib/ipc";
import { previewMerge } from "../lib/ipc";
import { detectFrontmatterConflicts } from "../lib/frontmatterConflicts";

export function reorderArray<T>(arr: T[], fromIdx: number, toIdx: number): T[] {
  const result = [...arr];
  const [moved] = result.splice(fromIdx, 1);
  result.splice(toIdx, 0, moved!);
  return result;
}

interface MergePreviewDialogProps {
  open: boolean;
  docs: PageContent[];
  onConfirm: (plan: MergePlan, ordering: number[]) => void;
  onCancel: () => void;
}

function SortableItem({ id, title }: { id: string; title: string }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded border border-border-primary bg-bg-secondary px-3 py-2"
      data-testid="merge-section-item"
      {...attributes}
      {...listeners}
    >
      <span className="cursor-grab text-text-muted">&#x2630;</span>
      <span className="text-sm text-text-normal">{title}</span>
    </div>
  );
}

export function MergePreviewDialog({
  open,
  docs,
  onConfirm,
  onCancel,
}: MergePreviewDialogProps) {
  const [ordering, setOrdering] = useState<number[]>([]);
  const [title, setTitle] = useState("");
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (open) {
      const indices = docs.map((_, i) => i);
      setOrdering(indices);
      setTitle(docs.map((d) => d.meta.title).join(" + "));
      setTitleManuallyEdited(false);
      setConfirming(false);
    }
  }, [open, docs]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    },
    [onCancel],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = ordering.indexOf(Number(active.id));
      const newIndex = ordering.indexOf(Number(over.id));
      const newOrdering = reorderArray(ordering, oldIndex, newIndex);
      setOrdering(newOrdering);
      if (!titleManuallyEdited) {
        setTitle(newOrdering.map((i) => docs[i]!.meta.title).join(" + "));
      }
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    try {
      const orderedDocs = ordering.map((i) => ({
        title: docs[i]!.meta.title,
        body: docs[i]!.body,
        frontmatter: docs[i]!.meta.frontmatter,
      }));
      const plan = await previewMerge(orderedDocs);
      plan.title = title;
      onConfirm(plan, ordering);
    } catch {
      // IPC failure — silently recover
    } finally {
      setConfirming(false);
    }
  }

  if (!open) return null;

  const orderedDocs = ordering.map((i) => docs[i]!);
  const fmSources = orderedDocs.map((d) => d.meta.frontmatter);
  const conflicts = detectFrontmatterConflicts(fmSources);
  const allKeys = new Set<string>();
  for (const source of fmSources) {
    for (const key of Object.keys(source)) {
      allKeys.add(key);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="merge-preview-backdrop"
    >
      <div
        className="w-[32rem] max-h-[80vh] overflow-y-auto rounded-lg bg-bg-primary p-5 shadow-lg"
        data-testid="merge-preview-dialog"
      >
        <h2 className="mb-4 text-base font-medium text-text-normal">Merge Preview</h2>

        <label className="mb-1 block text-xs text-text-muted">Title</label>
        <input
          type="text"
          className="mb-4 w-full rounded border border-border-primary bg-bg-secondary px-3 py-1.5 text-sm text-text-normal"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setTitleManuallyEdited(true);
          }}
          data-testid="merge-title-input"
        />

        <label className="mb-1 block text-xs text-text-muted">Document order</label>
        <div className="mb-4 flex flex-col gap-1" data-testid="merge-section-list">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={ordering.map(String)} strategy={verticalListSortingStrategy}>
              {ordering.map((idx) => (
                <SortableItem key={idx} id={String(idx)} title={docs[idx]!.meta.title} />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {allKeys.size > 0 && (
          <div className="mb-4" data-testid="merge-fm-panel">
            <label className="mb-1 block text-xs text-text-muted">Frontmatter</label>
            <div className="flex flex-col gap-0.5">
              {[...allKeys].map((key) => (
                <div
                  key={key}
                  className={`rounded px-2 py-0.5 text-xs ${
                    conflicts.has(key)
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                      : "text-text-muted"
                  }`}
                  data-testid={conflicts.has(key) ? "merge-fm-conflict" : "merge-fm-key"}
                >
                  {key}{conflicts.has(key) ? " (conflict)" : ""}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
            onClick={onCancel}
            data-testid="merge-cancel-btn"
          >
            Cancel
          </button>
          <button
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
            onClick={handleConfirm}
            disabled={confirming}
            data-testid="merge-confirm-btn"
          >
            {confirming ? "Merging..." : "Merge"}
          </button>
        </div>
      </div>
    </div>
  );
}
