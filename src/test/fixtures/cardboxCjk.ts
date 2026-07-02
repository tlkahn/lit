import type { CardboxAnnotation } from "../../lib/ipc";

// 仁学-style classical Chinese clauses (谭嗣同), 。-terminated. Cycled and
// index-suffixed so every body/original is distinct — search filtering and
// per-card assertions must be able to discriminate cards.
const CLAUSES = [
  "仁以通为第一义。",
  "以太也，电也，心力也，皆指出所以通之具。",
  "通之义，以道通为一最浑括。",
  "通有四义：中外通，多取其义于《春秋》。",
  "上下通，男女内外通，多取其义于《易》。",
  "人我通，多取其义于《佛书》。",
  "仁为天地万物之源，故唯心，故唯识。",
  "智慧生于仁，不仁则不智。",
  "平等生万化，代数之方程是也。",
  "仁不仁之辨，于其通与塞。",
];

const TYPES = ["note", "question", "todo"] as const;

export function generateCardboxAnnotationsCJK(
  count: number,
  opts?: { pages?: number },
): CardboxAnnotation[] {
  const pages = Math.max(1, opts?.pages ?? 1);
  const annotations: CardboxAnnotation[] = [];
  for (let i = 0; i < count; i++) {
    const clause = CLAUSES[i % CLAUSES.length]!;
    const nextClause = CLAUSES[(i + 1) % CLAUSES.length]!;
    const page = i % pages;
    const charStart = 10 + i * 120;
    annotations.push({
      uuid: `cjk-${i}`,
      annotation_type: TYPES[i % TYPES.length]!,
      certainty: "neutral",
      body: `第${i}条批注：${clause}`,
      date: "2026-06-15",
      source_page_id: pages === 1 ? "renxue.md" : `renxue-${page}.md`,
      source_page_title: pages === 1 ? "仁学" : `仁学·卷${page}`,
      source_line: 3 + i,
      char_start: charStart,
      char_end: charStart + clause.length,
      scope_kind: "sentence",
      scope_value: "1",
      original: `${clause}${nextClause}（第${i}段）`,
    });
  }
  return annotations;
}
