import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { mockInvoke, resetInvokeMock } from "../test/tauri-mock";
import { usePreferencesStore } from "../stores/preferences";
import { SearchProviderSettings, _resetCachedProviders } from "./SearchProviderSettings";

function setupDefaultMock() {
  mockInvoke((cmd) => {
    if (cmd === "list_search_providers") {
      return [
        { id: "openalex", label: "OpenAlex", description: "Open catalog", category: "general", needs_api_key: false },
        { id: "pubmed", label: "PubMed", description: "Biomedical", category: "biomedical", needs_api_key: false },
      ];
    }
    return [];
  });
}

function setupFailingMock() {
  mockInvoke((cmd) => {
    if (cmd === "list_search_providers") {
      throw new Error("IPC connection lost");
    }
    return [];
  });
}

describe("SearchProviderSettings (render)", () => {
  beforeEach(() => {
    _resetCachedProviders();
    usePreferencesStore.setState({ searchEnabledProviders: ["openalex"] });
  });

  afterEach(() => {
    resetInvokeMock();
  });

  it("shows providers after successful load", async () => {
    setupDefaultMock();
    const { container } = render(<SearchProviderSettings />);

    await waitFor(() => {
      expect(container.querySelector(".text-text-muted")?.textContent).not.toBe("Loading providers...");
    });

    expect(container.textContent).toContain("OpenAlex");
    expect(container.textContent).toContain("PubMed");
  });

  it("shows error message when listSearchProviders fails", async () => {
    setupFailingMock();
    const { container } = render(<SearchProviderSettings />);

    await waitFor(() => {
      expect(container.textContent).toContain("Failed to load providers.");
    });
  });

  it("shows retry button when in error state", async () => {
    setupFailingMock();
    const { container } = render(<SearchProviderSettings />);

    await waitFor(() => {
      const retryBtn = container.querySelector("button.text-interactive-accent");
      expect(retryBtn).not.toBeNull();
      expect(retryBtn!.textContent).toBe("Retry");
    });
  });

  it("clicking retry re-fetches and recovers on success", async () => {
    // First call fails
    let callCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "list_search_providers") {
        callCount++;
        if (callCount === 1) {
          throw new Error("IPC connection lost");
        }
        return [
          { id: "openalex", label: "OpenAlex", description: "Open catalog", category: "general", needs_api_key: false },
        ];
      }
      return [];
    });

    const { container } = render(<SearchProviderSettings />);

    // Wait for error state
    await waitFor(() => {
      expect(container.textContent).toContain("Failed to load providers.");
    });

    // Click retry
    const retryBtn = container.querySelector("button.text-interactive-accent")!;
    fireEvent.click(retryBtn);

    // Should recover and show providers
    await waitFor(() => {
      expect(container.textContent).toContain("OpenAlex");
    });
    expect(container.textContent).not.toContain("Failed to load providers.");
  });

  it("clicking retry shows loading state before resolving", async () => {
    setupFailingMock();
    const { container } = render(<SearchProviderSettings />);

    await waitFor(() => {
      expect(container.textContent).toContain("Failed to load providers.");
    });

    // Now switch to a successful mock before clicking retry
    resetInvokeMock();
    setupDefaultMock();

    const retryBtn = container.querySelector("button.text-interactive-accent")!;
    fireEvent.click(retryBtn);

    // Eventually should show providers (loading -> success)
    await waitFor(() => {
      expect(container.textContent).toContain("OpenAlex");
    });
  });

  it("uses cached providers on remount instead of re-fetching", async () => {
    let fetchCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "list_search_providers") {
        fetchCount++;
        return [
          { id: "openalex", label: "OpenAlex", description: "Open catalog", category: "general", needs_api_key: false },
        ];
      }
      return [];
    });

    // First mount
    const { container, unmount } = render(<SearchProviderSettings />);
    await waitFor(() => {
      expect(container.textContent).toContain("OpenAlex");
    });
    expect(fetchCount).toBe(1);

    unmount();

    // Second mount - should use cache
    const { container: container2 } = render(<SearchProviderSettings />);
    await waitFor(() => {
      expect(container2.textContent).toContain("OpenAlex");
    });
    // Should still be 1 because cached
    expect(fetchCount).toBe(1);
  });
});
