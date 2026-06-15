export const MASONRY_ROW_HEIGHT = 8;
export const MASONRY_GAP = 16;

export function computeSpan(contentHeight: number, rowHeight: number, gap: number): number {
  return Math.max(1, Math.ceil((contentHeight + gap) / rowHeight));
}
