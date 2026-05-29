import { SELECTED_COLOR } from "./graphLayout";

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
    return { ...attrs, color: SELECTED_COLOR, forceLabel: true, highlighted: true };
  }
  return { ...attrs, forceLabel: false };
}

export function hoverNodeReduce(
  nodeId: string,
  attrs: Record<string, unknown>,
  ctx: HoverContext,
): Record<string, unknown> {
  if (ctx.selectedSet.has(nodeId)) {
    return { ...attrs, color: SELECTED_COLOR, forceLabel: true, highlighted: true };
  }

  if (nodeId === ctx.hoveredNode) {
    return { ...attrs, forceLabel: true };
  }

  if (ctx.neighbors.has(nodeId)) {
    return { ...attrs, forceLabel: false };
  }

  return { ...attrs, color: ctx.dimColor, forceLabel: false };
}

export function searchNodeReduce(
  nodeId: string,
  attrs: Record<string, unknown>,
  ctx: SearchContext,
): Record<string, unknown> {
  if (ctx.selectedSet.has(nodeId)) {
    return { ...attrs, color: SELECTED_COLOR, highlighted: true, forceLabel: true };
  }

  if (ctx.matchSet.has(nodeId)) {
    return { ...attrs, highlighted: true, forceLabel: true };
  }

  return { ...attrs, color: ctx.dimColor, forceLabel: false };
}
