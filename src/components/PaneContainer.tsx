import type React from "react";
import { usePaneStore } from "../stores/panes";
import type { PaneNode } from "../stores/panes";
import { EditorPane } from "./EditorPane";
import { PaneDivider } from "./PaneDivider";

function PaneNodeRenderer({ node, path }: { node: PaneNode; path: number[] }) {
  if (node.type === "leaf") {
    return <EditorPane paneId={node.id} />;
  }

  const directionClass =
    node.direction === "horizontal" ? "flex-row" : "flex-col";

  const items: React.ReactNode[] = [];
  node.children.forEach((child, i) => {
    if (i > 0) {
      items.push(
        <PaneDivider
          key={`divider-${i}`}
          splitPath={path}
          direction={node.direction}
          index={i - 1}
        />,
      );
    }
    items.push(
      <div
        key={child.id}
        style={{ flexBasis: `${node.sizes[i]}%` }}
        className="min-h-0 min-w-0 grow-0 shrink-0 flex flex-col overflow-hidden"
      >
        <PaneNodeRenderer node={child} path={[...path, i]} />
      </div>,
    );
  });

  return (
    <div
      data-testid="pane-split"
      className={`flex ${directionClass} min-h-0 flex-1`}
    >
      {items}
    </div>
  );
}

export function PaneContainer({ style }: { style?: React.CSSProperties }) {
  const root = usePaneStore((s) => s.root);
  return (
    <div style={style} className="flex flex-1 min-h-0">
      <PaneNodeRenderer node={root} path={[]} />
    </div>
  );
}
