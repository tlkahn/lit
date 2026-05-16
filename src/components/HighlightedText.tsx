export const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function HighlightedText({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>;

  const indexSet = new Set(indices);
  const parts: { text: string; highlighted: boolean }[] = [];
  let current = "";
  let inHighlight = false;

  let gi = 0;
  for (const { segment } of graphemeSegmenter.segment(text)) {
    const shouldHighlight = indexSet.has(gi);
    if (shouldHighlight !== inHighlight) {
      if (current) parts.push({ text: current, highlighted: inHighlight });
      current = "";
      inHighlight = shouldHighlight;
    }
    current += segment;
    gi++;
  }
  if (current) parts.push({ text: current, highlighted: inHighlight });

  return (
    <>
      {parts.map((part, i) =>
        part.highlighted ? (
          <mark key={i} className="bg-transparent font-semibold text-text-accent">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}
