import type { ResolvedWikilink, PageMeta } from "./ipc";

export interface NavigationDeps {
  resolveWikilink: (target: string) => Promise<ResolvedWikilink>;
  createPage: (name: string) => Promise<PageMeta>;
  selectPage: (relativePath: string) => void;
  setPendingSection: (section: string) => void;
  currentPagePath: string | null;
  triggerReload: () => void;
  recordDeparture?: () => void;
  /**
   * Scroll the already-loaded doc to a section in place. Used when navigation
   * stays on the current page: selectPage won't replace the doc there, so the
   * pendingSection handoff (consumed on doc replacement) would never fire.
   */
  scrollToSection?: (section: string) => void;
}

export async function navigateWikilink(
  target: string,
  section: string | undefined,
  deps: NavigationDeps,
): Promise<void> {
  deps.recordDeparture?.();

  if (target === "") {
    if (section) {
      if (deps.scrollToSection) {
        deps.scrollToSection(section);
      } else {
        deps.setPendingSection(section);
        deps.triggerReload();
      }
    }
    return;
  }

  try {
    const resolved = await deps.resolveWikilink(target);

    let selectedPath: string;
    if (resolved.node_id) {
      selectedPath = resolved.node_id;
    } else {
      const meta = await deps.createPage(target);
      selectedPath = meta.relative_path;
    }
    deps.selectPage(selectedPath);

    if (section) {
      if (selectedPath === deps.currentPagePath && deps.scrollToSection) {
        deps.scrollToSection(section);
      } else {
        deps.setPendingSection(section);
      }
    }
  } catch (err) {
    console.error("[navigateWikilink] failed:", err);
  }
}
