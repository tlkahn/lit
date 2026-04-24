import { useMemo, useRef, useState } from "react";
import { hierarchy, tree as d3tree } from "d3-hierarchy";
import { linkHorizontal } from "d3-shape";
import type { HeadingNode } from "../lib/headingTree";
import { buildNodeRects, buildGapZones, type PointNode } from "../lib/mindmapDnd";
import { useMindmapDrag } from "../hooks/useMindmapDrag";

interface MindmapViewProps {
  tree: HeadingNode;
  onNodeClick: (node: HeadingNode) => void;
  onNodeRename: (node: HeadingNode, newText: string) => void;
  onNodeMove: (sourceId: string, targetParentId: string, targetIndex: number) => void;
}

const NODE_WIDTH = 160;
const NODE_HEIGHT = 32;
const FONT_SIZES = [16, 15, 14, 13, 12, 11];

export function MindmapView({ tree, onNodeClick, onNodeRename, onNodeMove }: MindmapViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const allNodes = useMemo(() => {
    const nodes: HeadingNode[] = [];
    function walk(n: HeadingNode) {
      if (n.level > 0) nodes.push(n);
      for (const c of n.children) walk(c);
    }
    walk(tree);
    return nodes;
  }, [tree]);

  const layout = useMemo(() => {
    if (allNodes.length === 0) return null;

    const root = hierarchy(tree, (d) => (d.children.length > 0 ? d.children : undefined));
    const treeLayout = d3tree<HeadingNode>().nodeSize([NODE_HEIGHT + 12, NODE_WIDTH + 40]);
    treeLayout(root);

    const descendants = (root.descendants() as PointNode[]).filter((d) => d.data.level > 0);
    const links = root.links().filter((l) => l.source.data.level > 0);

    return { descendants, links };
  }, [tree, allNodes.length]);

  const nodeRects = useMemo(() => {
    if (!layout) return [];
    return buildNodeRects(layout.descendants, NODE_WIDTH, FONT_SIZES);
  }, [layout]);

  const gapZones = useMemo(() => {
    if (!layout) return [];
    return buildGapZones(layout.descendants);
  }, [layout]);

  const { dragState, dragOccurredRef, handlers } = useMindmapDrag({
    svgRef,
    descendants: layout?.descendants ?? [],
    tree,
    nodeRects,
    gapZones,
    onNodeMove,
  });

  if (allNodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 dark:text-neutral-400">
        No headings
      </div>
    );
  }

  if (!layout) return null;

  const { descendants, links } = layout;

  const linkGen = linkHorizontal<unknown, PointNode>()
    .x((d) => d.y)
    .y((d) => d.x);

  const xs = descendants.map((d) => d.x!);
  const ys = descendants.map((d) => d.y!);
  const minX = Math.min(...xs) - NODE_HEIGHT;
  const maxX = Math.max(...xs) + NODE_HEIGHT;
  const minY = Math.min(...ys) - NODE_WIDTH / 2;
  const maxY = Math.max(...ys) + NODE_WIDTH;

  const viewBox = `${minY - 20} ${minX - 20} ${maxY - minY + 40} ${maxX - minX + 40}`;

  const activeGap =
    dragState.isDragging && dragState.dropTarget?.kind === "gap" ? dragState.dropTarget : null;
  const activeGapZone = activeGap
    ? gapZones.find((g) => g.parentId === activeGap.parentId && g.index === activeGap.index)
    : null;

  return (
    <div className="w-full h-full overflow-auto">
      <svg
        ref={svgRef}
        viewBox={viewBox}
        className={`w-full h-full min-w-[600px] min-h-[400px] ${dragState.isDragging ? "cursor-grabbing" : ""}`}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onKeyDown={handlers.onKeyDown}
        tabIndex={0}
        data-mindmap-svg
      >
        <g>
          {links.map((l, i) => (
            <path
              key={i}
              d={linkGen(l as never) ?? ""}
              fill="none"
              className="stroke-neutral-300 dark:stroke-neutral-600"
              strokeWidth={1.5}
              data-mindmap-link
            />
          ))}
          {descendants.map((d) => {
            const fontSize = FONT_SIZES[Math.min(d.data.level - 1, FONT_SIZES.length - 1)]!;
            const isEditing = editingId === d.data.id;
            const isDragging = dragState.draggingId === d.data.id;
            const isDropTarget =
              dragState.isDragging &&
              dragState.dropTarget?.kind === "node" &&
              dragState.dropTarget.nodeId === d.data.id;
            const isInvalid = dragState.isDragging && dragState.invalidIds.has(d.data.id);

            return (
              <g
                key={d.data.id}
                transform={`translate(${d.y},${d.x})`}
                data-mindmap-node={d.data.id}
                {...(isDragging ? { "data-mindmap-dragging": true } : {})}
                {...(isDropTarget ? { "data-mindmap-drop-target": true } : {})}
                {...(isInvalid ? { "data-mindmap-drop-invalid": true } : {})}
                className={
                  isInvalid
                    ? "cursor-not-allowed"
                    : isDragging
                      ? "cursor-grabbing opacity-50"
                      : "cursor-pointer"
                }
                onClick={() => {
                  if (!isEditing && !dragOccurredRef.current) onNodeClick(d.data);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!dragOccurredRef.current) {
                    setEditingId(d.data.id);
                    setEditText(d.data.text);
                  }
                }}
                onPointerDown={(e) => handlers.onPointerDown(d.data.id, e)}
              >
                <rect
                  x={-4}
                  y={-fontSize / 2 - 4}
                  width={NODE_WIDTH}
                  height={fontSize + 8}
                  rx={4}
                  className={
                    isDropTarget
                      ? "fill-blue-100 dark:fill-blue-900 stroke-blue-500 dark:stroke-blue-400"
                      : isDragging
                        ? "fill-white dark:fill-neutral-800 stroke-dashed stroke-neutral-400 dark:stroke-neutral-500"
                        : "fill-white dark:fill-neutral-800 stroke-neutral-300 dark:stroke-neutral-600"
                  }
                  strokeWidth={isDropTarget ? 2 : 1}
                  strokeDasharray={isDragging ? "4 2" : undefined}
                />
                {isEditing ? (
                  <foreignObject x={-2} y={-fontSize / 2 - 2} width={NODE_WIDTH - 4} height={fontSize + 4}>
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          onNodeRename(d.data, editText);
                          setEditingId(null);
                        } else if (e.key === "Escape") {
                          setEditingId(null);
                        }
                      }}
                      onBlur={() => setEditingId(null)}
                      autoFocus
                      className="w-full h-full bg-transparent border-none outline-none text-neutral-900 dark:text-neutral-100"
                      style={{ fontSize }}
                      data-mindmap-edit
                    />
                  </foreignObject>
                ) : (
                  <text
                    dy="0.35em"
                    fontSize={fontSize}
                    className="fill-neutral-900 dark:fill-neutral-100 select-none"
                  >
                    {d.data.text}
                  </text>
                )}
              </g>
            );
          })}
          {activeGapZone && (
            <line
              x1={activeGapZone.left}
              y1={activeGapZone.top + activeGapZone.height / 2}
              x2={activeGapZone.left + activeGapZone.width}
              y2={activeGapZone.top + activeGapZone.height / 2}
              className="stroke-blue-500 dark:stroke-blue-400"
              strokeWidth={2}
              strokeDasharray="6 3"
              data-mindmap-gap-indicator
            />
          )}
        </g>
      </svg>
    </div>
  );
}
