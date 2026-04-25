import type { ResolvedWikilink, PageMeta } from "./ipc";

export interface NavigationDeps {
  resolveWikilink: (target: string) => Promise<ResolvedWikilink>;
  createPage: (name: string) => Promise<PageMeta>;
  selectPage: (relativePath: string) => void;
  setPendingSection: (section: string) => void;
  currentPagePath: string | null;
  triggerReload: () => void;
  recordDeparture?: () => void;
}

export async function navigateWikilink(
  target: string,
  section: string | undefined,
  deps: NavigationDeps,
): Promise<void> {
  deps.recordDeparture?.();

  if (target === "") {
    if (section) {
      deps.setPendingSection(section);
      deps.triggerReload();
    }
    return;
  }

  try {
    const resolved = await deps.resolveWikilink(target);

    if (section) {
      deps.setPendingSection(section);
    }

    if (resolved.node_id) {
      deps.selectPage(resolved.node_id);
    } else {
      const meta = await deps.createPage(target);
      deps.selectPage(meta.relative_path);
    }
  } catch (err) {
    console.error("[navigateWikilink] failed:", err);
  }
}
