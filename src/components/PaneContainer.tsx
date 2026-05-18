import { usePaneStore } from "../stores/panes";
import type { PaneNode } from "../stores/panes";
import { EditorPane } from "./EditorPane";

function PaneNodeRenderer({ node }: { node: PaneNode }) {
  if (node.type === "leaf") {
    return <EditorPane paneId={node.id} />;
  }

  const directionClass =
    node.direction === "horizontal" ? "flex-row" : "flex-col";

  return (
    <div
      data-testid="pane-split"
      className={`flex ${directionClass} min-h-0 flex-1`}
    >
      {node.children.map((child, i) => (
        <div
          key={child.type === "leaf" ? child.id : i}
          style={{ flexBasis: `${node.sizes[i]}%` }}
          className="min-h-0 min-w-0 flex flex-col overflow-hidden"
        >
          <PaneNodeRenderer node={child} />
        </div>
      ))}
    </div>
  );
}

export function PaneContainer() {
  const root = usePaneStore((s) => s.root);
  return <PaneNodeRenderer node={root} />;
}
