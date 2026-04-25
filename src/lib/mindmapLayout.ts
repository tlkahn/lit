export const NODE_PADDING = 16;
export const MIN_NODE_WIDTH = 80;
export const MAX_NODE_WIDTH = 300;

const AVG_CHAR_WIDTH_RATIO = 0.6;

export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * AVG_CHAR_WIDTH_RATIO;
}

export function computeNodeWidth(text: string, fontSize: number): number {
  const textW = estimateTextWidth(text, fontSize);
  return Math.max(MIN_NODE_WIDTH, Math.min(Math.ceil(textW + NODE_PADDING), MAX_NODE_WIDTH));
}

export function truncateText(text: string, fontSize: number, nodeWidth: number): string {
  const maxTextWidth = nodeWidth - NODE_PADDING;
  const charWidth = fontSize * AVG_CHAR_WIDTH_RATIO;
  const maxChars = Math.floor(maxTextWidth / charWidth);
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(1, maxChars - 2)) + "..";
}
