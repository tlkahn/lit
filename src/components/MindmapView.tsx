import { useMemo, useRef, useState } from "react";
import { hierarchy, tree as d3tree, type HierarchyPointNode } from "d3-hierarchy";
import { linkHorizontal } from "d3-shape";
import type { HeadingNode } from "../lib/headingTree";

interface MindmapViewProps {
  tree: HeadingNode;
  onNodeClick: (node: HeadingNode) => void;
  onNodeRename: (node: HeadingNode, newText: string) => void;
  onNodeMove: (sourceId: string, targetParentId: string, targetIndex: number) => void;
}

const NODE_WIDTH = 160;
const NODE_HEIGHT = 32;
const FONT_SIZES = [16, 15, 14, 13, 12, 11];

type PointNode = HierarchyPointNode<HeadingNode>;

export function MindmapView({ tree, onNodeClick, onNodeRename, onNodeMove: _onNodeMove }: MindmapViewProps) {
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

    const descendants = root.descendants().filter((d) => d.data.level > 0);
    const links = root.links().filter((l) => l.source.data.level > 0);

    return { descendants, links };
  }, [tree, allNodes.length]);

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

  return (
    <div className="w-full h-full overflow-auto">
      <svg ref={svgRef} viewBox={viewBox} className="w-full h-full min-w-[600px] min-h-[400px]">
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

            return (
              <g
                key={d.data.id}
                transform={`translate(${d.y},${d.x})`}
                data-mindmap-node={d.data.id}
                className="cursor-pointer"
                onClick={() => {
                  if (!isEditing) onNodeClick(d.data);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingId(d.data.id);
                  setEditText(d.data.text);
                }}
              >
                <rect
                  x={-4}
                  y={-fontSize / 2 - 4}
                  width={NODE_WIDTH}
                  height={fontSize + 8}
                  rx={4}
                  className="fill-white dark:fill-neutral-800 stroke-neutral-300 dark:stroke-neutral-600"
                  strokeWidth={1}
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
        </g>
      </svg>
    </div>
  );
}
