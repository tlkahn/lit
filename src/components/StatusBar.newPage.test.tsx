import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useWorkspaceStore } from "../stores/workspace";
import { usePaneStore } from "../stores/panes";
import { useCursorInfoStore } from "../stores/cursorInfo";
import { useBottomPanelStore, defaultTabMeta } from "../stores/bottomPanel";
import { usePreferencesStore } from "../stores/preferences";
import { useStatusMessageStore } from "../stores/statusMessage";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import * as pdfPaneRef from "../lib/pdfPaneRef";

// Unit-level check that the status-bar + button routes through the shared
// createUntitledPage helper. The full store/IPC create path stays covered by
// the integration tests in StatusBar.test.tsx (which keep the real helper).
vi.mock("../lib/newPage", () => ({ createUntitledPage: vi.fn() }));

import { StatusBar } from "./StatusBar";
import { createUntitledPage } from "../lib/newPage";

beforeEach(() => {
  useWorkspaceStore.setState({
    workspacePath: null,
    graphReady: false,
    indexProgress: null,
    pages: [],
  });
  usePaneStore.setState({
    root: { type: "leaf", id: "p1", pagePath: null },
    focusedPaneId: "p1",
  });
  useCursorInfoStore.setState({ line: 0, col: 0 });
  useBottomPanelStore.setState({
    activeTab: "linked",
    unfolded: false,
    panelHeight: 200,
    tabMeta: defaultTabMeta(),
  });
  usePreferencesStore.setState({
    experimentalUnlinkedReferences: true,
    annotationEnabled: true,
  });
  useStatusMessageStore.setState({ message: null, variant: "success", action: null });
  usePanePdfLinkStore.setState({ links: new Map(), currentPage: new Map(), pageCount: new Map() });
  pdfPaneRef._resetForTesting();
  vi.clearAllMocks();
});

describe("StatusBar new page button routes through createUntitledPage", () => {
  it("clicking the New page button calls createUntitledPage once", async () => {
    useWorkspaceStore.setState({ workspacePath: "/test", graphReady: true });
    render(<StatusBar />);
    await userEvent.click(screen.getByRole("button", { name: "New page" }));
    expect(createUntitledPage).toHaveBeenCalledOnce();
  });

  it("does not call createUntitledPage when no workspace is open", async () => {
    useWorkspaceStore.setState({ workspacePath: null, graphReady: false });
    render(<StatusBar />);
    expect(screen.queryByRole("button", { name: "New page" })).toBeNull();
    expect(createUntitledPage).not.toHaveBeenCalled();
  });
});
