import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { hierarchy, tree as d3tree } from "d3-hierarchy";
import { linkHorizontal } from "d3-shape";
import { findNode, findParent, findNextSibling, findPrevSibling, firstChild, migrateFoldIds, setsEqual, type HeadingNode } from "../lib/headingTree";
import { buildNodeRects, buildGapZones, type PointNode } from "../lib/mindmapDnd";
import type { ContentBounds } from "../lib/mindmapZoom";
import { computeNodeWidth, wrapText, computeNodeHeight, MAX_NODE_WIDTH, LINE_HEIGHT_RATIO } from "../lib/mindmapLayout";
import { useMindmapDrag } from "../hooks/useMindmapDrag";
import { useMindmapZoom } from "../hooks/useMindmapZoom";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";

interface MindmapViewProps {
  tree: HeadingNode;
  selectedId: string | null;
  onNodeClick: (node: HeadingNode) => void;
  onNodeRename: (node: HeadingNode, newText: string) => void;
  onNodeMove: (sourceId: string, targetParentId: string, targetIndex: number) => void;
  onInsertChild?: (parentId: string, text: string) => string | null;
  onInsertSibling?: (siblingId: string, text: string) => string | null;
  onInsertDangling?: (text: string) => string | null;
  onDeleteNode?: (nodeId: string) => void;
  onNodeJump?: (node: HeadingNode) => void;
  onExportNetwork?: () => void;
  initialFoldedIds?: Set<string>;
  onFoldChange?: (foldedIds: Set<string>) => void;
}

const FONT_SIZES = [16, 15, 14, 13, 12, 11];

function countDescendants(node: HeadingNode): number {
  let count = 0;
  for (const child of node.children) {
    count += 1 + countDescendants(child);
  }
  return count;
}

