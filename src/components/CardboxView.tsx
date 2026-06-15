import { useEffect } from "react";
import { useCardboxStore } from "../stores/cardbox";
import { CardboxCard } from "./CardboxCard";

export default function CardboxView() {
  const annotations = useCardboxStore((s) => s.annotations);
  const expandedUuid = useCardboxStore((s) => s.expandedUuid);
  const loading = useCardboxStore((s) => s.loading);
  const fetchAnnotations = useCardboxStore((s) => s.fetchAnnotations);
  const toggleExpand = useCardboxStore((s) => s.toggleExpand);

  useEffect(() => {
    fetchAnnotations();
  }, [fetchAnnotations]);

  if (loading && annotations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-text-faint" data-testid="cardbox-loading">
        Loading annotations…
      </div>
    );
  }

  if (annotations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-text-faint" data-testid="cardbox-empty">
        No annotations in this workspace
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-y-auto p-6"
      data-testid="cardbox-grid"
    >
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
      >
        {annotations.map((ann) => (
          <CardboxCard
            key={ann.uuid}
            annotation={ann}
            expanded={expandedUuid === ann.uuid}
            onToggleExpand={() => toggleExpand(ann.uuid)}
            onNavigate={() => {}}
          />
        ))}
      </div>
    </div>
  );
}
