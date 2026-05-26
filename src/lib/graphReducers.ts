export interface ReducerContext {
  selectedSet: Set<string>;
  dimColor: string;
}

export interface HoverContext extends ReducerContext {
  hoveredNode: string;
  neighbors: Set<string>;
}

export interface SearchContext extends ReducerContext {
  matchSet: Set<string>;
}

export function defaultNodeReduce(
  nodeId: string,
  attrs: Record<string, unknown>,
  ctx: ReducerContext,
): Record<string, unknown> {
  if (ctx.selectedSet.has(nodeId)) {
    return { ...attrs, forceLabel: true, highlighted: true };
  }
  return { ...attrs, forceLabel: false };
}

export function hoverNodeReduce(
  nodeId: string,
  attrs: Record<string, unknown>,
  ctx: HoverContext,
): Record<string, unknown> {
  const isSelected = ctx.selectedSet.has(nodeId);

  if (nodeId === ctx.hoveredNode) {
    return isSelected
      ? { ...attrs, forceLabel: true, highlighted: true }
      : { ...attrs, forceLabel: true };
  }

  if (ctx.neighbors.has(nodeId)) {
    return isSelected
      ? { ...attrs, forceLabel: true, highlighted: true }
      : { ...attrs, forceLabel: false };
  }

  return isSelected
    ? { ...attrs, color: ctx.dimColor, forceLabel: true, highlighted: true }
    : { ...attrs, color: ctx.dimColor, forceLabel: false };
}

export function searchNodeReduce(
  nodeId: string,
  attrs: Record<string, unknown>,
  ctx: SearchContext,
): Record<string, unknown> {
  if (ctx.matchSet.has(nodeId)) {
    return { ...attrs, highlighted: true, forceLabel: true };
  }

  const isSelected = ctx.selectedSet.has(nodeId);
  return isSelected
    ? { ...attrs, color: ctx.dimColor, forceLabel: true, highlighted: true }
    : { ...attrs, color: ctx.dimColor, forceLabel: false };
}
