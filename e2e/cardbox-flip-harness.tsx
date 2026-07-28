import { createRoot } from "react-dom/client";
import { useState, useCallback } from "react";
import { CardboxCard } from "../src/components/CardboxCard";
import type { CardboxAnnotation } from "../src/lib/ipc";
import "../src/index.css";

const cardA: CardboxAnnotation = {
  uuid: "card-a",
  annotation_type: "note",
  certainty: "neutral",
  body: "Card A body text",
  date: "2026-07-01",
  source_page_id: "test.md",
  source_page_title: "Test Document",
  source_line: 1,
  char_start: 0,
  char_end: 20,
  scope_kind: "words",
  scope_value: "1",
  original: "Original quote for card A",
};

const cardB: CardboxAnnotation = {
  uuid: "card-b",
  annotation_type: "question",
  certainty: "high",
  body: "Card B body text",
  date: null,
  source_page_id: "other.md",
  source_page_title: "Other Document",
  source_line: 10,
  char_start: 5,
  char_end: 30,
  scope_kind: "words",
  scope_value: "2",
  original: "Original quote for card B",
};

const cardC: CardboxAnnotation = {
  uuid: "card-c",
  annotation_type: "todo",
  certainty: "neutral",
  body: "Card C - no original, cannot flip",
  date: null,
  source_page_id: "todo.md",
  source_page_title: "Todo List",
  source_line: 3,
  char_start: 0,
  char_end: 15,
  scope_kind: "words",
  scope_value: "1",
  original: null,
};

function HarnessApp() {
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((uuid: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }, []);

  const noop = useCallback(() => {}, []);

  return (
    <div style={{ display: "flex", gap: 16, padding: 16 }}>
      <div id="card-a" style={{ width: 300 }}>
        <CardboxCard
          annotation={cardA}
          expanded={expandedSet.has("card-a")}
          onToggleExpand={() => toggleExpand("card-a")}
          onNavigate={noop}
        />
      </div>
      <div id="card-b" style={{ width: 300 }}>
        <CardboxCard
          annotation={cardB}
          expanded={expandedSet.has("card-b")}
          onToggleExpand={() => toggleExpand("card-b")}
          onNavigate={noop}
        />
      </div>
      <div id="card-c" style={{ width: 300 }}>
        <CardboxCard
          annotation={cardC}
          expanded={expandedSet.has("card-c")}
          onToggleExpand={() => toggleExpand("card-c")}
          onNavigate={noop}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("harness-root")!).render(<HarnessApp />);