export function MindmapView({ tree, selectedId, onNodeClick, onNodeRename, onNodeMove, onInsertChild, onInsertSibling, onInsertDangling, onDeleteNode, onNodeJump, onExportNetwork, initialFoldedIds, onFoldChange }: MindmapViewProps) {
  const lastChildRef = useRef<Map<string, string>>(new Map());
  const prevTreeRef = useRef(tree);
  if (prevTreeRef.current !== tree) {
    prevTreeRef.current = tree;
    lastChildRef.current.clear();
  }
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [pendingEditId, setPendingEditId] = useState<string | null>(null);
  const [isNewNode, setIsNewNode] = useState(false);
  const deletedNewNodeRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [foldedIds, setFoldedIds] = useState<Set<string>>(() => initialFoldedIds ?? new Set());
  const foldTreeRef = useRef(tree);

  const dismissContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!pendingEditId) return;
    const node = findNode(tree, pendingEditId);
    if (!node) return;
    deletedNewNodeRef.current = false;
    setEditingId(pendingEditId);
    setEditText(node.text);
    setIsNewNode(true);
    setPendingEditId(null);
    onNodeClick(node);
  }, [tree, pendingEditId, onNodeClick]);

  useEffect(() => {
    if (pendingDeleteId && !findNode(tree, pendingDeleteId)) {
      setPendingDeleteId(null);
    }
  }, [tree, pendingDeleteId]);

  useEffect(() => {
    if (!contextMenu) return;
    const onPointerDown = () => dismissContextMenu();
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [contextMenu, dismissContextMenu]);

  const allNodes = useMemo(() => {
    const nodes: HeadingNode[] = [];
    function walk(n: HeadingNode) {
      if (n.level > 0) nodes.push(n);
      for (const c of n.children) walk(c);
    }
    walk(tree);
    return nodes;
  }, [tree]);

  useEffect(() => {
    const prevTree = foldTreeRef.current;
    foldTreeRef.current = tree;
    if (foldedIds.size === 0) return;
    const migrated = migrateFoldIds(prevTree, tree, foldedIds);
    if (!setsEqual(migrated, foldedIds)) {
      setFoldedIds(migrated);
      onFoldChange?.(migrated);
    }
  }, [tree, foldedIds, onFoldChange]);

  const nodeWidths = useMemo(() => {
    const widths = new Map<string, number>();
    for (const n of allNodes) {
      const fontSize = FONT_SIZES[Math.min(n.level - 1, FONT_SIZES.length - 1)]!;
      widths.set(n.id, computeNodeWidth(n.text, fontSize));
    }
    return widths;
  }, [allNodes]);

  const wrappedLines = useMemo(() => {
    const lines = new Map<string, string[]>();
    for (const n of allNodes) {
      const fontSize = FONT_SIZES[Math.min(n.level - 1, FONT_SIZES.length - 1)]!;
      lines.set(n.id, wrapText(n.text, fontSize, MAX_NODE_WIDTH));
    }
    return lines;
  }, [allNodes]);

  const nodeHeights = useMemo(() => {
    const heights = new Map<string, number>();
    for (const n of allNodes) {
      const fontSize = FONT_SIZES[Math.min(n.level - 1, FONT_SIZES.length - 1)]!;
      const lineCount = wrappedLines.get(n.id)?.length ?? 1;
      heights.set(n.id, computeNodeHeight(lineCount, fontSize));
    }
    return heights;
  }, [allNodes, wrappedLines]);

  const maxNodeHeight = useMemo(() => {
    if (nodeHeights.size === 0) return 22;
    return Math.max(...nodeHeights.values());
  }, [nodeHeights]);

  const layout = useMemo(() => {
    if (allNodes.length === 0) return null;

    const root = hierarchy(tree, (d) => {
      if (foldedIds.has(d.id)) return undefined;
      return d.children.length > 0 ? d.children : undefined;
    });
    const treeLayout = d3tree<HeadingNode>().nodeSize([maxNodeHeight + 12, MAX_NODE_WIDTH + 40]);
    treeLayout(root);

    const descendants = (root.descendants() as PointNode[]).filter((d) => d.data.level > 0);
    const links = root.links().filter((l) => l.source.data.level > 0);

    return { descendants, links };
  }, [tree, allNodes.length, maxNodeHeight, foldedIds]);

  const contentBounds: ContentBounds | null = useMemo(() => {
    if (!layout) return null;
    const { descendants } = layout;
    const xs = descendants.map((d) => d.x);
    const ys = descendants.map((d) => d.y);
    const minX = Math.min(...xs) - maxNodeHeight;
    const maxX = Math.max(...xs) + maxNodeHeight;
    const minY = Math.min(...ys) - MAX_NODE_WIDTH / 2;
    const maxY = Math.max(...ys) + MAX_NODE_WIDTH;
    return { x: minY, y: minX, width: maxY - minY, height: maxX - minX };
  }, [layout, maxNodeHeight]);

  const hasContent = allNodes.length > 0;
  const { svgRef, gRef, transformRef, fitContent, zoomIn, zoomOut } = useMindmapZoom(contentBounds, hasContent);

  const nodeRects = useMemo(() => {
    if (!layout) return [];
    return buildNodeRects(layout.descendants, nodeWidths, FONT_SIZES, nodeHeights);
  }, [layout, nodeWidths, nodeHeights]);

  const gapZones = useMemo(() => {
    if (!layout) return [];
    return buildGapZones(layout.descendants, nodeWidths);
  }, [layout, nodeWidths]);

  const { dragState, dragOccurredRef, handlers } = useMindmapDrag({
    svgRef,
    descendants: layout?.descendants ?? [],
    tree,
    nodeRects,
    gapZones,
    onNodeMove,
    zoomTransformRef: transformRef,
  });

  useEffect(() => {
    svgRef.current?.focus();
  }, []);

  if (allNodes.length === 0) {
    return (
      <div
        className="flex items-center justify-center h-full text-neutral-500 dark:text-neutral-400"
        onDoubleClick={() => {
          if (onInsertDangling) {
            const nodeId = onInsertDangling("Untitled");
            if (nodeId) setPendingEditId(nodeId);
          }
        }}
      >
        No headings
      </div>
    );
  }

  if (!layout) return null;

  const { descendants, links } = layout;

  const linkGen = linkHorizontal<unknown, PointNode>()
    .x((d) => d.y)
    .y((d) => d.x);

  const activeGap =
    dragState.isDragging && dragState.dropTarget?.kind === "gap" ? dragState.dropTarget : null;
  const activeGapZone = activeGap
    ? gapZones.find((g) => g.parentId === activeGap.parentId && g.index === activeGap.index)
    : null;

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden relative">
      <svg
        ref={svgRef}
        className={`w-full h-full ${dragState.isDragging ? "cursor-grabbing" : ""}`}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onDoubleClick={(e) => {
          if ((e.target as Element).closest("[data-mindmap-node]")) return;
          if (onInsertDangling) {
            const nodeId = onInsertDangling("Untitled");
            if (nodeId) setPendingEditId(nodeId);
          }
        }}
        onKeyDown={(e) => {
          handlers.onKeyDown(e);
          if (!selectedId || dragState.isDragging || editingId || pendingDeleteId) return;
          if (e.key === "Tab" && e.shiftKey) {
            e.preventDefault();
            const parent = findParent(tree, selectedId);
            if (parent && parent.level > 0) {
              lastChildRef.current.set(parent.id, selectedId);
              onNodeClick(parent);
            }
            return;
          }
          if (e.key === "Tab" && onInsertChild) {
            e.preventDefault();
            const nodeId = onInsertChild(selectedId, "Untitled");
            if (nodeId) setPendingEditId(nodeId);
            return;
          }
          if (e.key === "Enter" && onInsertSibling) {
            e.preventDefault();
            const nodeId = onInsertSibling(selectedId, "Untitled");
            if (nodeId) setPendingEditId(nodeId);
            return;
          }
          if (e.key === "F2") {
            e.preventDefault();
            const node = findNode(tree, selectedId);
            if (node) {
              deletedNewNodeRef.current = false;
              setEditingId(node.id);
              setEditText(node.text);
              setIsNewNode(false);
            }
            return;
          }
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            const node = findNode(tree, selectedId);
            if (!node) return;
            if (countDescendants(node) > 0) {
              setPendingDeleteId(selectedId);
            } else if (onDeleteNode) {
              onDeleteNode(selectedId);
            }
            return;
          }
          if (e.key === " ") {
            e.preventDefault();
            const node = findNode(tree, selectedId);
            if (!node || node.children.length === 0) return;
            const newSet = new Set(foldedIds);
            if (newSet.has(selectedId)) newSet.delete(selectedId);
            else newSet.add(selectedId);
            setFoldedIds(newSet);
            onFoldChange?.(newSet);
            return;
          }
          let target: HeadingNode | null = null;
          switch (e.key) {
            case "ArrowDown":
              target = findNextSibling(tree, selectedId);
              break;
            case "ArrowUp":
              target = findPrevSibling(tree, selectedId);
              break;
            case "ArrowRight": {
              if (foldedIds.has(selectedId)) break;
              const node = findNode(tree, selectedId);
              if (node && node.children.length > 0) {
                const rememberedId = lastChildRef.current.get(selectedId);
                if (rememberedId) {
                  const remembered = findNode(tree, rememberedId);
                  if (remembered && findParent(tree, rememberedId)?.id === selectedId) {
                    target = remembered;
                    break;
                  }
                }
                target = firstChild(node);
              }
              break;
            }
            case "ArrowLeft": {
              const parent = findParent(tree, selectedId);
              if (parent && parent.level > 0) {
                lastChildRef.current.set(parent.id, selectedId);
                target = parent;
              }
              break;
            }
          }
          if (target) {
            e.preventDefault();
            onNodeClick(target);
            return;
          }
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            const node = findNode(tree, selectedId);
            if (node) {
              deletedNewNodeRef.current = false;
              setEditingId(node.id);
              setEditText(e.key);
              setIsNewNode(false);
            }
          }
        }}
        tabIndex={0}
        data-mindmap-svg
      >
        <defs>
          {descendants.map((d) => {
            const nw = nodeWidths.get(d.data.id) ?? 160;
            const nh = nodeHeights.get(d.data.id) ?? 22;
            return (
              <clipPath key={d.data.id} id={`node-clip-${d.data.id}`}>
                <rect x={-4} y={-nh / 2} width={nw} height={nh} rx={4} />
              </clipPath>
            );
          })}
        </defs>
        <g ref={gRef}>
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
            const nw = nodeWidths.get(d.data.id) ?? 160;
            const isEditing = editingId === d.data.id;
            const isDragging = dragState.draggingId === d.data.id;
            const isDropTarget =
              dragState.isDragging &&
              dragState.dropTarget?.kind === "node" &&
              dragState.dropTarget.nodeId === d.data.id;
            const isInvalid = dragState.isDragging && dragState.invalidIds.has(d.data.id);
            const isSelected = d.data.id === selectedId;
            const lines = wrappedLines.get(d.data.id) ?? [d.data.text];
            const nh = nodeHeights.get(d.data.id) ?? (fontSize + 8);
            const lineHeight = Math.ceil(fontSize * LINE_HEIGHT_RATIO);

            return (
              <g
                key={d.data.id}
                transform={`translate(${d.y},${d.x})`}
                data-mindmap-node={d.data.id}
                {...(isDragging ? { "data-mindmap-dragging": true } : {})}
                {...(isDropTarget ? { "data-mindmap-drop-target": true } : {})}
                {...(isInvalid ? { "data-mindmap-drop-invalid": true } : {})}
                {...(isSelected ? { "data-mindmap-selected": true } : {})}
                className={
                  isDragging
                    ? "cursor-grabbing opacity-[0.3]"
                    : isInvalid
                      ? "cursor-not-allowed"
                      : "cursor-pointer"
                }
                onClick={() => {
                  if (!isEditing && !dragOccurredRef.current) onNodeClick(d.data);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!dragOccurredRef.current && onNodeJump) {
                    onNodeJump(d.data);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!dragState.isDragging) {
                    const rect = containerRef.current?.getBoundingClientRect();
                    const ox = rect?.left ?? 0;
                    const oy = rect?.top ?? 0;
                    setContextMenu({ nodeId: d.data.id, x: e.clientX - ox, y: e.clientY - oy });
                  }
                }}
                onPointerDown={(e) => handlers.onPointerDown(d.data.id, e)}
              >
                <rect
                  x={-4}
                  y={-nh / 2}
                  width={nw}
                  height={nh}
                  rx={4}
                  className={
                    isDropTarget
                      ? "fill-blue-100 dark:fill-blue-900 stroke-blue-500 dark:stroke-blue-400"
                      : isSelected
                        ? "fill-white dark:fill-neutral-800 stroke-blue-500 dark:stroke-blue-400"
                        : "fill-white dark:fill-neutral-800 stroke-neutral-300 dark:stroke-neutral-600"
                  }
                  strokeWidth={isDropTarget || isSelected ? 2 : 1}
                />
                <text
                  y={-((lines.length - 1) * lineHeight) / 2}
                  fontSize={fontSize}
                  clipPath={`url(#node-clip-${d.data.id})`}
                  className="fill-neutral-900 dark:fill-neutral-100 select-none"
                >
                  {lines.map((line, i) => (
                    <tspan key={i} x={0} dy={i === 0 ? "0.35em" : lineHeight}>{line}</tspan>
                  ))}
                </text>
                {foldedIds.has(d.data.id) && d.data.children.length > 0 && (
                  <text
                    x={nw + 4}
                    fontSize={fontSize - 2}
                    className="fill-neutral-500 dark:fill-neutral-400 select-none"
                    dominantBaseline="central"
                    data-mindmap-fold-badge
                  >
                    +{countDescendants(d.data)}
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
          {dragState.cursorPos && dragState.draggingId && (() => {
            const draggedNode = descendants.find(d => d.data.id === dragState.draggingId);
            if (!draggedNode) return null;
            const fontSize = FONT_SIZES[Math.min(draggedNode.data.level - 1, FONT_SIZES.length - 1)]!;
            const ghostW = nodeWidths.get(draggedNode.data.id) ?? 160;
            const ghostH = nodeHeights.get(draggedNode.data.id) ?? (fontSize + 8);
            const ghostLines = wrappedLines.get(draggedNode.data.id) ?? [draggedNode.data.text];
            const ghostLineHeight = Math.ceil(fontSize * LINE_HEIGHT_RATIO);
            return (
              <g
                data-mindmap-ghost
                transform={`translate(${dragState.cursorPos.x - ghostW / 2},${dragState.cursorPos.y - ghostH / 2})`}
                opacity={0.6}
                pointerEvents="none"
              >
                <rect
                  x={-4}
                  y={-ghostH / 2}
                  width={ghostW}
                  height={ghostH}
                  rx={4}
                  className="fill-white dark:fill-neutral-800 stroke-blue-500 dark:stroke-blue-400"
                  strokeWidth={1.5}
                />
                <text
                  y={-((ghostLines.length - 1) * ghostLineHeight) / 2}
                  fontSize={fontSize}
                  className="fill-neutral-900 dark:fill-neutral-100 select-none"
                >
                  {ghostLines.map((line, i) => (
                    <tspan key={i} x={0} dy={i === 0 ? "0.35em" : ghostLineHeight}>{line}</tspan>
                  ))}
                </text>
              </g>
            );
          })()}
        </g>
      </svg>
      {editingId && (() => {
        const editNode = descendants.find(d => d.data.id === editingId);
        if (!editNode) return null;
        const fontSize = FONT_SIZES[Math.min(editNode.data.level - 1, FONT_SIZES.length - 1)]!;
        const editW = nodeWidths.get(editNode.data.id) ?? 160;
        const editH = nodeHeights.get(editNode.data.id) ?? (fontSize + 8);
        const t = transformRef.current;
        const left = editNode.y * t.k + t.x;
        const top = (editNode.x - editH / 2) * t.k + t.y;
        const width = editW * t.k;
        const height = editH * t.k;
        return (
          <input
            type="text"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onNodeRename(editNode.data, editText);
                deletedNewNodeRef.current = true;
                setEditingId(null);
                setIsNewNode(false);
                svgRef.current?.focus();
              } else if (e.key === "Escape") {
                if (isNewNode && onDeleteNode) {
                  deletedNewNodeRef.current = true;
                  onDeleteNode(editingId);
                }
                setEditingId(null);
                setIsNewNode(false);
                svgRef.current?.focus();
              }
            }}
            onBlur={() => {
              if (deletedNewNodeRef.current) return;
              if (isNewNode && onDeleteNode) {
                onDeleteNode(editingId);
              }
              setEditingId(null);
              setIsNewNode(false);
              svgRef.current?.focus();
            }}
            onFocus={(e) => { if (isNewNode) e.currentTarget.select(); }}
            autoFocus
            className="absolute bg-white dark:bg-neutral-800 border border-blue-500 dark:border-blue-400 rounded px-1 outline-none text-neutral-900 dark:text-neutral-100 z-40"
            style={{ left, top, width, height, fontSize: fontSize * t.k, lineHeight: `${height}px` }}
            data-mindmap-edit
          />
        );
      })()}
      {contextMenu && (() => {
        const menuNode = allNodes.find(n => n.id === contextMenu.nodeId);
        if (!menuNode) return null;
        return (
          <div
            data-mindmap-context-menu
            className="absolute z-50 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded shadow-lg py-1 min-w-[120px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") dismissContextMenu();
            }}
          >
            <button
              data-mindmap-context-edit
              className="w-full text-start px-3 py-1.5 text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700"
              onClick={() => {
                deletedNewNodeRef.current = false;
                setEditingId(menuNode.id);
                setEditText(menuNode.text);
                setContextMenu(null);
              }}
            >
              Edit
            </button>
            {onExportNetwork && (
              <button
                data-mindmap-context-export
                className="w-full text-start px-3 py-1.5 text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                onClick={() => {
                  onExportNetwork();
                  setContextMenu(null);
                }}
              >
                Export Local Network…
              </button>
            )}
          </div>
        );
      })()}
      <div className="absolute bottom-4 right-4 flex gap-1">
        <button
          data-mindmap-zoom-in
          onClick={zoomIn}
          className="w-8 h-8 flex items-center justify-center rounded bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700"
        >
          +
        </button>
        <button
          data-mindmap-zoom-out
          onClick={zoomOut}
          className="w-8 h-8 flex items-center justify-center rounded bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700"
        >
          −
        </button>
        <button
          data-mindmap-zoom-fit
          onClick={fitContent}
          className="h-8 px-2 flex items-center justify-center rounded bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 text-sm"
        >
          Fit
        </button>
      </div>
      {pendingDeleteId && (() => {
        const deleteNode = findNode(tree, pendingDeleteId);
        if (!deleteNode) return null;
        return (
          <ConfirmDeleteDialog
            open={true}
            nodeName={deleteNode.text}
            childCount={countDescendants(deleteNode)}
            onConfirm={() => {
              if (onDeleteNode) onDeleteNode(pendingDeleteId);
              setPendingDeleteId(null);
            }}
            onCancel={() => setPendingDeleteId(null)}
          />
        );
      })()}
    </div>
  );
}

export default MindmapView;
