import type React from "react";
import { lazy, Suspense } from "react";
import { usePaneStore, findLeaf } from "../stores/panes";
import type { PaneNode } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import { EditorPane } from "./EditorPane";
import { PdfViewerPane } from "./PdfViewerPane";
import { PaneDivider } from "./PaneDivider";
import { MIN_PANE_PX, DIVIDER_PX } from "../lib/paneConstants";
import { getFileType } from "../hooks/useLeafFileType";
import { PaneHeader } from "./PaneHeader";

// CodeEditorPane is lazy-loaded so its (Phase 3) CodeMirror grammar stack is
// only pulled in when a code file is actually opened. It is a default export,
// which React.lazy requires; EditorPane/PdfViewerPane stay eager named imports.
const CodeEditorPane = lazy(() => import("./CodeEditorPane"));

function PaneLeafRenderer({ paneId }: { paneId: string }) {
  const isMultiPane = usePaneStore((s) => s.root.type === "split");

  // Derive pagePath from the pane store and fileType from the workspace pages
  // list in a single place. getFileType resolves a `.pdf` leaf to "pdf" and a
  // known code-extension leaf to "code" by extension even before the pages list
  // loads, so a restored PDF or code pane routes straight here without ever
  // flashing EditorPane. A null fileType means an empty pane (no pagePath).
  // Both values are passed as props to PaneHeader, eliminating duplicate
  // findLeaf traversals and store subscriptions.
  const pagePath = usePaneStore(
    (s) => findLeaf(s.root, paneId)?.pagePath ?? null,
  );
  const pages = useWorkspaceStore((s) => s.pages);
  const fileType = getFileType(pagePath, pages);

  let content: React.ReactNode;
  if (fileType === "pdf") {
    content = <PdfViewerPane paneId={paneId} />;
  } else if (fileType === "code") {
    content = (
      <Suspense fallback={null}>
        <CodeEditorPane paneId={paneId} />
      </Suspense>
    );
  } else {
    content = <EditorPane paneId={paneId} />;
  }

  if (!isMultiPane) return content;

  return (
    <>
      <PaneHeader paneId={paneId} pagePath={pagePath} fileType={fileType} />
      {content}
    </>
  );
}

function PaneNodeRenderer({ node, path }: { node: PaneNode; path: number[] }) {
  if (node.type === "leaf") {
    return <PaneLeafRenderer paneId={node.id} />;
  }

  const directionClass =
    node.direction === "horizontal" ? "flex-row" : "flex-col";

  const dividerTotalPx = (node.children.length - 1) * DIVIDER_PX;

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
    const size = node.sizes[i]!;
    const dividerShare = dividerTotalPx * size / 100;
    items.push(
      <div
        key={child.id}
        style={{
          flexBasis: `calc(${size}% - ${dividerShare}px)`,
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
