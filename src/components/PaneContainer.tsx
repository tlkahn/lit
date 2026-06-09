import type React from "react";
import { lazy, Suspense } from "react";
import { usePaneStore } from "../stores/panes";
import type { PaneNode } from "../stores/panes";
import { EditorPane } from "./EditorPane";
import { PdfViewerPane } from "./PdfViewerPane";
import { PaneDivider } from "./PaneDivider";
import { MIN_PANE_PX } from "../lib/paneConstants";
import { useLeafFileType } from "../hooks/useLeafFileType";

// CodeEditorPane is lazy-loaded so its (Phase 3) CodeMirror grammar stack is
// only pulled in when a code file is actually opened. It is a default export,
// which React.lazy requires; EditorPane/PdfViewerPane stay eager named imports.
const CodeEditorPane = lazy(() => import("./CodeEditorPane"));

function PaneLeafRenderer({ paneId }: { paneId: string }) {
  // useLeafFileType resolves a `.pdf` leaf to "pdf" and a known code-extension
  // leaf to "code" by extension even before the pages list loads, so a restored
  // PDF or code pane routes straight here without ever flashing EditorPane
  // (which would run readPage — corrupting a code file via frontmatter, or
  // reading a binary PDF). A null fileType means an empty pane (no pagePath) —
  // EditorPane shows "No page selected".
  const fileType = useLeafFileType(paneId);
  if (fileType === "pdf") {
    return <PdfViewerPane paneId={paneId} />;
  }
  if (fileType === "code") {
    return (
      <Suspense fallback={null}>
        <CodeEditorPane paneId={paneId} />
      </Suspense>
    );
  }
  return <EditorPane paneId={paneId} />;
}

function PaneNodeRenderer({ node, path }: { node: PaneNode; path: number[] }) {
  if (node.type === "leaf") {
    return <PaneLeafRenderer paneId={node.id} />;
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
        style={{
          flexBasis: `${node.sizes[i]}%`,
          ...(node.direction === "horizontal"
            ? { minWidth: MIN_PANE_PX }
            : { minHeight: MIN_PANE_PX }),
        }}
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
